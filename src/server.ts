#!/usr/bin/env node

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerWhoamiTool } from './tools/whoami.js';
import { registerChannelTools } from './tools/channels.js';
import { registerUsergroupTools } from './tools/usergroups.js';
import { registerMessageTools } from './tools/messages.js';
import { registerSchedulingTools } from './tools/scheduling.js';
import { registerCanvasTools } from './tools/canvases.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'));

const server = new McpServer({
  name: 'slack',
  version: pkg.version,
});

registerWhoamiTool(server);
registerChannelTools(server);
registerUsergroupTools(server);
registerMessageTools(server);
registerSchedulingTools(server);
registerCanvasTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Slack MCP server failed to start:', error);
  process.exit(1);
});
