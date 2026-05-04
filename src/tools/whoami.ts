import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { formatSlackError, getWebClient } from '../client.js';
import { patchState } from '../state.js';
import { tokenGuard } from '../guards.js';

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
} as const;

export function registerWhoamiTool(server: McpServer): void {
  server.registerTool(
    'slack_whoami',
    {
      description:
        "Verifies the configured Slack bot token by calling auth.test. Returns the bot's user_id and username, the workspace's team_id and team name, the workspace URL, and the bot's bot_id. Use this first when troubleshooting — it confirms the token works and which workspace it's installed in. Persists the workspace as the active workspace in plugin state.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const guard = tokenGuard();
      if (guard) return guard;
      try {
        const slack = getWebClient();
        const r = await slack.auth.test();
        const patch: Record<string, string> = {
          last_verified_at: new Date().toISOString(),
        };
        if (r.team_id) patch.active_workspace_id = r.team_id;
        if (r.team) patch.active_workspace_name = r.team;
        if (r.user_id) patch.bot_user_id = r.user_id;
        if (r.user) patch.bot_username = r.user;
        patchState(patch);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ok: true,
                  bot: {
                    user_id: r.user_id,
                    username: r.user,
                    bot_id: r.bot_id,
                  },
                  team: {
                    id: r.team_id,
                    name: r.team,
                    url: r.url,
                  },
                  is_enterprise_install: r.is_enterprise_install ?? false,
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
          content: [
            {
              type: 'text' as const,
              text: formatSlackError(err),
            },
          ],
        };
      }
    },
  );
}
