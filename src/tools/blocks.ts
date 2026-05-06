import { z } from 'zod';

const BlockSchema = z
  .record(z.string(), z.unknown())
  .refine((b) => typeof b.type === 'string', {
    message: "Each block must have a string 'type' field (e.g. 'header', 'section', 'divider').",
  });

export const BlocksSchema = z.array(BlockSchema).max(50);

export const BLOCK_KIT_REFERENCE =
  `Block Kit cheat sheet (full reference: skills/slack/references/block-kit.md):
- Block types: header, section (with optional fields[] grid + accessory), divider, actions (buttons / selects), image, context, input (modals only).
- Text objects: { type: 'plain_text', text: '...' } for literals; { type: 'mrkdwn', text: '*bold* _italic_ <url|label> <@U123>' } for formatting. Headers/buttons/labels require plain_text.
- ALWAYS pass a top-level 'text' fallback alongside 'blocks' — used for notifications + accessibility; Slack warns without it.
- Limits: max 50 blocks, 3000 chars/section, 10 fields, 25 buttons. Preview at https://app.slack.com/block-kit-builder.`;
