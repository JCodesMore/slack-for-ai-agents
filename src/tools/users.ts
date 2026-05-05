import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { formatSlackError, getWebClient } from '../client.js';
import { activeWorkspaceGuard } from '../guards.js';

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
} as const;

type SlackUser = Record<string, unknown> & {
  profile?: Record<string, unknown>;
};

function formatUser(u: SlackUser | undefined | null): Record<string, unknown> {
  const user = (u ?? {}) as SlackUser;
  const profile = (user.profile ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {
    id: user.id ?? null,
    name: user.name ?? null,
    real_name: user.real_name ?? profile.real_name ?? null,
    display_name: profile.display_name ?? null,
    is_bot: user.is_bot ?? false,
    is_app_user: user.is_app_user ?? false,
    deleted: user.deleted ?? false,
    is_admin: user.is_admin ?? false,
    is_owner: user.is_owner ?? false,
    is_primary_owner: user.is_primary_owner ?? false,
    is_restricted: user.is_restricted ?? false,
    is_ultra_restricted: user.is_ultra_restricted ?? false,
  };
  if (user.team_id !== undefined) out.team_id = user.team_id;
  if (profile.email !== undefined) out.email = profile.email;
  if (profile.title !== undefined && profile.title !== '') out.title = profile.title;
  if (profile.status_text !== undefined && profile.status_text !== '')
    out.status_text = profile.status_text;
  if (profile.status_emoji !== undefined && profile.status_emoji !== '')
    out.status_emoji = profile.status_emoji;
  if (user.tz !== undefined) out.tz = user.tz;
  if (user.tz_label !== undefined) out.tz_label = user.tz_label;
  if (typeof user.updated === 'number' && user.updated > 0) {
    out.updated_at = new Date(user.updated * 1000).toISOString();
  }
  return out;
}

function formatProfile(p: Record<string, unknown> | undefined | null): Record<string, unknown> {
  const profile = (p ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of [
    'real_name',
    'display_name',
    'real_name_normalized',
    'display_name_normalized',
    'email',
    'phone',
    'title',
    'skype',
    'first_name',
    'last_name',
    'pronouns',
    'status_text',
    'status_emoji',
    'image_72',
    'image_192',
    'image_512',
    'image_original',
  ]) {
    if (profile[key] !== undefined && profile[key] !== '') out[key] = profile[key];
  }
  if (typeof profile.status_expiration === 'number') {
    out.status_expiration =
      profile.status_expiration === 0
        ? null
        : new Date(profile.status_expiration * 1000).toISOString();
  }
  if (profile.fields !== undefined && profile.fields !== null) out.fields = profile.fields;
  return out;
}

export function registerUserTools(server: McpServer): void {
  server.registerTool(
    'slack_list_users',
    {
      description:
        "Lists members of the active workspace (users.list). Cursor-paginated — pass `cursor` from a prior response's `next_cursor` to fetch the next page. Returns id, name, real_name, display_name, admin/owner/guest flags, deleted state, email (when `users:read.email` is granted), title, status, and tz. Set `filter_deleted=true` to strip deactivated accounts client-side. Requires `users:read`. Note: bot tokens cannot invite or remove workspace members — those endpoints (admin.users.invite / admin.users.remove) require an admin user token (xoxp-), which this plugin does not expose a config field for yet.",
      inputSchema: {
        cursor: z
          .string()
          .optional()
          .describe("Pagination cursor from a prior response's next_cursor."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(999)
          .optional()
          .describe('Page size (default 100, max 999). Slack recommends ≤200 for large workspaces.'),
        include_locale: z
          .boolean()
          .optional()
          .describe('Include each user’s locale field (default false).'),
        filter_deleted: z
          .boolean()
          .optional()
          .describe('Client-side: drop deactivated accounts before returning (default false).'),
      },
      annotations: READ_ONLY,
    },
    async ({ cursor, limit, include_locale, filter_deleted }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        const args: Record<string, unknown> = {};
        if (cursor) args.cursor = cursor;
        if (limit !== undefined) args.limit = limit;
        if (include_locale !== undefined) args.include_locale = include_locale;
        const r = await slack.users.list(
          args as unknown as Parameters<typeof slack.users.list>[0],
        );
        let members = (r.members ?? []) as SlackUser[];
        if (filter_deleted) members = members.filter((m) => !m.deleted);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  count: members.length,
                  next_cursor: r.response_metadata?.next_cursor || null,
                  users: members.map(formatUser),
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
    'slack_get_user',
    {
      description:
        "Fetches a single user by ID (users.info). Returns the same shape as slack_list_users entries. Use this when you already have a user_id and need their flags / profile / tz without paging the full directory. Requires `users:read` (and `users:read.email` to receive the email field).",
      inputSchema: {
        user_id: z.string().min(1).describe('Slack user ID (U... or W...).'),
        include_locale: z
          .boolean()
          .optional()
          .describe('Include the user’s locale field (default false).'),
      },
      annotations: READ_ONLY,
    },
    async ({ user_id, include_locale }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        const args: Record<string, unknown> = { user: user_id };
        if (include_locale !== undefined) args.include_locale = include_locale;
        const r = await slack.users.info(
          args as unknown as Parameters<typeof slack.users.info>[0],
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { ok: true, user: formatUser(r.user as SlackUser | undefined) },
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
    'slack_lookup_user_by_email',
    {
      description:
        "Looks up a user by email address (users.lookupByEmail). Useful for reconciling external systems → Slack IDs (e.g. 'find @subs@sparkn.com in this workspace'). Returns the matching user, or surfaces a `users_not_found` Slack error if no account uses that email. Requires `users:read.email`.",
      inputSchema: {
        email: z
          .string()
          .min(3)
          .describe('Email address registered to a Slack account in this workspace.'),
      },
      annotations: READ_ONLY,
    },
    async ({ email }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        const r = await slack.users.lookupByEmail({ email });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { ok: true, user: formatUser(r.user as SlackUser | undefined) },
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
    'slack_get_user_profile',
    {
      description:
        "Fetches a user's full profile (users.profile.get). Returns more fields than slack_get_user — including custom workspace profile fields (Xf...), phone, pronouns, full status with expiration timestamp, and the high-res image URLs. Omit user_id to fetch the bot's own profile. Requires `users.profile:read` (and `users:read.email` for the email field).",
      inputSchema: {
        user_id: z
          .string()
          .optional()
          .describe("User ID (U...). Defaults to the authenticated bot's own profile if omitted."),
        include_labels: z
          .boolean()
          .optional()
          .describe('Include human-readable labels for custom fields (default false).'),
      },
      annotations: READ_ONLY,
    },
    async ({ user_id, include_labels }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        const args: Record<string, unknown> = {};
        if (user_id) args.user = user_id;
        if (include_labels !== undefined) args.include_labels = include_labels;
        const r = await slack.users.profile.get(
          args as unknown as Parameters<typeof slack.users.profile.get>[0],
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ok: true,
                  profile: formatProfile(r.profile as Record<string, unknown> | undefined),
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
