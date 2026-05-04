#!/usr/bin/env node

// SessionStart hook — prints a context block for the assistant about
// the slack plugin's current state (token presence, active workspace).
// Output is consumed by Claude Code as additionalContext, not shown verbatim.

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const dataDir = process.env.CLAUDE_PLUGIN_DATA;
const tokenPresent = !!(process.env.CLAUDE_PLUGIN_OPTION_BOT_TOKEN || '').trim();

let activeWorkspaceLine = '';
if (dataDir) {
  const statePath = join(dataDir, 'state.json');
  if (existsSync(statePath)) {
    try {
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      if (state?.active_workspace_id) {
        const name = state.active_workspace_name ? ` (${state.active_workspace_name})` : '';
        activeWorkspaceLine = `\n- Active workspace: \`${state.active_workspace_id}\`${name}`;
      }
    } catch { /* ignore corrupt state */ }
  }
}

let lines;
if (!tokenPresent) {
  lines = [
    '# Slack plugin status',
    '',
    'No bot token configured. Tell the user: open `/plugin`, find **slack**, and set the **Slack Bot Token** field. They can create a Slack app at https://api.slack.com/apps. After that they should run `/slack:setup`.',
  ];
} else if (!activeWorkspaceLine) {
  lines = [
    '# Slack plugin status',
    '',
    '- Bot token: configured',
    '- Active workspace: not set',
    '',
    'Suggest the user run `/slack:setup` to verify the bot and confirm the active workspace.',
  ];
} else {
  lines = [
    '# Slack plugin status',
    '',
    '- Bot token: configured' + activeWorkspaceLine,
    '',
    'Slack admin tools are ready. Use the `mcp__slack__*` tools to manage the active workspace.',
  ];
}

const payload = {
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: lines.join('\n'),
  },
};

process.stdout.write(JSON.stringify(payload));
