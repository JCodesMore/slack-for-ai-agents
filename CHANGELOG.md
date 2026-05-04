# Changelog

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
