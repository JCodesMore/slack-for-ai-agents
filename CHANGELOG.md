# Changelog

## 0.0.1

- Initial scaffold: plugin manifest, MCP server boot, SessionStart hooks (deps + banner).
- `slack_whoami` tool — calls `auth.test`, persists active workspace + bot identity to plugin state.
- `/slack:setup` skill — friendly conversational walkthrough for verifying the bot token and confirming the active workspace.
