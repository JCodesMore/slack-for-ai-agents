import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { formatSlackError, getWebClient } from '../client.js';
import { activeWorkspaceGuard } from '../guards.js';
import { BlocksSchema, BLOCK_KIT_REFERENCE } from './blocks.js';

const MUTATING = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
} as const;

const DESTRUCTIVE = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: true,
} as const;

type SlackMessage = Record<string, unknown>;

function formatMessage(
  m: SlackMessage | undefined | null,
  fallbackChannel: string | undefined | null,
): Record<string, unknown> {
  const msg = (m ?? {}) as SlackMessage;
  const out: Record<string, unknown> = {
    ts: msg.ts ?? null,
    channel: fallbackChannel ?? null,
    text: typeof msg.text === 'string' ? msg.text : '',
  };
  if (msg.user !== undefined) out.user = msg.user;
  if (msg.bot_id !== undefined) out.bot_id = msg.bot_id;
  if (msg.thread_ts !== undefined) out.thread_ts = msg.thread_ts;
  if (msg.subtype !== undefined) out.subtype = msg.subtype;
  if (Array.isArray(msg.blocks)) out.block_count = (msg.blocks as unknown[]).length;
  if (Array.isArray(msg.files)) out.file_count = (msg.files as unknown[]).length;
  if (typeof msg.ts === 'string') {
    const sec = Number(msg.ts.split('.')[0]);
    if (Number.isFinite(sec) && sec > 0) {
      out.posted_at = new Date(sec * 1000).toISOString();
    }
  }
  return out;
}

function emptyBodyError() {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: 'Pass at least one of `text` or `blocks` — Slack rejects empty messages.',
      },
    ],
  };
}

function normalizeEmojiName(input: string): string {
  return input.trim().replace(/^:+|:+$/g, '');
}

