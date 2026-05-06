# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.1] - 2026-05-06

Skill consolidation + cleanliness pass. No new tools — same 45+ MCP surface, friendlier shape.

### Changed

- **Top-level `/slack` skill is now the front door.** Previously a user typing `/slack` got nothing — they had to know the exact sub-command (`/slack:setup` or the now-removed `/slack:workspace-from-prompt`). The new `skills/slack/SKILL.md` greets the user with a state-aware welcome (token missing → routes to `/slack:setup`; configured → shows the active workspace and a 4-line menu) and routes intents from a single entry point.
- **`/slack:workspace-from-prompt` slash command merged into `/slack`.** Phrases like *"make me a workspace for…"*, *"design a workspace for…"*, *"build a Slack for…"* now trigger the architect-spawning routing path inside the main skill. The `commands/workspace-from-prompt.md` file has been removed; functionality is unchanged.
- **Block Kit reference promoted to `skills/slack/references/block-kit.md`.** Previously the full block-shape doc was embedded inline in `slack_post_message`'s tool description (kept it scannable for the LLM but stuffed the description). The tool description now carries a 5-line cheat sheet and points to the reference file for deep shapes, mrkdwn syntax, limits, and worked examples.
- **`slack-architect` body rewritten to describe the four template tools as its standard workflow, not a hard restriction.** The agent's frontmatter has no `tools:` field — it always had full Slack toolset access. The doc now matches the code: `slack_dry_run_template` → preview → `slack_apply_template` is the preferred path for the common case, with the full toolbox available when a brief genuinely needs custom follow-up after the apply.

### Fixed

- **README + CHANGELOG no longer claim the architect is "restricted to four tools."** That sentence was a doc/code mismatch — the agent never had a `tools:` whitelist. Replaced with a description of the architect's preferred workflow that matches actual behavior.

## [0.1.0] - 2026-05-04

First stable release. Hand Claude a Slack bot token, get a fully-administered workspace.

### Highlights vs. other Slack MCPs

- **`slack_apply_template` ships a rollback log.** Every created resource is paired with the destructive tool that undoes it (`slack_archive_channel`, `slack_disable_usergroup`, `slack_delete_canvas`, `slack_delete_scheduled_message`), so an LLM can walk back a botched apply without guessing IDs. None of the existing community MCPs do this.
- **`/slack:workspace-from-prompt` + `slack-architect` agent** — describe a workspace in plain English, the architect picks a bundled template (or designs from scratch), dry-runs the spec, shows you a structured preview via `AskUserQuestion`, and applies on approval. The architect's standard workflow is `slack_dry_run_template` → preview → `slack_apply_template`, so the create-only macro is doing the heavy lifting and a usable rollback log comes back with the apply. *(0.1.1 note: `/slack:workspace-from-prompt` was folded into the main `/slack` skill.)*
- **Admin/builder positioning, not "AI agent posts in Slack."** This plugin is for *building* the workspace — channels, usergroups, templates, scheduled rituals, canvases — rather than reading and responding to messages.

### What shipped (Phases 0–9)

**Setup & state**
- `userConfig.bot_token` (sensitive) — keychain-backed token capture at install.
- `${CLAUDE_PLUGIN_DATA}/state.json` for non-sensitive state (active workspace id, bot identity, last verified timestamp).
- SessionStart hooks: `ensure-deps.mjs` lazily installs runtime deps; `session-banner.mjs` surfaces token + active-workspace status to the assistant on every session.
- `/slack:setup` skill — friendly conversational walkthrough that verifies the token, surfaces missing scopes, and locks in the active workspace.
- `slack_whoami` — proves the token works via `auth.test`, persists workspace identity to plugin state.

**MCP tools (45+ total)**

- Channels: `slack_list_channels`, `slack_create_channel`, `slack_archive_channel` / `slack_unarchive_channel`, `slack_rename_channel`, `slack_set_channel_topic`, `slack_set_channel_purpose`, `slack_invite_to_channel`, `slack_kick_from_channel`, `slack_join_channel`, `slack_leave_channel`.
- User groups: `slack_list_usergroups`, `slack_create_usergroup`, `slack_update_usergroup`, `slack_list_usergroup_users`, `slack_update_usergroup_users`, `slack_disable_usergroup`, `slack_enable_usergroup`.
- Messages + Block Kit: `slack_post_message`, `slack_post_ephemeral_message`, `slack_update_message`, `slack_delete_message`, `slack_pin_message`, `slack_unpin_message`, `slack_add_reaction`. Block-shape reference (`header` / `section` / `divider` / `actions` / `image` / `context` / `input`) embedded in tool descriptions for grep-ability by the agent.
- Scheduling: `slack_schedule_message`, `slack_list_scheduled_messages`, `slack_delete_scheduled_message`. Pre-flights past-date and 120-day-future limits.
- Canvases: `slack_create_canvas`, `slack_edit_canvas`, `slack_delete_canvas`, `slack_create_channel_canvas` (channel-tab canvases work on every plan; standalone canvases need Slack paid).
- Users + webhooks + raw API: `slack_list_users`, `slack_get_user`, `slack_lookup_user_by_email`, `slack_get_user_profile`, `slack_post_via_webhook` (no SDK auth, no scope, URL prefix validated against `https://hooks.slack.com/`), `slack_raw_api_call` (escape hatch for any Web API method not yet wrapped).

