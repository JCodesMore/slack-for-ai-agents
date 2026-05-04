import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { formatSlackError, getWebClient } from '../client.js';
import { activeWorkspaceGuard } from '../guards.js';

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
} as const;

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

type SlackChannel = Record<string, unknown> & {
  topic?: { value?: string };
  purpose?: { value?: string };
};

function formatChannel(c: SlackChannel | undefined | null): Record<string, unknown> {
  const ch = (c ?? {}) as SlackChannel;
  const out: Record<string, unknown> = {
    id: ch.id ?? null,
    name: ch.name ?? null,
    is_private: ch.is_private ?? false,
    is_archived: ch.is_archived ?? false,
    is_general: ch.is_general ?? false,
    is_member: ch.is_member ?? false,
  };
  if (ch.num_members !== undefined) out.num_members = ch.num_members;
  if (ch.topic?.value !== undefined) out.topic = ch.topic.value;
  if (ch.purpose?.value !== undefined) out.purpose = ch.purpose.value;
  if (ch.creator !== undefined) out.creator = ch.creator;
  if (typeof ch.created === 'number') {
    out.created = new Date(ch.created * 1000).toISOString();
  }
  return out;
}

export function registerChannelTools(server: McpServer): void {
  server.registerTool(
    'slack_list_channels',
    {
      description:
        "Lists channels in the active workspace (conversations.list). Returns id, name, is_private, is_archived, is_member (whether the bot is in the channel), num_members, topic, and purpose. Cursor pagination — pass `cursor` from a prior response's `next_cursor` to fetch the next page. By default returns public+private channels and excludes archived.",
      inputSchema: {
        types: z
          .array(z.enum(['public_channel', 'private_channel']))
          .optional()
          .describe(
            "Channel types to include. Default: both. 'private_channel' requires the `groups:read` scope; 'public_channel' requires `channels:read`.",
          ),
        exclude_archived: z
          .boolean()
          .optional()
          .describe('Hide archived channels (default true).'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(999)
          .optional()
          .describe('Page size (default 200, max 999). Slack recommends 200.'),
        cursor: z
          .string()
          .optional()
          .describe("Pagination cursor from a prior response's next_cursor."),
      },
      annotations: READ_ONLY,
    },
    async ({ types, exclude_archived, limit, cursor }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        const r = await slack.conversations.list({
          types: (types ?? ['public_channel', 'private_channel']).join(','),
          exclude_archived: exclude_archived ?? true,
          limit: limit ?? 200,
          cursor,
        });
        const channels = (r.channels ?? []) as SlackChannel[];
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  count: channels.length,
                  next_cursor: r.response_metadata?.next_cursor || null,
                  channels: channels.map(formatChannel),
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
    'slack_create_channel',
    {
      description:
        "Creates a channel in the active workspace (conversations.create). Slack normalizes names: lowercased, spaces become hyphens, no periods, max 80 chars. Bot needs `channels:manage` (public) or `groups:write` (private). To set topic/purpose afterwards, call slack_set_channel_topic / slack_set_channel_purpose.",
      inputSchema: {
        name: z
          .string()
          .min(1)
          .max(80)
          .describe('Channel name. Max 80 chars; Slack lowercases and replaces spaces/periods with hyphens.'),
        is_private: z
          .boolean()
          .optional()
          .describe('Create as a private channel (default false).'),
      },
      annotations: MUTATING,
    },
    async ({ name, is_private }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        const r = await slack.conversations.create({
          name,
          is_private: is_private ?? false,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { ok: true, channel: formatChannel(r.channel as SlackChannel | undefined) },
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
    'slack_archive_channel',
    {
      description:
        "Archives a channel (conversations.archive). Reversible via slack_unarchive_channel. Members are removed but message history is preserved. Cannot archive #general or the workspace's last remaining channel.",
      inputSchema: {
        channel_id: z
          .string()
          .min(1)
          .describe('Channel ID (e.g. C123ABC). Get via slack_list_channels.'),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ channel_id }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        await slack.conversations.archive({ channel: channel_id });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, archived: channel_id }, null, 2),
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
    'slack_unarchive_channel',
    {
      description:
        "Reverses slack_archive_channel (conversations.unarchive). Returns the channel to the active list. Members must be re-invited via slack_invite_to_channel.",
      inputSchema: {
        channel_id: z.string().min(1).describe('Channel ID to unarchive.'),
      },
      annotations: MUTATING,
    },
    async ({ channel_id }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        await slack.conversations.unarchive({ channel: channel_id });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, unarchived: channel_id }, null, 2),
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
    'slack_rename_channel',
    {
      description:
        "Renames a channel (conversations.rename). Same name-normalization rules as create: lowercase, no spaces/periods, max 80 chars.",
      inputSchema: {
        channel_id: z.string().min(1),
        name: z
          .string()
          .min(1)
          .max(80)
          .describe('New channel name. Slack normalizes (lowercase, hyphens for spaces).'),
      },
      annotations: MUTATING,
    },
    async ({ channel_id, name }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        const r = await slack.conversations.rename({ channel: channel_id, name });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { ok: true, channel: formatChannel(r.channel as SlackChannel | undefined) },
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
    'slack_set_channel_topic',
    {
      description:
        "Sets the channel topic — the short header line shown next to the channel name (conversations.setTopic). Max 250 chars. Distinct from purpose (which is the longer 'what is this channel for' description).",
      inputSchema: {
        channel_id: z.string().min(1),
        topic: z.string().max(250).describe('New topic. Empty string clears it.'),
      },
      annotations: MUTATING,
    },
    async ({ channel_id, topic }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        const r = await slack.conversations.setTopic({ channel: channel_id, topic });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { ok: true, channel: formatChannel(r.channel as SlackChannel | undefined) },
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
    'slack_set_channel_purpose',
    {
      description:
        "Sets the channel purpose — the longer description shown in the channel details pane (conversations.setPurpose). Max 250 chars. Distinct from topic.",
      inputSchema: {
        channel_id: z.string().min(1),
        purpose: z.string().max(250).describe('New purpose. Empty string clears it.'),
      },
      annotations: MUTATING,
    },
    async ({ channel_id, purpose }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        const r = await slack.conversations.setPurpose({ channel: channel_id, purpose });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { ok: true, channel: formatChannel(r.channel as SlackChannel | undefined) },
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
    'slack_invite_to_channel',
    {
      description:
        "Adds users to a channel (conversations.invite). Pass an array of user IDs (max 1000). The bot must be a member of the channel; if it isn't, call slack_join_channel first (public channels) or have someone invite the bot (private channels).",
      inputSchema: {
        channel_id: z.string().min(1),
        user_ids: z
          .array(z.string().min(1))
          .min(1)
          .max(1000)
          .describe('Slack user IDs (e.g. ["U123", "U456"]). Max 1000 per call.'),
      },
      annotations: MUTATING,
    },
    async ({ channel_id, user_ids }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        const r = await slack.conversations.invite({
          channel: channel_id,
          users: user_ids.join(','),
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ok: true,
                  channel: formatChannel(r.channel as SlackChannel | undefined),
                  invited: user_ids,
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
    'slack_kick_from_channel',
    {
      description:
        "Removes a single user from a channel (conversations.kick). The bot must be a member of the channel. Cannot remove someone from #general.",
      inputSchema: {
        channel_id: z.string().min(1),
        user_id: z.string().min(1).describe('Slack user ID to remove (e.g. U123).'),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ channel_id, user_id }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        await slack.conversations.kick({ channel: channel_id, user: user_id });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { ok: true, channel_id, kicked_user_id: user_id },
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
    'slack_join_channel',
    {
      description:
        "The bot joins a public channel (conversations.join). Required before posting to a channel the bot isn't already in (or grant the `chat:write.public` scope to post to any public channel without joining). Cannot join private channels — must be invited.",
      inputSchema: {
        channel_id: z.string().min(1).describe('Public channel ID for the bot to join.'),
      },
      annotations: MUTATING,
    },
    async ({ channel_id }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        const r = await slack.conversations.join({ channel: channel_id });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ok: true,
                  channel: formatChannel(r.channel as SlackChannel | undefined),
                  warning: r.warning ?? null,
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
    'slack_leave_channel',
    {
      description:
        "The bot leaves a channel (conversations.leave). It can no longer post to or read from the channel until it rejoins or is reinvited. Cannot leave #general.",
      inputSchema: {
        channel_id: z.string().min(1),
      },
      annotations: MUTATING,
    },
    async ({ channel_id }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        await slack.conversations.leave({ channel: channel_id });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, left: channel_id }, null, 2),
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
