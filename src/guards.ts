import { hasBotToken } from './client.js';
import { NoActiveWorkspaceError, getActiveWorkspaceId } from './state.js';

export function tokenGuard() {
  if (hasBotToken()) return null;
  return {
    isError: true as const,
    content: [
      {
        type: 'text' as const,
        text: 'Slack bot token is not configured. Tell the user: open `/plugin`, find **slack**, paste a bot token (xoxb-...) into the **Slack Bot Token** field, then **fully restart Claude Code**. Then run `/slack:setup`.',
      },
    ],
  };
}

export function activeWorkspaceGuard() {
  const tg = tokenGuard();
  if (tg) return tg;
  try {
    getActiveWorkspaceId();
    return null;
  } catch (err) {
    if (err instanceof NoActiveWorkspaceError) {
      return {
        isError: true as const,
        content: [
          {
            type: 'text' as const,
            text: 'No active Slack workspace is set. Run `/slack:setup` (it calls `slack_whoami`, which records the workspace identity).',
          },
        ],
      };
    }
    throw err;
  }
}
