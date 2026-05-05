import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { formatSlackError, getWebClient } from '../client.js';
import { tokenGuard } from '../guards.js';

const ESCAPE_HATCH = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: true,
} as const;

const SLACK_METHOD_PATTERN = /^[a-z]+(\.[a-zA-Z]+)+$/;

export function registerRawTool(server: McpServer): void {
  server.registerTool(
    'slack_raw_api_call',
    {
      description:
        "Escape hatch for any Slack Web API method not covered by a dedicated tool — e.g. team.info, files.list, files.upload, search.messages, dnd.setSnooze, bookmarks.add, admin.* (when an admin user token is configured). Wraps WebClient.apiCall(method, args). The configured bot token is sent automatically. " +
        "Method must be the dotted name (e.g. 'team.info' or 'admin.users.list') — no leading slash, no API host prefix. Args are passed verbatim to the SDK. " +
        'Marked DESTRUCTIVE because the bot cannot tell from the method name alone whether the call reads or mutates — the user should confirm risky calls. ' +
        'Prefer dedicated tools where they exist (channels, usergroups, messages, scheduling, canvases, users, webhooks) — those carry input validation and friendlier output shaping. Browse all methods at https://api.slack.com/methods.',
      inputSchema: {
        method: z
          .string()
          .min(1)
          .describe(
            "Slack method name in dotted form, e.g. 'team.info', 'files.list', 'admin.users.list'. No leading slash, no API host.",
          ),
        args: z
          .record(z.string(), z.any())
          .optional()
          .describe(
            'Arguments to pass to the Slack method. Pass an object of key/value pairs (strings, numbers, booleans, arrays, or nested objects). Omit for methods that take no args.',
          ),
      },
      annotations: ESCAPE_HATCH,
    },
    async ({ method, args }) => {
      const guard = tokenGuard();
      if (guard) return guard;
      if (!SLACK_METHOD_PATTERN.test(method)) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `Invalid Slack method "${method}". Expected a dotted name like "team.info" or "admin.users.list" — letters and dots only, no leading slash, no host.`,
            },
          ],
        };
      }
      try {
        const slack = getWebClient();
        const result = await slack.apiCall(method, (args ?? {}) as Record<string, unknown>);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, method, result }, null, 2),
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
