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

type SlackUsergroup = Record<string, unknown> & {
  prefs?: { channels?: string[]; groups?: string[] };
};

function formatUsergroup(g: SlackUsergroup | undefined | null): Record<string, unknown> {
  const ug = (g ?? {}) as SlackUsergroup;
  const out: Record<string, unknown> = {
    id: ug.id ?? null,
    name: ug.name ?? null,
    handle: ug.handle ?? null,
    description: ug.description ?? '',
    is_disabled: typeof ug.date_delete === 'number' ? ug.date_delete !== 0 : false,
    is_external: ug.is_external ?? false,
  };
  if (ug.team_id !== undefined) out.team_id = ug.team_id;
  if (ug.created_by !== undefined) out.created_by = ug.created_by;
  if (ug.updated_by !== undefined) out.updated_by = ug.updated_by;
  if (ug.prefs?.channels) out.default_channels = ug.prefs.channels;
  if (typeof ug.date_create === 'number' && ug.date_create > 0) {
    out.created_at = new Date(ug.date_create * 1000).toISOString();
  }
  if (typeof ug.date_update === 'number' && ug.date_update > 0) {
    out.updated_at = new Date(ug.date_update * 1000).toISOString();
  }
  if (typeof ug.date_delete === 'number' && ug.date_delete > 0) {
    out.disabled_at = new Date(ug.date_delete * 1000).toISOString();
  }
  if (ug.users !== undefined) out.users = ug.users;
  if (ug.user_count !== undefined) {
    const c =
      typeof ug.user_count === 'string' ? Number(ug.user_count) : (ug.user_count as number);
    out.user_count = Number.isFinite(c) ? c : ug.user_count;
  }
  return out;
}

