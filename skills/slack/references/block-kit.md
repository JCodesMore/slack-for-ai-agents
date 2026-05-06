# Block Kit reference

Reference for composing Slack Block Kit messages — the shape every block can take, when to reach for which one, and the gotchas that bite first-timers. Use this when building `blocks` arrays for `slack_post_message`, `slack_post_ephemeral_message`, `slack_update_message`, or `slack_schedule_message`.

Official: <https://api.slack.com/reference/block-kit/blocks>. Visual builder: <https://app.slack.com/block-kit-builder>.

## Block shapes

Every block has a `type`. Below are the shapes you'll use 95% of the time.

### `header` — bold heading line

```json
{ "type": "header", "text": { "type": "plain_text", "text": "Release notes — v0.1.1" } }
```

`text.type` MUST be `plain_text`. Mrkdwn isn't allowed in headers. Cap text at ~150 chars; longer headers visually wrap awkwardly.

### `section` — main content body

```json
{
  "type": "section",
  "text": { "type": "mrkdwn", "text": "*Bold* _italic_ ~strike~ `code`. <https://example.com|Link text>." }
}
```

The workhorse block. Optional add-ons:

- **`fields`** — array of text objects rendered as a 2-column key/value grid. Max 10 fields.

  ```json
  {
    "type": "section",
    "fields": [
      { "type": "mrkdwn", "text": "*Date*\n2026-05-06" },
      { "type": "mrkdwn", "text": "*Owner*\n@release-eng" }
    ]
  }
  ```

- **`accessory`** — one element rendered to the right (image | button | overflow | static_select | datepicker).

  ```json
  {
    "type": "section",
    "text": { "type": "mrkdwn", "text": "Approve this release?" },
    "accessory": {
      "type": "button",
      "text": { "type": "plain_text", "text": "Approve" },
      "action_id": "approve_release",
      "style": "primary"
    }
  }
  ```

### `divider` — horizontal line

```json
{ "type": "divider" }
```

Use to separate sections of a long message. Don't stack two in a row.

### `actions` — row of interactive elements

```json
{
  "type": "actions",
  "elements": [
    {
      "type": "button",
      "text": { "type": "plain_text", "text": "Approve" },
      "action_id": "btn_approve",
      "style": "primary",
      "value": "release-v0.1.1"
    },
    {
      "type": "button",
      "text": { "type": "plain_text", "text": "View diff" },
      "action_id": "btn_diff",
      "url": "https://github.com/org/repo/pull/123"
    }
  ]
}
```

Up to 25 elements per actions block. Buttons can be:

- `url` — opens link, no callback to the bot.
- `value` — sent back as a payload when clicked (requires the app to receive interactivity events; not handled by this plugin).
- `style: "primary"` (green) | `"danger"` (red) | omit for default.

Other element types: `static_select`, `multi_static_select`, `datepicker`, `timepicker`, `overflow`, `radio_buttons`, `checkboxes`.

### `image` — standalone image

```json
{
  "type": "image",
  "image_url": "https://example.com/banner.png",
  "alt_text": "Q2 launch banner",
  "title": { "type": "plain_text", "text": "Q2 Launch" }
}
```

`alt_text` is required. `title` is optional and shown above the image.

### `context` — small italic byline

```json
{
  "type": "context",
  "elements": [
    { "type": "image", "image_url": "https://example.com/avatar.png", "alt_text": "avatar" },
    { "type": "mrkdwn", "text": "Posted by *@release-eng* · <!date^1714900000^{date_short}|2026-05-06>" }
  ]
}
```

Up to 10 elements. Mix of mrkdwn and small images. Great for "posted by", timestamps, status badges.

### `input` — modal/Home form field

```json
{
  "type": "input",
  "label": { "type": "plain_text", "text": "What changed?" },
  "element": { "type": "plain_text_input", "action_id": "changelog_text", "multiline": true }
}
```

**Only valid in modals and Home tabs**, not regular channel messages. If you `slack_post_message` an `input` block, Slack rejects the call.

## Text objects

Two flavors — pick based on whether the field allows formatting.

### `plain_text`

```json
{ "type": "plain_text", "text": "literal text", "emoji": true }
```

No formatting. With `emoji: true`, shortcodes auto-convert (`:tada:` → 🎉). Required for: `header.text`, button text, `image.title`, image `alt_text`, input labels.

### `mrkdwn`

```json
{ "type": "mrkdwn", "text": "*bold* _italic_ ~strike~ `code` ```block```" }
```

