<div align="center">

# Slack for AI Agents

### Hand Claude a bot token. Get a fully-built Slack workspace.

Channels, user groups, Block Kit messages, scheduled posts, canvases, retention policies — described in plain English, applied with one tool call. Built as a Claude Code plugin.

</div>

---

## Status

Early scaffold (v0.0.3). Phases 0–4 of 10 complete:

- [x] **Phase 0** — repo skeleton, manifest, MCP server boots
- [x] **Phase 1** — `slack_whoami` proves token wiring works
- [x] **Phase 2** — `/slack:setup` wizard + active-workspace state
- [x] **Phase 3** — channels (list, create public/private, archive/unarchive, rename, topic, purpose, invite, kick, join, leave)
- [x] **Phase 4** — user groups (list, create, update, list/update members, disable/enable). Admin-role tools deferred until we wire an admin user token.
- [ ] Phase 5 — messages + Block Kit (sections, dividers, headers, actions, images, context, inputs)
- [ ] Phase 6 — scheduled messages, reminders, canvases, retention
- [ ] Phase 7 — users, incoming-webhooks walkthrough, raw-API escape hatch
- [ ] Phase 8 — workspace-template macro
- [ ] Phase 9 — `slack-architect` agent + `/slack:workspace-from-prompt`
- [ ] Phase 10 — polish, docs, marketplace listing

## Quick Start (developer install)

This plugin isn't on a marketplace yet. To try it locally:

```bash
git clone <this-repo>
cd slack-for-ai-agents
npm install
npm run build
```

Then in Claude Code:

```
/plugin marketplace add file:///<absolute-path-to-repo>
/plugin install slack
```

Create a Slack app and bot token at https://api.slack.com/apps:

1. **Create New App** → **From scratch** → pick a name and a workspace.
2. **OAuth & Permissions** → under **Bot Token Scopes**, add the recommended initial scope set (below).
3. Click **Install to Workspace** at the top of the **OAuth & Permissions** page → approve.
4. Copy the **Bot User OAuth Token** (starts with `xoxb-`).

When prompted by Claude Code, paste the token into the **Slack Bot Token** field. **Fully restart Claude Code** so the MCP server picks it up. Then ask:

> *"Verify my Slack bot is working."*

Claude will call `slack_whoami` and report the bot's username and workspace. You can also run `/slack:setup` for a friendly walkthrough.

## Recommended initial bot scopes

Add these in your Slack app's **OAuth & Permissions → Bot Token Scopes** before installing. They cover Phase 0 through Phase 7:

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

Phase 0 itself only needs `users:read` (`auth.test` works without any scopes, but the bot username is populated when this scope is present). Add the rest now to avoid having to reinstall the app at every phase boundary.

## What this is *not*

- Not an "AI agent uses Slack on your behalf" plugin (no read-and-respond loop). For that, see Anthropic's [Claude for Slack](https://claude.com/claude-for-slack).
- Not a Socket Mode / Events API receiver. This plugin is REST-only — it's for *building* the workspace, not listening to it.
- Not for Enterprise Grid org-wide tooling (single workspace only).

## Built on

- [Model Context Protocol SDK](https://modelcontextprotocol.io/) — exposes Slack tools to Claude
- [@slack/web-api](https://tools.slack.dev/node-slack-sdk/web-api) — official Slack Web API client with typed methods and rate-limit handling
- [Zod](https://zod.dev/) — schema validation

## License

[Apache License 2.0](LICENSE) — © 2026 JCodesMore