export function registerUsergroupTools(server: McpServer): void {
  server.registerTool(
    'slack_list_usergroups',
    {
      description:
        "Lists user groups (subteams) in the active workspace (usergroups.list). Returns id, name, handle (the @mention), description, is_disabled, default_channels (auto-join channel IDs), and optionally user_count or full user lists. Note: user groups are a paid Slack feature (Pro / Business+ / Enterprise) — free workspaces get a `paid_teams_only` error. Requires `usergroups:read`.",
      inputSchema: {
        include_disabled: z
          .boolean()
          .optional()
          .describe('Include disabled groups (default false).'),
        include_count: z
          .boolean()
          .optional()
          .describe('Include user_count on each group (default false).'),
        include_users: z
          .boolean()
          .optional()
          .describe('Include the full users array on each group (default false). Slower for large groups.'),
      },
      annotations: READ_ONLY,
    },
    async ({ include_disabled, include_count, include_users }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        const r = await slack.usergroups.list({
          include_disabled: include_disabled ?? false,
          include_count: include_count ?? false,
          include_users: include_users ?? false,
        });
        const groups = (r.usergroups ?? []) as SlackUsergroup[];
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  count: groups.length,
                  usergroups: groups.map(formatUsergroup),
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
    'slack_create_usergroup',
    {
      description:
        "Creates a new user group (usergroups.create). The handle is the @-mention name (handle='ops' → @ops); names and handles must each be unique per workspace. Optionally seed default channels — Slack auto-adds new group members to those channels. Paid Slack feature. Requires `usergroups:write`.",
      inputSchema: {
        name: z
          .string()
          .min(1)
          .describe('Display name (e.g. "Operations Team").'),
        handle: z
          .string()
          .min(1)
          .max(21)
          .optional()
          .describe(
            '@-mention handle (e.g. "ops"). Lowercase letters/digits/hyphens, no spaces, max 21 chars. Slack derives one from `name` if omitted.',
          ),
        description: z
          .string()
          .max(140)
          .optional()
          .describe('Short description (max ~140 chars).'),
        channel_ids: z
          .array(z.string().min(1))
          .optional()
          .describe('Channel IDs new members of this group will be auto-added to. Pass [] to skip.'),
        include_count: z
          .boolean()
          .optional()
          .describe('Include user_count in the response (default false).'),
      },
      annotations: MUTATING,
    },
    async ({ name, handle, description, channel_ids, include_count }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        const r = await slack.usergroups.create({
          name,
          handle,
          description,
          channels: channel_ids ? channel_ids.join(',') : undefined,
          include_count: include_count ?? false,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { ok: true, usergroup: formatUsergroup(r.usergroup as SlackUsergroup | undefined) },
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
    'slack_update_usergroup',
    {
      description:
        "Updates a user group's name, handle, description, or default channels (usergroups.update). Pass only the fields to change. To replace the member list, use slack_update_usergroup_users instead. Requires `usergroups:write`.",
      inputSchema: {
        usergroup_id: z
          .string()
          .min(1)
          .describe('User group ID (e.g. S123ABC). Get via slack_list_usergroups.'),
        name: z.string().min(1).optional(),
        handle: z
          .string()
          .min(1)
          .max(21)
          .optional()
          .describe('New @-mention handle.'),
        description: z.string().max(140).optional(),
        channel_ids: z
          .array(z.string().min(1))
          .optional()
          .describe('New default channel IDs. REPLACES the existing list.'),
        include_count: z.boolean().optional(),
      },
      annotations: MUTATING,
    },
    async ({ usergroup_id, name, handle, description, channel_ids, include_count }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        const r = await slack.usergroups.update({
          usergroup: usergroup_id,
          name,
          handle,
          description,
          channels: channel_ids ? channel_ids.join(',') : undefined,
          include_count: include_count ?? false,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { ok: true, usergroup: formatUsergroup(r.usergroup as SlackUsergroup | undefined) },
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
    'slack_list_usergroup_users',
    {
      description:
        "Lists the user IDs in a user group (usergroups.users.list). Returns just the user IDs — resolve names via Phase 7 user tools. Requires `usergroups:read`.",
      inputSchema: {
        usergroup_id: z.string().min(1).describe('User group ID.'),
        include_disabled: z
          .boolean()
          .optional()
          .describe('Allow listing users of a disabled group (default false).'),
      },
      annotations: READ_ONLY,
    },
    async ({ usergroup_id, include_disabled }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        const r = await slack.usergroups.users.list({
          usergroup: usergroup_id,
          include_disabled: include_disabled ?? false,
        });
        const users = (r.users ?? []) as string[];
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { usergroup_id, count: users.length, users },
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
    'slack_update_usergroup_users',
    {
      description:
        "REPLACES the full user list of a group (usergroups.users.update). Pass the complete desired set, not a delta. To add or remove a single user, fetch the current list via slack_list_usergroup_users, modify it, and pass the modified list back. Requires `usergroups:write`.",
      inputSchema: {
        usergroup_id: z.string().min(1),
        user_ids: z
          .array(z.string().min(1))
          .describe('Complete list of user IDs to set as the group members. Pass [] to empty the group.'),
        include_count: z.boolean().optional(),
      },
      annotations: MUTATING,
    },
    async ({ usergroup_id, user_ids, include_count }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        const r = await slack.usergroups.users.update({
          usergroup: usergroup_id,
          users: user_ids.join(','),
          include_count: include_count ?? false,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { ok: true, usergroup: formatUsergroup(r.usergroup as SlackUsergroup | undefined) },
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
    'slack_disable_usergroup',
    {
      description:
        "Disables a user group (usergroups.disable). The @-mention stops working and the group disappears from the active list. Reversible via slack_enable_usergroup — members, channels, and settings are preserved. Requires `usergroups:write`.",
      inputSchema: {
        usergroup_id: z.string().min(1),
        include_count: z.boolean().optional(),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ usergroup_id, include_count }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        const r = await slack.usergroups.disable({
          usergroup: usergroup_id,
          include_count: include_count ?? false,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { ok: true, usergroup: formatUsergroup(r.usergroup as SlackUsergroup | undefined) },
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
    'slack_enable_usergroup',
    {
      description:
        "Re-enables a previously disabled user group (usergroups.enable). Restores the @-mention and active-list visibility. Requires `usergroups:write`.",
      inputSchema: {
        usergroup_id: z.string().min(1),
        include_count: z.boolean().optional(),
      },
      annotations: MUTATING,
    },
    async ({ usergroup_id, include_count }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        const r = await slack.usergroups.enable({
          usergroup: usergroup_id,
          include_count: include_count ?? false,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { ok: true, usergroup: formatUsergroup(r.usergroup as SlackUsergroup | undefined) },
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
