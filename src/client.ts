import { WebClient } from '@slack/web-api';

const TOKEN_ENV = 'CLAUDE_PLUGIN_OPTION_BOT_TOKEN';

let cachedClient: WebClient | null = null;
let cachedTokenSignature: string | null = null;

export class MissingTokenError extends Error {
  constructor() {
    super(
      'Slack bot token is not configured. The user should open `/plugin`, find **slack**, and set the **Slack Bot Token** field. They can create a Slack app at https://api.slack.com/apps.',
    );
    this.name = 'MissingTokenError';
  }
}

export function getBotToken(): string {
  const raw = process.env[TOKEN_ENV];
  const token = (raw ?? '').trim();
  if (!token) throw new MissingTokenError();
  return token;
}

export function hasBotToken(): boolean {
  return !!(process.env[TOKEN_ENV] ?? '').trim();
}

export function getWebClient(): WebClient {
  const token = getBotToken();
  if (cachedClient && cachedTokenSignature === token) return cachedClient;
  cachedClient = new WebClient(token);
  cachedTokenSignature = token;
  return cachedClient;
}

export interface SlackApiError {
  code?: string;
  data?: {
    ok?: boolean;
    error?: string;
    needed?: string;
    provided?: string;
    response_metadata?: { messages?: string[] };
  };
  message?: string;
}

export function formatSlackError(err: unknown): string {
  const e = err as SlackApiError & { name?: string };
  if (e?.name === 'MissingTokenError' && e?.message) return e.message;
  const apiCode = e?.data?.error ? ` [${e.data.error}]` : '';
  const needed = e?.data?.needed ? ` (needs scope: ${e.data.needed})` : '';
  const meta = e?.data?.response_metadata?.messages?.length
    ? ` — ${e.data.response_metadata.messages.join('; ')}`
    : '';
  const msg = e?.message ?? String(err);
  return `Slack API error${apiCode}${needed}: ${msg}${meta}`;
}
