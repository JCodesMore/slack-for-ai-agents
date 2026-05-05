# Changelog

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
