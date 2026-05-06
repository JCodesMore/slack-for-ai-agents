<div align="center">

# Slack for AI Agents

### Hand Claude a bot token. Get a fully-built Slack workspace.

Channels, user groups, Block Kit messages, scheduled posts, canvases, and full workspace templates — described in plain English and applied with one tool call. Or hand Claude a one-line brief and watch the whole workspace materialize.

[Quick Start](#quick-start) · [Try it](#try-it) · [Features](#features)

</div>

---

## Quick Start

**1. Install the plugin** — inside Claude Code, run:

```
/plugin marketplace add JCodesMore/jcodesmore-plugins
/plugin install slack@jcodesmore-plugins
```

**2. Make a Slack bot.** Go to <https://api.slack.com/apps> → **Create New App** → **From scratch** → pick a name and your workspace. Open **OAuth & Permissions**, paste the recommended scope set (below) into **Bot Token Scopes**, then click **Install to Workspace** and copy the **Bot User OAuth Token** (starts with `xoxb-`).

**3. Paste the token** into the **Slack Bot Token** field when Claude Code prompts you, then **fully restart Claude Code** so the MCP server picks it up.

**4. Run the setup wizard** — type:

```
/slack:setup
```

Claude verifies the token, locks in the active workspace, and tells you what to try next. After that, you can run `/slack` (no subcommand) any time you want to do something — the main skill routes channel ops, messaging, scheduling, canvases, and workspace-from-brief design from the same entry point.

## Try it

Talk to Claude like a sysadmin who actually wants to help:

- *"/slack make me a workspace for a 12-person eng team focused on infra."* → spawns the architect.
- *"/slack apply the small-team template."*
- *"/slack create a `#release-notes` channel, set the topic to 'Ship logs only', and invite the @release-eng usergroup."*
- *"/slack post an announcement in `#general` with a header block, a section, and a divider."*
- *"/slack schedule a daily 9am standup ping in `#team-standup` for next week."*
- *"/slack make a Project Orion canvas in `#proj-orion` with the kickoff brief."*
- *"/slack add a Mods user group with a `@mods` handle, defaulted to #moderators."*

The agent picks the right Slack methods, validates inputs, and reports back what changed (with Slack's actual error codes when something fails).

### What it builds

Here's a copy-pasteable workspace-from-brief example. Run this in a fresh test workspace:

```
/slack make me a workspace for an 8-person ML research lab focused on RLHF
```

The main skill recognizes the brief, spawns the architect, picks `ai-research-lab` as a starting point, dry-runs a spec, and shows you a preview before touching anything:

```
Preview:
  Channels (6):
    paper-club    — Weekly readings, key takeaways, vote on next paper.
    experiments   — Run logs, hyperparam sweeps, hypothesis posts.
    model-eval    — Eval runs, comparisons, failure analyses.
    infra         — Cluster, training stack, dataset pipelines.
    code-review   — PRs, design reviews, refactor proposals.
    general       — Lab-wide announcements + chat.
  Usergroups (2):
    @researchers  — All hands. Defaults to #paper-club, #experiments.
    @lab-leads    — Decision-makers. Defaults to #general.
  Welcome canvas: pinned to #general — onboarding playbook.

Apply this? [Yes / Revise / Cancel]
```

After you approve, the architect applies it via `slack_apply_template` and returns a summary plus a rollback log:

```
Applied to "rlhf-lab" in 4.2s:
  Created 6 channels, 2 usergroups, 1 welcome canvas.
  Skipped 1 (channel "general" already existed).
  Rollback: slack_archive_channel × 5, slack_disable_usergroup × 2, slack_delete_canvas × 1.
```

If anything goes sideways, hand the rollback log back to Claude — every created resource is paired with the destructive tool that undoes it, so an LLM can walk back the run without guessing IDs.

## Features

**45+ Slack tools** wrapped in **two skills** and **one agent** — covering setup, channels, user groups, messaging, Block Kit, scheduling, canvases, users, webhooks, and workspace templates.

### Auth & setup

- `/slack` — main skill. Routes intents (channel ops, messaging, scheduling, canvases, "make me a workspace for…") from a single entry point. Falls back to `/slack:setup` if the bot token isn't configured yet.
- `/slack:setup` — friendly conversational walkthrough: verifies your bot token via `auth.test`, surfaces missing scopes, locks in the active workspace.
- `slack_whoami` — proves the token works and pins the workspace identity (`team_id`, `team_name`, `bot_user_id`, `bot_username`) into plugin state.
- SessionStart banner reminds Claude on every new session what workspace is active so it doesn't ask you twice.

### Channels (`conversations.*`)

- `slack_list_channels` — cursor-paginated, public + private, optional exclude-archived.
- `slack_create_channel` — public or private (`is_private` flag).
- `slack_archive_channel` / `slack_unarchive_channel` — reversible pair.
- `slack_rename_channel`, `slack_set_channel_topic`, `slack_set_channel_purpose`.
- `slack_invite_to_channel` (multi-user), `slack_kick_from_channel`.
- `slack_join_channel`, `slack_leave_channel` — manages the bot's own membership.

### User groups (`usergroups.*`)

- `slack_list_usergroups` — optional include-disabled, include-count, include-users.
- `slack_create_usergroup` — name, handle, description, default channels.
- `slack_update_usergroup` — rename, re-handle, re-describe, change defaults.
- `slack_list_usergroup_users`, `slack_update_usergroup_users` (replaces full member list).
- `slack_disable_usergroup` / `slack_enable_usergroup` — reversible off-switch.

### Messaging + Block Kit (`chat.*`, `pins.*`, `reactions.*`)

- `slack_post_message` — text and/or Block Kit `blocks`, optional `thread_ts`, `reply_broadcast`, unfurl flags.
- `slack_post_ephemeral_message` — visible only to one user.
- `slack_update_message` — full replace of `text` / `blocks` (bot's own messages only).
- `slack_delete_message` — bot's own messages only.
- `slack_pin_message` / `slack_unpin_message` — reversible pair.
- `slack_add_reaction` — emoji name, auto-strips colons defensively.
- Block Kit reference embedded in the post-message tool description so Claude has the seven block shapes (header / section / divider / actions / image / context / input) at hand.

### Scheduling (`chat.scheduleMessage` family)

- `slack_schedule_message` — accepts ISO 8601 or Unix epoch; pre-flights past-date and 120-day-future limits.
- `slack_list_scheduled_messages` — cursor-paginated, optional channel/oldest/latest filter, 80-char text preview.
- `slack_delete_scheduled_message` — cancels a pending message before it sends.

### Canvases (`canvases.*`, `conversations.canvases.*`)

- `slack_create_canvas` — standalone canvas with markdown body + optional title.
- `slack_edit_canvas` — apply `insert_at_end` / `insert_at_start` / `insert_after` / `insert_before` / `replace` / `delete` operations.
- `slack_delete_canvas` — reversible-pair partner to create.
- `slack_create_channel_canvas` — attach a canvas to a channel's Canvas tab; idempotent.

### Users + webhooks + raw API

- `slack_list_users`, `slack_get_user`, `slack_lookup_user_by_email`, `slack_get_user_profile` — read-only user directory; `users:read.email` powers email-→ID reconciliation.
- `slack_post_via_webhook` — POST to a user-supplied incoming-webhook URL via `fetch`, no SDK auth, no scope, no channel membership. Webhook URLs are not persisted; passed per-call.
- `slack_raw_api_call` — escape hatch for any Web API method not yet wrapped (e.g. `team.info`, `bookmarks.add`, `dnd.setSnooze`). Wraps `WebClient.apiCall`.

### Workspace templates

- `slack_list_templates` — enumerate bundled JSON specs.
- `slack_dry_run_template` — accepts `template_name` (bundled) or inline `spec`; parses + validates and returns a structured preview without making any API calls.
- `slack_apply_template` — bulk-creates resources in order: **channels → usergroups → welcome_canvas → scheduled_messages**. Idempotent (matches channels by name and usergroups by handle — never modifies or deletes existing resources). Returns a `rollback` log keyed to the destructive tools that undo each created resource.
- Bundled templates: `small-team`, `public-community`, `ai-research-lab`. Compose your own as a JSON spec or describe what you want and let the architect agent draft one.

### Natural-language architect

- Inside the main `/slack` skill: phrases like *"make me a workspace for…"*, *"design a workspace for…"*, *"build a Slack for…"* spawn the **`slack-architect`** sub-agent. The architect picks a starting point (bundled template or designs from scratch), dry-runs the spec, shows you a structured preview, asks for approval, and applies on confirmation.
- The architect's standard workflow leans on `slack_dry_run_template` → preview → `slack_apply_template`, but it has access to the full Slack toolset if a brief needs custom follow-up (e.g., posting a kickoff message into a freshly-created channel).
- Capped at 3 modify-iterations per run.

## Known limits

A handful of Slack admin operations need an admin user token (`xoxp-` with `admin.*` scopes) — Slack's permission model puts them on user tokens, not bot tokens. We capture only the bot token today, so these surfaces return a friendly "this needs the optional admin user token; we'll add that field in a later phase" message:

- `admin.users.invite` / `admin.users.remove` — workspace-wide invite/remove.
- `admin.users.setAdmin` / `setOwner` / `setRegular` — admin tier setters.
- `admin.team.settings.setDefaultChannels` — default channels for new members.
- `admin.conversations.setRetention*` — retention policies.
- `reminders.add` / `list` / `delete` — reminders need user-token scopes (`reminders:read` / `reminders:write`) which a bot token can't carry.

A few features have plan-tier caveats:

- **User groups need Slack Pro+** — free workspaces get `paid_teams_only`. Surface that to the architect explicitly so it drops the `usergroups` block instead of letting every group fail.
- **Standalone canvases (`slack_create_canvas`)** require a Slack paid plan. **Channel-tab canvases (`slack_create_channel_canvas`)** work on every plan.

A few things behave differently from how a Discord-trained brain might expect:

- **Scheduled messages are one-shot.** `chat.scheduleMessage` posts once at the configured time, then disappears. There's no "weekly recurring" primitive — to ritualize a standup ping, schedule a fresh batch each week (or hand the architect a recurring brief and let it queue them).
- **No channel categories or per-channel permission overwrites.** Slack is flat. Workspace structure comes from naming conventions (`team-`, `proj-`, `help-` prefixes) and usergroups, not nested folders.
- **Templates are create-only.** `slack_apply_template` won't archive, rename, or modify anything that already exists. Anything matching by name (channels) or handle (usergroups) is silently skipped.

We're REST-only — no Socket Mode / Events API receiver. This plugin is for *building* the workspace, not listening to it. For "AI agent reads and responds in Slack," see Anthropic's [Claude for Slack](https://claude.com/claude-for-slack).

Single-workspace only. No Enterprise Grid org-wide tooling.

## Recommended initial bot scopes

Add these in your Slack app's **OAuth & Permissions → Bot Token Scopes** before installing:

```
channels:read, channels:manage, channels:history,
groups:read, groups:write, groups:history,
chat:write, chat:write.public,
users:read, users:read.email,
usergroups:read, usergroups:write,
pins:write, reactions:write,
files:read, files:write,
canvases:write
```

`auth.test` works without any scopes, but `users:read` is needed to populate the bot's username. Add the rest now to avoid reinstalling the app each time you grow into a new feature area.

<details>
<summary><b>Bot token storage</b></summary>

The bot token is captured at install time via Claude Code's `userConfig.bot_token` (`sensitive: true`) field, stored in your system keychain, and injected into the MCP server's environment as `CLAUDE_PLUGIN_OPTION_BOT_TOKEN`. The token never enters chat or tool arguments.

Active-workspace state (team id, team name, bot user id, last verified timestamp) lives at `${CLAUDE_PLUGIN_DATA}/state.json` — non-sensitive metadata only.

If a token leaks, regenerate it at <https://api.slack.com/apps> → your app → **OAuth & Permissions** → **Reinstall to Workspace**, then update the **Slack Bot Token** field in `/plugin` and restart Claude Code.

</details>

<details>
<summary><b>Advanced install (without the marketplace)</b></summary>

Clone and build it yourself:

```bash
git clone https://github.com/JCodesMore/slack-for-ai-agents.git
cd slack-for-ai-agents
npm install
npm run build
```

Then in Claude Code:

```
/plugin marketplace add file:///<absolute-path-to-repo>
/plugin install slack
```

**Requirements:** Node.js ≥ 18. Bot token from <https://api.slack.com/apps>.

</details>

<details>
<summary><b>Built on</b></summary>

- [Model Context Protocol SDK](https://modelcontextprotocol.io/) — exposes Slack tools to Claude
- [@slack/web-api](https://tools.slack.dev/node-slack-sdk/web-api) — official Slack Web API client with typed methods and built-in rate-limit handling
- [Zod](https://zod.dev/) — schema validation

</details>

## Community

[**Issues**](https://github.com/JCodesMore/slack-for-ai-agents/issues) — bugs & feature requests · [**More plugins**](https://github.com/JCodesMore/jcodesmore-plugins)

## License

[Apache License 2.0](LICENSE) — © 2026 JCodesMore

> Not affiliated with, endorsed by, or associated with Slack Technologies, LLC.

---

*Part of [jcodesmore-plugins](https://github.com/JCodesMore/jcodesmore-plugins).*
