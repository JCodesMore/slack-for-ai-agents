import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { formatSlackError, getWebClient } from '../client.js';
import { activeWorkspaceGuard } from '../guards.js';

const MUTATING = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: true } as const;

const CANVAS_OPERATIONS = [
  'insert_after',
  'insert_before',
  'insert_at_start',
  'insert_at_end',
  'replace',
  'delete',
] as const;

const CanvasChangeSchema = z.object({
  operation: z
    .enum(CANVAS_OPERATIONS)
    .describe(
      'Where/how to apply the change: insert_at_end (append), insert_at_start (prepend), ' +
        'insert_after / insert_before (relative to section_id), replace (replace section), delete (remove section).',
    ),
  document_content: z
    .object({
      type: z.literal('markdown'),
      markdown: z.string().min(1),
    })
    .optional()
    .describe("Required for all operations except 'delete'. The new markdown content."),
  section_id: z
    .string()
    .optional()
    .describe(
      "Required for 'insert_after', 'insert_before', 'replace', and 'delete'. The id of the target section.",
    ),
});

const CANVAS_MARKDOWN_HINT =
  'Markdown supports: # heading, **bold**, _italic_, ~strike~, `code`, lists (* or 1.), ' +
  '[link](url), > quote, ![alt](image-url), tables, and ```fenced code``` blocks. Use \\n for line breaks.';

export function registerCanvasTools(server: McpServer): void {
  server.registerTool(
    'slack_create_canvas',
    {
      description:
        'Creates a standalone canvas (rich-text doc) via canvases.create. Returns canvas_id which can be passed to slack_edit_canvas / slack_delete_canvas. ' +
        'Standalone canvases live outside any channel — to attach a canvas to a channel tab, use slack_create_channel_canvas. ' +
        'Requires the canvases:write bot scope. ' +
        CANVAS_MARKDOWN_HINT,
      inputSchema: {
        title: z.string().optional().describe('Canvas title shown at the top.'),
        markdown: z.string().min(1).describe('Canvas body in markdown.'),
      },
      annotations: MUTATING,
    },
    async ({ title, markdown }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        const args: Record<string, unknown> = {
          document_content: { type: 'markdown', markdown },
        };
        if (title) args.title = title;
        const r = await slack.canvases.create(
          args as unknown as Parameters<typeof slack.canvases.create>[0],
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ok: true,
                  canvas_id: r.canvas_id ?? null,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: formatSlackError(err) }],
        };
      }
    },
  );

  server.registerTool(
    'slack_edit_canvas',
    {
      description:
        'Edits an existing canvas via canvases.edit. Pass an array of `changes` — each is an `operation` plus `document_content` and/or `section_id`. ' +
        "Common pattern: append text via { operation: 'insert_at_end', document_content: { type: 'markdown', markdown: '...' } }. " +
        'To target a specific section (replace / delete / insert_before / insert_after) you need its section_id, which Slack returns when blocks are addressed via the Canvas UI. ' +
        'Requires canvases:write scope. ' +
        CANVAS_MARKDOWN_HINT,
      inputSchema: {
        canvas_id: z
          .string()
          .min(1)
          .describe('Canvas id (e.g. F0... from slack_create_canvas or slack_create_channel_canvas).'),
        changes: z
          .array(CanvasChangeSchema)
          .min(1)
          .max(50)
          .describe('Edit operations applied in order.'),
      },
      annotations: MUTATING,
    },
    async ({ canvas_id, changes }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        const args: Record<string, unknown> = { canvas_id, changes };
        await slack.canvases.edit(args as unknown as Parameters<typeof slack.canvases.edit>[0]);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ok: true,
                  canvas_id,
                  applied_changes: changes.length,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: formatSlackError(err) }],
        };
      }
    },
  );

  server.registerTool(
    'slack_delete_canvas',
    {
      description:
        'Deletes a canvas via canvases.delete. DESTRUCTIVE — the canvas content is gone and the canvas_id stops resolving. ' +
        'For channel-tab canvases this also detaches the canvas from the channel.',
      inputSchema: {
        canvas_id: z.string().min(1).describe('Canvas id to delete.'),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ canvas_id }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        await slack.canvases.delete({ canvas_id });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, deleted_canvas_id: canvas_id }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: formatSlackError(err) }],
        };
      }
    },
  );

  server.registerTool(
    'slack_create_channel_canvas',
    {
      description:
        "Creates a canvas attached to a channel's Canvas tab via conversations.canvases.create. " +
        'If the channel already has a canvas, returns its existing canvas_id (no overwrite). ' +
        'Use this for channel-scoped welcome docs, runbooks, FAQs. ' +
        'Requires canvases:write scope and the bot must be in the channel. ' +
        CANVAS_MARKDOWN_HINT,
      inputSchema: {
        channel_id: z.string().min(1).describe('Channel ID (C... or G...) to attach the canvas to.'),
        markdown: z.string().optional().describe('Initial canvas body in markdown. Optional.'),
      },
      annotations: MUTATING,
    },
    async ({ channel_id, markdown }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        const args: Record<string, unknown> = { channel_id };
        if (markdown) args.document_content = { type: 'markdown', markdown };
        const r = await slack.conversations.canvases.create(
          args as unknown as Parameters<typeof slack.conversations.canvases.create>[0],
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ok: true,
                  canvas_id: r.canvas_id ?? null,
                  channel_id,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: formatSlackError(err) }],
        };
      }
    },
  );
}
