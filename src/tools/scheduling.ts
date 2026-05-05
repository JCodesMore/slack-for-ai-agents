import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { formatSlackError, getWebClient } from '../client.js';
import { activeWorkspaceGuard } from '../guards.js';
import { BlocksSchema } from './blocks.js';

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: true } as const;
const MUTATING = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: true } as const;

const SLACK_MAX_SCHEDULE_DAYS = 120;

function parsePostAt(input: string): { unix: number; iso: string } | { error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { error: 'post_at is empty.' };
  let unixMs: number;
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    unixMs = trimmed.length >= 13 ? n : n * 1000;
  } else {
    const d = new Date(trimmed);
    if (Number.isNaN(d.getTime())) {
      return {
        error: `Could not parse "${input}" as a date. Use ISO 8601 (e.g. "2026-05-05T09:00:00Z") or Unix epoch seconds.`,
      };
    }
    unixMs = d.getTime();
  }
  const now = Date.now();
  const maxFuture = now + SLACK_MAX_SCHEDULE_DAYS * 24 * 60 * 60 * 1000;
  if (unixMs < now - 60_000) {
    return {
      error: `post_at "${input}" is in the past. Slack only accepts future timestamps.`,
    };
  }
  if (unixMs > maxFuture) {
    return {
      error: `post_at "${input}" is more than ${SLACK_MAX_SCHEDULE_DAYS} days in the future, which Slack rejects.`,
    };
  }
  return {
    unix: Math.floor(unixMs / 1000),
    iso: new Date(unixMs).toISOString(),
  };
}

export function registerSchedulingTools(server: McpServer): void {
  server.registerTool(
    'slack_schedule_message',
    {
      description:
        'Schedules a message via chat.scheduleMessage to be posted later. Body can be plain text and/or Block Kit `blocks`. ' +
        '`post_at` accepts ISO 8601 (e.g. "2026-05-05T09:00:00Z") or Unix epoch seconds. ' +
        `Slack only allows scheduling up to ${SLACK_MAX_SCHEDULE_DAYS} days in the future. ` +
        'Returns `scheduled_message_id` (needed to cancel via slack_delete_scheduled_message). ' +
        'Bot must be in the channel (or have chat:write.public for public channels) and have chat:write scope.',
      inputSchema: {
        channel_id: z.string().min(1).describe('Channel ID (C... or G...) to post to.'),
        post_at: z
          .string()
          .min(1)
          .describe(
            'When to post — ISO 8601 string (preferred, e.g. "2026-05-05T09:00:00Z") or Unix epoch seconds. ' +
              `Must be in the future, max ${SLACK_MAX_SCHEDULE_DAYS} days out.`,
          ),
        text: z.string().optional().describe('Plain-text body. Required if `blocks` is not provided.'),
        blocks: BlocksSchema.optional().describe(
          'Block Kit blocks (see slack_post_message description for the schema). Required if `text` is not provided.',
        ),
        thread_ts: z.string().optional().describe('Reply to this thread (parent message ts).'),
        reply_broadcast: z
          .boolean()
          .optional()
          .describe('If thread_ts is set, also surface the reply in the main channel.'),
      },
      annotations: MUTATING,
    },
    async ({ channel_id, post_at, text, blocks, thread_ts, reply_broadcast }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      if ((!text || !text.trim()) && (!blocks || blocks.length === 0)) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: 'Either `text` or `blocks` must be provided.',
            },
          ],
        };
      }
      const parsed = parsePostAt(post_at);
      if ('error' in parsed) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: parsed.error }],
        };
      }
      try {
        const slack = getWebClient();
        const args: Record<string, unknown> = {
          channel: channel_id,
          post_at: parsed.unix,
          text: text ?? ' ',
        };
        if (blocks) args.blocks = blocks;
        if (thread_ts) args.thread_ts = thread_ts;
        if (reply_broadcast !== undefined) args.reply_broadcast = reply_broadcast;
        const r = await slack.chat.scheduleMessage(
          args as unknown as Parameters<typeof slack.chat.scheduleMessage>[0],
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ok: true,
                  scheduled_message_id: r.scheduled_message_id ?? null,
                  channel: r.channel ?? channel_id,
                  post_at_unix: parsed.unix,
                  post_at_iso: parsed.iso,
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
    'slack_list_scheduled_messages',
    {
      description:
        'Lists pending scheduled messages via chat.scheduledMessages.list. Returns scheduled_message_id, channel_id, post_at (Unix and ISO), and a text preview. ' +
        'Optionally filter by channel and a Unix-seconds time range. Cursor-paginated.',
      inputSchema: {
        channel_id: z.string().optional().describe('Limit results to this channel.'),
        oldest: z.number().optional().describe('Unix seconds — only messages scheduled at or after this time.'),
        latest: z.number().optional().describe('Unix seconds — only messages scheduled at or before this time.'),
        cursor: z.string().optional().describe('Pagination cursor from a previous response.'),
        limit: z
          .number()
          .int()
          .positive()
          .max(1000)
          .optional()
          .describe('Max items per page (1–1000, default 100).'),
      },
      annotations: READ_ONLY,
    },
    async ({ channel_id, oldest, latest, cursor, limit }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        const args: Record<string, unknown> = {};
        if (channel_id) args.channel = channel_id;
        if (oldest !== undefined) args.oldest = oldest;
        if (latest !== undefined) args.latest = latest;
        if (cursor) args.cursor = cursor;
        if (limit !== undefined) args.limit = limit;
        const r = await slack.chat.scheduledMessages.list(
          args as unknown as Parameters<typeof slack.chat.scheduledMessages.list>[0],
        );
        const raw = (r.scheduled_messages ?? []) as unknown[];
        const messages = raw.map((m) => {
          const sm = (m ?? {}) as Record<string, unknown>;
          const post_at = typeof sm.post_at === 'number' ? sm.post_at : null;
          const out: Record<string, unknown> = {
            id: sm.id ?? null,
            channel_id: sm.channel_id ?? null,
            post_at_unix: post_at,
            text_preview:
              typeof sm.text === 'string'
                ? sm.text.length > 80
                  ? sm.text.slice(0, 80) + '…'
                  : sm.text
                : '',
          };
          if (post_at) out.post_at_iso = new Date(post_at * 1000).toISOString();
          return out;
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  count: messages.length,
                  messages,
                  next_cursor: r.response_metadata?.next_cursor ?? null,
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
    'slack_delete_scheduled_message',
    {
      description:
        'Cancels a pending scheduled message via chat.deleteScheduledMessage. DESTRUCTIVE — once cancelled, the message will not be sent and this cannot be undone. ' +
        'Use slack_list_scheduled_messages to find the scheduled_message_id.',
      inputSchema: {
        channel_id: z.string().min(1).describe('Channel where the message is scheduled.'),
        scheduled_message_id: z
          .string()
          .min(1)
          .describe(
            'The scheduled_message_id from slack_schedule_message or slack_list_scheduled_messages.',
          ),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ channel_id, scheduled_message_id }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        await slack.chat.deleteScheduledMessage({
          channel: channel_id,
          scheduled_message_id,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ok: true,
                  cancelled_scheduled_message_id: scheduled_message_id,
                  channel: channel_id,
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
