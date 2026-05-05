---
description: Conversationally design and build a Slack workspace from a natural-language brief like "make me a workspace for a 12-person eng team focused on infra." Spawns the slack-architect agent which drafts a template spec, dry-runs it, and applies it after user approval.
---

# Build a Slack Workspace from a Natural-Language Brief

You're helping the user describe a Slack workspace in plain language and watch it materialize. The actual work is delegated to the **slack-architect** sub-agent — you orchestrate the spawn, then let the agent drive the design + dry-run + apply loop.

## Step 1 — Confirm the active workspace

Call `mcp__slack__slack_whoami`.

- If `isError: true` ("token is not configured" / `invalid_auth` / etc.) → tell the user to run `/slack:setup` first and **stop**.
- Otherwise, anchor the conversation on `<team.name>` (id `<team.id>`).

**Idempotency reminder**: `slack_apply_template` is **create-only** — it won't archive or rename anything that already exists. If `<team.name>` already has channels named `general` / `random` etc., the architect's spec will mark those as `skipped`. That's fine — the goal is to add structure, not replace it. If the user wants a totally clean slate, suggest they create a fresh workspace at https://slack.com/get-started for first-time builds.

## Step 2 — Capture the brief

If the user provided a brief inline (e.g., `/slack:workspace-from-prompt make me a workspace for an 8-person ML startup focused on infra`), use it as-is.

Otherwise, ask:

> What kind of workspace do you want? Describe the team or community in your own words — be specific about the size, what people will do there, and any channels or usergroups you definitely want. (Examples: "12-person eng team focused on infra", "open community for vintage synth fans", "5-person research lab studying RLHF".)

Don't ask follow-ups here — leave clarifications to the architect.

## Step 3 — Spawn the architect

Use the **Agent** tool with:

- `subagent_type: "slack:slack-architect"`
- `description`: short, like `"Design <community-type> workspace"`
- `prompt`: the brief verbatim plus the active workspace context. Format:

```
Brief from user: <user brief>

Active workspace: <team.name> (team_id: <team.id>)

Design a template spec for this workspace. Dry-run via slack_dry_run_template, present the preview to the user via AskUserQuestion, and apply via slack_apply_template on approval. Return a final summary of what was created.
```

The architect will:

1. Optionally ask one clarifying question if the brief is ambiguous
2. Pick a starting point (`small-team`, `public-community`, `ai-research-lab`, or design from scratch)
3. Build a spec matching the templateSpec schema
4. Dry-run via `slack_dry_run_template`
5. Present the preview and call `AskUserQuestion` for approval
6. Apply on approval (or revise, or cancel) — including a `rollback` log
7. Return a final summary

## Step 4 — Relay the result

When the architect returns, summarize the outcome to the user in 2–3 sentences:

> The architect built **<theme>** in **`<team.name>`**: created **n** channels, **n** usergroups<, plus a welcome canvas / scheduled messages if applicable>. **m** items skipped (already existed). <Anything failed.>

If the architect cancelled or hit failures, surface the reason directly so the user can decide next steps.

If the architect returned a `rollback` log, mention it: *"If anything looks wrong, the apply returned a rollback log — I can walk you through undoing specific pieces (`slack_archive_channel`, `slack_disable_usergroup`, `slack_delete_canvas`, `slack_delete_scheduled_message`) on request."*

## Step 5 — Suggest next steps

After a successful build, offer:

> Want me to:
>
> - **Invite members** to specific channels (`slack_invite_to_channel`)
> - **Post a kickoff announcement** with Block Kit in `#announcements` or `#team-general`
> - **Add the leadership team** to the `@team-leads` / `@mods` / `@lab-leads` usergroup (`slack_update_usergroup_users`)
> - **Schedule a recurring ritual** — standup ping, weekly review, demo Friday (`slack_schedule_message`)
> - **Add another layer** — re-run `/slack:workspace-from-prompt` with a follow-up like "add a launch-prep section for Project Orion"

## Notes

- **One agent invocation per brief.** Don't loop or re-spawn — if the user wants major changes after apply, run the command again with a follow-up brief.
- **The architect handles dry-run + apply itself** — don't call `slack_apply_template` from this command directly.
- **If the architect fails to design** (e.g., spec validation rejects), surface the error and ask the user to refine the brief, then re-spawn.
- **The architect runs in the foreground** so its `AskUserQuestion` calls reach the user. Don't pass `run_in_background: true` to the Agent tool.
- **Free-plan workspaces**: usergroups require Slack Pro+. If the user mentions they're on the free plan, tell the architect explicitly in the spawn prompt so it can drop the `usergroups` section instead of having every group fail with `paid_teams_only`.