Slack-flavored markdown. Supported syntax:

- `*bold*` `_italic_` `~strike~` `` `code` `` `` ```block``` ``
- Links: `<https://example.com|Click here>` (the `|label` is optional)
- User mentions: `<@U01ABC123>` — pings the user.
- Channel links: `<#C01ABC123>` or `<#C01ABC123|channel-name>` — clickable channel link.
- Group mentions: `<!subteam^S01ABC123|@team-leads>` — pings the usergroup.
- Special mentions: `<!channel>`, `<!here>`, `<!everyone>` (use sparingly).
- Date formatting: `<!date^<unix_seconds>^{date_short_pretty}|fallback>` — renders in viewer's tz.

Used in: `section.text`, `section.fields[]`, `context.elements[].text`.

## The fallback `text` field — don't skip it

ALWAYS pass a top-level `text` fallback alongside `blocks`. Slack uses it for:

- Notification preview (mobile, email, browser)
- Screen readers (accessibility)
- Threads where blocks don't render in the parent preview

```json
{
  "channel_id": "C01ABC123",
  "text": "Release v0.1.1 ready for approval — Approve / View diff",
  "blocks": [ ... ]
}
```

Slack logs a warning if you omit this. Keep it concise (≤150 chars) and convey the gist of what blocks render.

## Limits

| Limit | Value |
| --- | --- |
| Max blocks per message | 50 |
| Max chars per `section.text.text` | 3000 |
| Max chars per button label | 75 |
| Max buttons per `actions` block | 25 |
| Max fields per `section.fields` | 10 |
| Max chars per `header.text.text` | ~150 (recommended) |

If you hit a limit, split the content across multiple blocks (or multiple messages). Slack rejects the whole call if any single block is over.

## Common patterns

### Announcement with action buttons

```json
{
  "channel_id": "C0RELEASE",
  "text": "v0.1.1 release approval needed",
  "blocks": [
    { "type": "header", "text": { "type": "plain_text", "text": "Release v0.1.1" } },
    { "type": "section", "text": { "type": "mrkdwn", "text": "12 commits since v0.1.0. Skills consolidation, docs cleanup. Owner: <@U0RELEAS>." } },
    { "type": "divider" },
    {
      "type": "actions",
      "elements": [
        { "type": "button", "text": { "type": "plain_text", "text": "Approve" }, "action_id": "approve", "style": "primary" },
        { "type": "button", "text": { "type": "plain_text", "text": "View diff" }, "action_id": "view_diff", "url": "https://github.com/org/repo/compare/v0.1.0...main" }
      ]
    }
  ]
}
```

### Status report with key/value grid

```json
{
  "channel_id": "C0METRICS",
  "text": "Daily metrics — 2026-05-06",
  "blocks": [
    { "type": "header", "text": { "type": "plain_text", "text": "Daily metrics — 2026-05-06" } },
    {
      "type": "section",
      "fields": [
        { "type": "mrkdwn", "text": "*DAU*\n12,431 (+3.2%)" },
        { "type": "mrkdwn", "text": "*Errors*\n42 (-15%)" },
        { "type": "mrkdwn", "text": "*p95 latency*\n187ms" },
        { "type": "mrkdwn", "text": "*Sign-ups*\n89" }
      ]
    },
    { "type": "context", "elements": [{ "type": "mrkdwn", "text": "Source: <https://grafana.example.com|Grafana>" }] }
  ]
}
```

### Threaded reply

```json
{
  "channel_id": "C0PROJECT",
  "thread_ts": "1714900000.000100",
  "text": "Confirmed, kicking off the migration now.",
  "blocks": [
    { "type": "section", "text": { "type": "mrkdwn", "text": ":white_check_mark: Confirmed — kicking off the migration now. ETA 30 min." } }
  ]
}
```

## Workflow tips

- **Build in the visual editor first.** <https://app.slack.com/block-kit-builder> shows live preview and copies the JSON. Way faster than blind iteration.
- **Test in a private channel** before posting anywhere visible. The bot can post to a private channel it's a member of, then delete the test message.
- **Mrkdwn ≠ Markdown.** No `**bold**` (use `*bold*`), no `## headers` (use `header` blocks), no auto-list formatting (just lay out lines manually).
- **For long-form content, prefer canvases.** Block Kit messages are great for transactional/notification-style posts. For onboarding docs, runbooks, or anything 500+ chars of prose, build a canvas via `slack_create_channel_canvas` and link to it from a short message.