**Templates & macros**
- `slack_list_templates` — enumerate bundled JSON specs.
- `slack_dry_run_template` — accepts `template_name` (bundled) or inline `spec`; parses + validates and returns a structured preview without touching Slack.
- `slack_apply_template` — bulk-creates resources in order: **channels → usergroups → welcome_canvas → scheduled_messages**. Idempotent (matches channels by name and usergroups by handle — never modifies or deletes). Cross-references (usergroup `channel_ids`, `welcome_canvas.channel_id`, `scheduled_messages[].channel_id`) accept either a literal Slack channel ID OR a channel name from the same template / existing workspace, resolved at apply time. Returns a rollback log keyed to the destructive tools that undo each created resource.
- Bundled templates: `small-team`, `public-community`, `ai-research-lab`.

**Workspace-from-prompt**
- `slack-architect` sub-agent — sonnet-backed; takes a brief, picks a bundled template (or designs from scratch), produces a `templateSpec` JSON matching `slack_apply_template`'s schema, dry-runs via `slack_dry_run_template`, surfaces a structured preview via `AskUserQuestion`, and applies on approval. Standard workflow stays on the template tools so the create-only macro does the heavy lifting and a usable rollback log comes back with each apply. Capped at 3 modify-iterations per run.
- `/slack:workspace-from-prompt` slash command — confirms the active workspace, captures (or accepts inline) a brief, spawns the architect, and relays the final summary plus rollback log to the user.

### Deferred (admin user token required)

Surfaced as friendly errors in the relevant tools today; will be unlocked when we add an optional `xoxp-` admin user-token field in a later release:

- Workspace member invite/remove (`admin.users.invite` / `admin.users.remove`).
- Admin tier setters (`admin.users.setAdmin` / `setOwner` / `setRegular`).
- Default channels for new members (`admin.team.settings.setDefaultChannels`).
- Retention policies (`admin.conversations.setRetention*`).
- Reminders (`reminders.add` / `list` / `delete`) — user-token scopes only.

### Built on

- [@modelcontextprotocol/sdk](https://modelcontextprotocol.io/) — exposes Slack tools to Claude
- [@slack/web-api](https://tools.slack.dev/node-slack-sdk/web-api) — official Slack Web API client with typed methods and built-in rate-limit handling
- [zod](https://zod.dev/) — schema validation

---

## 0.0.8

- Phase 9 — `slack-architect` agent + `/slack:workspace-from-prompt` slash command. Mirrors the Discord plugin's `discord-architect` pattern, adapted for Slack's flat channel model + usergroup tiers.
  - `agents/slack-architect.md` — sonnet-backed sub-agent that takes a natural-language brief ("make me a workspace for a 12-person eng team focused on infra"), picks a starting point (`small-team` / `public-community` / `ai-research-lab` bundled template, or designs from scratch), produces a `templateSpec` JSON matching `slack_apply_template`'s schema, dry-runs it via `slack_dry_run_template`, surfaces a structured preview to the user via `AskUserQuestion`, and applies via `slack_apply_template` once approved. Capped at 3 modify-iterations per run; standard workflow stays on the template tools so the create-only macro does the heavy lifting.
  - `commands/workspace-from-prompt.md` — `/slack:workspace-from-prompt` slash command that confirms the active workspace via `slack_whoami`, captures (or accepts inline) a brief, spawns the architect with the workspace pre-anchored, and relays the architect's final summary plus rollback log to the user.
  - The agent embeds Slack-specific design heuristics (sizing tables, channel naming conventions like `team-` / `proj-` / `help-`, usergroup patterns, paid-plan caveats for usergroups + standalone canvases) and explicitly enumerates the admin-token-deferred surface (workspace member invite/remove, retention, default channels, reminders, admin tier setters) so it doesn't wander into unbuildable territory.

## 0.0.7

- Phase 8 — workspace-template macro. Three new tools in `src/tools/template.ts` plus three bundled templates under `templates/`:
  - `slack_list_templates` (READ_ONLY) — enumerates the JSON specs shipped under `templates/<name>.json`.
  - `slack_dry_run_template` (READ_ONLY) — accepts either `template_name` (bundled) or inline `spec`, parses + validates, returns a structured preview (channel visibility, usergroup handles, members count, scheduled-message text previews) without making any API calls.
  - `slack_apply_template` (DESTRUCTIVE) — bulk-creates resources in order: **channels → usergroups → welcome_canvas → scheduled_messages**. Idempotent: channels matching by name and usergroups matching by handle (or name fallback) are SKIPPED, never modified or deleted. Composes Phase 3–6 SDK calls directly (`conversations.list/create/setTopic/setPurpose/invite`, `usergroups.list/create/users.update`, `conversations.canvases.create`, `chat.scheduleMessage`). Cross-references (usergroup `channel_ids`, `welcome_canvas.channel_id`, `scheduled_messages[].channel_id`) accept either a literal Slack channel ID OR a channel name from the same template / existing workspace — resolved at apply time so a single-pass template can wire just-created channels to canvases and scheduled messages.
- Returns a `rollback` log per apply: each created resource paired with the destructive tool that undoes it (`slack_archive_channel`, `slack_disable_usergroup`, `slack_delete_canvas`, `slack_delete_scheduled_message`). An LLM can read the rollback log and undo the run without guessing IDs.
- Bundled templates:
  - `small-team` — team-general / team-random / team-standup + private team-leads channel + Team Leads usergroup.
  - `public-community` — announcements / introductions / general / showcase / off-topic / feedback + Mods + Contributors usergroups.
  - `ai-research-lab` — paper-club / experiments / model-eval / infra / code-review / general + private lab-leads channel + Researchers + Lab Leads usergroups.
- Channel-list pagination: `slack_apply_template` paginates `conversations.list` with `limit=1000` until `next_cursor` is empty, so workspaces with >1000 channels still match correctly for idempotency.

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
