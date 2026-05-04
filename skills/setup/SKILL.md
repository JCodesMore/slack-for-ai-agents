---
name: slack:setup
description: Set up the Slack plugin — verify bot token, confirm active workspace. Run when starting fresh, switching workspaces, or troubleshooting auth.
---

# Slack Plugin Setup

You are walking the user through a conversational setup for the Slack plugin. Be friendly and concise. Speak in first person ("I'll check your bot…"), not robot-style.

Slack bot tokens are workspace-scoped — one token = one workspace — so this is shorter than the Discord equivalent. There's no "list and pick" step.

## Step 1 — Verify token & identify workspace

Call `mcp__slack__slack_whoami`.

**Possible outcomes:**

- **Returns bot identity** (`ok: true`, with `bot.username`, `team.id`, `team.name`) → token works. The active workspace is now persisted in plugin state. Greet the user and continue to Step 2.

  > Connected as **`<bot.username>`** in the **`<team.name>`** workspace. I've recorded that as the active workspace — every channel, message, usergroup, etc. I create or modify will go there.

- **Returns `isError: true` with "token is not configured"** → user hasn't filled the token field.

  Tell the user verbatim:

  > The Slack plugin needs a bot token before I can do anything.
  >
  > 1. Open the `/plugin` menu in Claude Code, find **slack**, and paste your bot token (starts with `xoxb-`) into the **Slack Bot Token** field. Get one at https://api.slack.com/apps → your app → **OAuth & Permissions** → **Bot User OAuth Token**. (If you don't have an app yet, click **Create New App** → **From scratch**.)
  > 2. **Fully restart Claude Code** (quit, reopen) — the MCP server only reads the token at startup.
  > 3. Then run `/slack:setup` again.

  Then **stop**. Don't continue to Step 2.

- **Returns `isError: true` with `[invalid_auth]` or `[token_revoked]` / `[token_expired]`** → token is set but rejected.

  > The token Claude Code has stored doesn't work — Slack rejected it (`<error code>`). Most likely it was rotated or the app was uninstalled. Regenerate it at https://api.slack.com/apps → your app → **OAuth & Permissions** → **Reinstall to Workspace**, copy the new **Bot User OAuth Token**, paste it into `/plugin` → **slack** → **Slack Bot Token**, then **fully restart Claude Code**.

  Then **stop**.

- **Returns `isError: true` with `[missing_scope]`** → the bot user works but the scopes the API call requires aren't granted. The error message includes a `needs scope:` hint with the missing scope name.

  > The bot is missing the scope **`<scope>`**. Open https://api.slack.com/apps → your app → **OAuth & Permissions** → **Scopes** → **Bot Token Scopes**, add `<scope>`, click **Reinstall to Workspace**, copy the regenerated token into `/plugin` → **slack**, and fully restart Claude Code.

  Then **stop**.

- **Other error** → relay the error code and message clearly. Suggest the user check the app exists at https://api.slack.com/apps and that the bot is installed to a workspace.

## Step 2 — Recap

If `slack_whoami` succeeded, give the user a short next-steps list:

> Setup is done. Try things like:
>
> - *"Make a #general channel"*
> - *"Create a 'Mods' user group"*
> - *"Post an announcement to #general with a header, divider, and two buttons"*
> - *"Schedule a kickoff message in #project-alpha for tomorrow at 9am"*
>
> If you ever need to switch to a different workspace, install your bot to that workspace, paste the new bot token into `/plugin`, restart Claude Code, and re-run `/slack:setup`.

## Switching workspaces later

If the user runs `/slack:setup` and is already configured, jump straight to Step 1 — the new `slack_whoami` call will overwrite the active-workspace state with whatever workspace the current token belongs to.

## Important rules

- **Never paste the user's bot token into chat or any tool argument.** It lives in the keychain via `userConfig`. Only the MCP server subprocess reads it.
- **Surface error codes clearly.** Slack's error strings (`invalid_auth`, `missing_scope`, `not_in_channel`, `channel_not_found`, etc.) are well-documented — give the user a copyable code, don't paraphrase it away.
- **The session banner already reflects active-workspace state on session start** — you don't need to repeat it unless the user asks.
- If a tool call returns `isError: true`, surface the message clearly. Don't retry blindly.