export function registerMessageTools(server: McpServer): void {
  server.registerTool(
    'slack_post_message',
    {
      description:
        `Posts a message to a channel or DM (chat.postMessage). Pass plain \`text\`, Block Kit \`blocks\`, or both — when blocks are present, text serves as the notification fallback. To reply in a thread, set \`thread_ts\` to the parent message's ts. Requires \`chat:write\`; the bot must be a member of private channels (use \`chat:write.public\` to post to any public channel without joining).\n\n${BLOCK_KIT_REFERENCE}`,
      inputSchema: {
        channel_id: z
          .string()
          .min(1)
          .describe('Channel ID (C...), private channel ID (G...), or user ID (U...) for a DM.'),
        text: z
          .string()
          .optional()
          .describe(
            'Plain text body. With blocks, this is the notification/screenreader fallback (still recommended).',
          ),
        blocks: BlocksSchema
          .optional()
          .describe('Block Kit array (max 50 blocks). See block reference in description.'),
        thread_ts: z
          .string()
          .optional()
          .describe("Parent message ts to reply in a thread (e.g. '1700000000.000100')."),
        reply_broadcast: z
          .boolean()
          .optional()
          .describe('When replying in a thread, also post to the main channel (default false).'),
        unfurl_links: z
          .boolean()
          .optional()
          .describe('Auto-preview links in the message body.'),
        unfurl_media: z
          .boolean()
          .optional()
          .describe('Auto-preview media URLs in the message body.'),
        mrkdwn: z
          .boolean()
          .optional()
          .describe("When false, disables Slack markdown parsing on the `text` field (default true)."),
      },
      annotations: MUTATING,
    },
    async ({
      channel_id,
      text,
      blocks,
      thread_ts,
      reply_broadcast,
      unfurl_links,
      unfurl_media,
      mrkdwn,
    }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      if (!text && (!blocks || blocks.length === 0)) return emptyBodyError();
      try {
        const slack = getWebClient();
        const args: Record<string, unknown> = {
          channel: channel_id,
          text: text ?? ' ',
        };
        if (blocks) args.blocks = blocks;
        if (thread_ts) args.thread_ts = thread_ts;
        if (reply_broadcast !== undefined) args.reply_broadcast = reply_broadcast;
        if (unfurl_links !== undefined) args.unfurl_links = unfurl_links;
        if (unfurl_media !== undefined) args.unfurl_media = unfurl_media;
        if (mrkdwn !== undefined) args.mrkdwn = mrkdwn;
        const r = await slack.chat.postMessage(args as unknown as Parameters<typeof slack.chat.postMessage>[0]);
        const channel = (r.channel as string | undefined) ?? channel_id;
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ok: true,
                  ts: r.ts ?? null,
                  channel,
                  message: formatMessage(r.message as SlackMessage | undefined, channel),
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
    'slack_post_ephemeral_message',
    {
      description:
        "Posts a message visible only to one user (chat.postEphemeral). Useful for private replies in a public channel — the user sees it; nobody else does. Disappears when they close the channel. Cannot be edited or deleted via the API. Block Kit `blocks` accepted (see slack_post_message for the block-type reference). Requires `chat:write`.",
      inputSchema: {
        channel_id: z.string().min(1).describe('Channel ID where the ephemeral appears.'),
        user_id: z
          .string()
          .min(1)
          .describe('Slack user ID (U...) who alone will see the message.'),
        text: z.string().optional().describe('Plain text body / blocks fallback.'),
        blocks: BlocksSchema.optional().describe('Block Kit array (max 50 blocks).'),
        thread_ts: z
          .string()
          .optional()
          .describe('Parent message ts to surface the ephemeral inside a thread.'),
      },
      annotations: MUTATING,
    },
    async ({ channel_id, user_id, text, blocks, thread_ts }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      if (!text && (!blocks || blocks.length === 0)) return emptyBodyError();
      try {
        const slack = getWebClient();
        const args: Record<string, unknown> = {
          channel: channel_id,
          user: user_id,
          text: text ?? ' ',
        };
        if (blocks) args.blocks = blocks;
        if (thread_ts) args.thread_ts = thread_ts;
        const r = await slack.chat.postEphemeral(args as unknown as Parameters<typeof slack.chat.postEphemeral>[0]);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ok: true,
                  ts: r.message_ts ?? null,
                  channel: channel_id,
                  user: user_id,
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
    'slack_update_message',
    {
      description:
        "Edits a previously posted message (chat.update). The bot can only update messages it sent itself. Pass the full new content — `text` and `blocks` REPLACE what was there, they don't merge. To remove all blocks, pass `blocks: []`. Block Kit `blocks` accepted (see slack_post_message for the block-type reference). Requires `chat:write`.",
      inputSchema: {
        channel_id: z.string().min(1).describe('Channel ID where the message lives.'),
        ts: z
          .string()
          .min(1)
          .describe("Message ts (timestamp ID, e.g. '1700000000.000100'). Returned by slack_post_message."),
        text: z.string().optional().describe('New plain text body / blocks fallback.'),
        blocks: BlocksSchema
          .optional()
          .describe('New Block Kit array. Pass [] to clear all blocks.'),
      },
      annotations: MUTATING,
    },
    async ({ channel_id, ts, text, blocks }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      if (text === undefined && blocks === undefined) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: 'Pass `text` and/or `blocks` — at least one field must change.',
            },
          ],
        };
      }
      try {
        const slack = getWebClient();
        const args: Record<string, unknown> = {
          channel: channel_id,
          ts,
          text: text ?? ' ',
        };
        if (blocks !== undefined) args.blocks = blocks;
        const r = await slack.chat.update(args as unknown as Parameters<typeof slack.chat.update>[0]);
        const channel = (r.channel as string | undefined) ?? channel_id;
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ok: true,
                  ts: r.ts ?? ts,
                  channel,
                  message: formatMessage(r.message as SlackMessage | undefined, channel),
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
    'slack_delete_message',
    {
      description:
        "Permanently deletes a message (chat.delete). The bot can only delete messages it sent itself (workspace admins can delete any message via `chat:write` + admin scopes). Cannot be undone — the message is gone immediately for all viewers.",
      inputSchema: {
        channel_id: z.string().min(1),
        ts: z.string().min(1).describe('Message ts to delete.'),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ channel_id, ts }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        const r = await slack.chat.delete({ channel: channel_id, ts });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { ok: true, deleted: { channel: r.channel ?? channel_id, ts: r.ts ?? ts } },
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
    'slack_pin_message',
    {
      description:
        "Pins a message to a channel (pins.add). Pinned messages are surfaced in the channel's pin list. The bot must be a member of the channel. Reversible via slack_unpin_message. Requires `pins:write`.",
      inputSchema: {
        channel_id: z.string().min(1),
        ts: z.string().min(1).describe('Message ts to pin.'),
      },
      annotations: MUTATING,
    },
    async ({ channel_id, ts }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        await slack.pins.add({ channel: channel_id, timestamp: ts });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, pinned: { channel: channel_id, ts } }, null, 2),
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
    'slack_unpin_message',
    {
      description:
        "Removes a pin from a message (pins.remove). The message itself stays — only the pin is removed. Requires `pins:write`.",
      inputSchema: {
        channel_id: z.string().min(1),
        ts: z.string().min(1).describe('Pinned message ts to unpin.'),
      },
      annotations: MUTATING,
    },
    async ({ channel_id, ts }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        await slack.pins.remove({ channel: channel_id, timestamp: ts });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, unpinned: { channel: channel_id, ts } }, null, 2),
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
    'slack_add_reaction',
    {
      description:
        "Adds the bot's emoji reaction to a message (reactions.add). Pass the emoji name without colons — 'thumbsup' not ':thumbsup:'. Custom workspace emoji work too. The bot must be in the channel. Requires `reactions:write`.",
      inputSchema: {
        channel_id: z.string().min(1),
        ts: z.string().min(1).describe('Message ts to react to.'),
        emoji_name: z
          .string()
          .min(1)
          .describe("Emoji name without colons (e.g. 'thumbsup', 'eyes', 'tada'). Custom emoji also accepted."),
      },
      annotations: MUTATING,
    },
    async ({ channel_id, ts, emoji_name }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      const name = normalizeEmojiName(emoji_name);
      if (!name) {
        return {
          isError: true,
          content: [
            { type: 'text' as const, text: 'emoji_name was empty after stripping colons.' },
          ],
        };
      }
      try {
        const slack = getWebClient();
        await slack.reactions.add({ channel: channel_id, timestamp: ts, name });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { ok: true, reaction: { channel: channel_id, ts, name } },
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
