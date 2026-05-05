import { z } from 'zod';

const BlockSchema = z
  .record(z.string(), z.unknown())
  .refine((b) => typeof b.type === 'string', {
    message: "Each block must have a string 'type' field (e.g. 'header', 'section', 'divider').",
  });

export const BlocksSchema = z.array(BlockSchema).max(50);

export const BLOCK_KIT_REFERENCE =
  `Block Kit blocks (https://api.slack.com/reference/block-kit/blocks). Pass an array of these objects:

- header: { type: 'header', text: { type: 'plain_text', text: '...' } } — bold heading line.
- section: { type: 'section', text: { type: 'mrkdwn', text: '*bold* _italic_ <url|link>' } } — main content. Optional 'fields' (array of text objects, rendered as 2-col key/value grid, max 10). Optional 'accessory' (image | button | overflow | static_select | datepicker).
- divider: { type: 'divider' } — horizontal line.
- actions: { type: 'actions', elements: [...] } — row of interactive elements. Buttons: { type: 'button', text: { type: 'plain_text', text: 'Click' }, action_id: 'btn_1', url?, value?, style?: 'primary'|'danger' }. Also: static_select, datepicker, overflow, etc.
- image: { type: 'image', image_url: 'https://...', alt_text: '...', title?: { type: 'plain_text', text: '...' } } — standalone image.
- context: { type: 'context', elements: [...] } — small italic byline; mix mrkdwn text + tiny images.
- input: { type: 'input', label: { type: 'plain_text', text: '...' }, element: {...} } — for modals / Home tabs (not regular channel messages).

Text objects come in two flavors:
- { type: 'plain_text', text: '...', emoji?: true } — literal text; emoji shortcodes auto-convert when emoji=true.
- { type: 'mrkdwn', text: '...' } — Slack markdown: *bold* _italic_ ~strike~ \`code\`, <https://url|label>, <@U123> mentions, <#C123> channel links, <!channel> / <!here>.

ALWAYS pass a top-level 'text' fallback alongside blocks — it's used in notifications and accessibility readers, and Slack will warn without it.

Preview blocks visually at https://app.slack.com/block-kit-builder before posting.`;
