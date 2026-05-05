# Changelog

## 0.0.6

- Phase 7 — users + incoming-webhooks walkthrough + raw-API escape hatch. Six new tools:
  - `slack_list_users` (`users.list`) — cursor-paginated; returns id, name, real_name, display_name, admin/owner/guest flags, deleted state, email (when `users:read.email` is granted), title, status, tz. Optional `filter_deleted` strips deactivated accounts client-side.
  - `slack_get_user` (`users.info`) — single-user lookup by ID.
  - `slack_lookup_user_by_email` (`users.lookupByEmail`) — reconciles external systems → Slack IDs.
  - `slack_get_user_profile` (`users.profile.get`) — full profile including custom workspace fields, pronouns, phone, full status with expiration timestamp, high-res image URLs.
  - `slack_post_via_webhook` — POSTs JSON to a user-supplied incoming-webhook URL via `fetch` (no SDK auth, no bot scope, no channel membership). Webhook URLs are NOT persisted; they're passed per-call. Tool description embeds the manual setup walkthrough (api.slack.com/apps → Incoming Webhooks → Add New Webhook to Workspace → copy URL). URL prefix validated against `https://hooks.slack.com/` to block typos.
  - `slack_raw_api_call` — escape hatch for any Slack Web API method not covered by a dedicated tool (`team.info`, `files.list`, `bookmarks.add`, `dnd.setSnooze`, etc.). Wraps `WebClient.apiCall`. Method name validated against `/^[a-z]+(\.[a-zA-Z]+)+$/` to reject obvious garbage. DESTRUCTIVE annotation since the bot can't tell from the method name whether the call reads or writes.
- Workspace member invite/remove (`admin.users.invite` / `admin.users.remove`) deferred — those endpoints require an admin user token (`xoxp-`), which we don't expose a config field for yet (same constraint Phases 4 and 6 hit).

## 0.0.5

- Phase 6 — scheduled messages + canvases. Seven new tools:
  - `slack_schedule_message` (`chat.scheduleMessage`) — accepts ISO 8601 or Unix epoch for `post_at`; pre-flights past-date and 120-day-future limits with friendly errors.
  - `slack_list_scheduled_messages` (`chat.scheduledMessages.list`) — cursor-paginated, optional channel/oldest/latest filter, returns ISO timestamp + 80-char text preview.
  - `slack_delete_scheduled_message` (`chat.deleteScheduledMessage`) — DESTRUCTIVE; cancels a pending message before it sends.
  - `slack_create_canvas` (`canvases.create`) — standalone canvas with markdown body + optional title.
  - `slack_edit_canvas` (`canvases.edit`) — apply a list of `insert_at_end` / `insert_at_start` / `insert_after` / `insert_before` / `replace` / `delete` operations.
  - `slack_delete_canvas` (`canvases.delete`) — DESTRUCTIVE; reversible-pair partner to create.
  - `slack_create_channel_canvas` (`conversations.canvases.create`) — attach a canvas to a channel's Canvas tab; idempotent (returns existing canvas_id if one is already attached).
- Reminders (`reminders.add` / `list` / `delete`) deferred — those endpoints require user-token scopes (`reminders:read` / `reminders:write`) which a bot token can't carry. Will revisit when we add the optional `xoxp-` admin/user-token field.
- Retention controls (`admin.conversations.setRetention*`) deferred for the same reason — admin user token only.

## 0.0.4

- Phase 5 — messages + Block Kit. Seven `chat.*` / `pins.*` / `reactions.*` tools:
  - `slack_post_message` (text and/or Block Kit `blocks`, optional `thread_ts`, `reply_broadcast`, unfurl flags).
  - `slack_post_ephemeral_message` (only-visible-to-one-user; can't be edited or deleted via API).
  - `slack_update_message` (full replace of `text` / `blocks` — bot's own messages only).
  - `slack_delete_message` (DESTRUCTIVE; bot's own messages only).
  - `slack_pin_message` / `slack_unpin_message` (reversible pair).
  - `slack_add_reaction` (emoji name without colons; auto-strips them defensively).
- New `src/tools/blocks.ts` — Zod `BlocksSchema` (validates each block has a `type` field) plus a `BLOCK_KIT_REFERENCE` doc string embedded into the post-message tool description so Claude has the seven block shapes (header / section / divider / actions / image / context / input) and text-object shapes (`plain_text` vs `mrkdwn`) at hand.
- Empty-body guard returns a friendly error instead of letting Slack reject the call.

## 0.0.3

- Phase 4 — user groups (subteams). Seven `usergroups.*` tools:
  - `slack_list_usergroups` (with optional include_disabled / include_count / include_users).
  - `slack_create_usergroup` (name, handle, description, default channels).
  - `slack_update_usergroup` (rename / re-handle / re-describe / change default channels).
  - `slack_list_usergroup_users`, `slack_update_usergroup_users` (replaces full member list).
  - `slack_disable_usergroup` / `slack_enable_usergroup` (reversible off-switch).
- Tools surface `paid_teams_only` cleanly when the workspace is on a free plan (Slack restriction — user groups need Pro+).
- Admin-role tools (`admin.users.setAdmin` / `setOwner` / `setRegular`) deferred — they require an admin user token (`xoxp-`), which we don't expose a config field for yet.

## 0.0.2

- Phase 3 — channels. Eleven `conversations.*` tools:
  - `slack_list_channels` (cursor-paginated, public+private, exclude-archived).
  - `slack_create_channel` (public/private).
  - `slack_archive_channel` / `slack_unarchive_channel`.
  - `slack_rename_channel`, `slack_set_channel_topic`, `slack_set_channel_purpose`.
  - `slack_invite_to_channel` (multi-user), `slack_kick_from_channel`.
  - `slack_join_channel`, `slack_leave_channel` (the bot's own membership).
- All channel tools gate on `activeWorkspaceGuard` so they nudge the user to `/slack:setup` if state is empty.

## 0.0.1

- Initial scaffold: plugin manifest, MCP server boot, SessionStart hooks (deps + banner).
- `slack_whoami` tool — calls `auth.test`, persists active workspace + bot identity to plugin state.
- `/slack:setup` skill — friendly conversational walkthrough for verifying the bot token and confirming the active workspace.
