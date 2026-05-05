import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BlocksSchema } from './blocks.js';

const MUTATING = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
} as const;

const SLACK_WEBHOOK_HOST = 'https://hooks.slack.com/';

const WEBHOOK_SETUP_DOCS = [
  'Setup steps (one-time per channel — done in the Slack app dashboard, NOT via API):',
  '  1. Open https://api.slack.com/apps and pick your app (or create one).',
  '  2. Go to **Features → Incoming Webhooks** → toggle **Activate Incoming Webhooks** on.',
  '  3. Click **Add New Webhook to Workspace** at the bottom → choose the destination channel → **Allow**.',
  '  4. Copy the resulting URL — it starts with `https://hooks.slack.com/services/T.../B.../...`.',
  '  5. Pass that URL as `webhook_url` to this tool. The URL itself authorizes posting to its single bound channel — no bot scope, no channel membership required.',
  '',
  'Each webhook URL is permanently bound to one channel; posting to a different channel needs a new webhook. Treat URLs as secrets — anyone who has one can post to that channel.',
].join('\n');

export function registerWebhookTools(server: McpServer): void {
  server.registerTool(
    'slack_post_via_webhook',
    {
      description:
        "Posts a message via a Slack incoming webhook URL. The URL itself is the credential — no bot scope or channel membership is required, and the bot token is NOT used. Each webhook is bound to a single channel chosen at creation time. " +
        'Body can be plain text, Block Kit `blocks`, or both (text serves as the notification fallback when blocks are present). ' +
        '`username`, `icon_emoji`, and `icon_url` override the sender appearance per call. ' +
        'Webhook URLs are NOT persisted by this plugin — pass one per call. Treat them as secrets.\n\n' +
        WEBHOOK_SETUP_DOCS,
      inputSchema: {
        webhook_url: z
          .string()
          .url()
          .describe(
            'Incoming webhook URL (https://hooks.slack.com/services/T.../B.../...). See description for setup walkthrough.',
          ),
        text: z.string().optional().describe('Plain text body / blocks fallback.'),
        blocks: BlocksSchema.optional().describe(
          'Block Kit array (max 50 blocks). Same shapes as slack_post_message.',
        ),
        username: z
          .string()
          .optional()
          .describe("Override the webhook's default sender name for this message only."),
        icon_emoji: z
          .string()
          .optional()
          .describe("Override the icon with an emoji name (e.g. ':robot_face:')."),
        icon_url: z.string().url().optional().describe('Override the icon with an image URL.'),
      },
      annotations: MUTATING,
    },
    async ({ webhook_url, text, blocks, username, icon_emoji, icon_url }) => {
      if (!webhook_url.startsWith(SLACK_WEBHOOK_HOST)) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `webhook_url must start with ${SLACK_WEBHOOK_HOST} — got "${webhook_url}". Generate one at https://api.slack.com/apps → Incoming Webhooks.`,
            },
          ],
        };
      }
      if (!text && (!blocks || blocks.length === 0)) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: 'Pass at least one of `text` or `blocks` — Slack rejects empty webhook payloads.',
            },
          ],
        };
      }
      const payload: Record<string, unknown> = {};
      if (text !== undefined) payload.text = text;
      if (blocks !== undefined) payload.blocks = blocks;
      if (username !== undefined) payload.username = username;
      if (icon_emoji !== undefined) payload.icon_emoji = icon_emoji;
      if (icon_url !== undefined) payload.icon_url = icon_url;
      try {
        const response = await fetch(webhook_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = (await response.text()).trim();
        if (!response.ok || body !== 'ok') {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: `Webhook POST failed: HTTP ${response.status} ${response.statusText}${
                  body ? ` — ${body}` : ''
                }`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, status: response.status }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `Webhook POST error: ${(err as Error).message ?? String(err)}`,
            },
          ],
        };
      }
    },
  );
}
