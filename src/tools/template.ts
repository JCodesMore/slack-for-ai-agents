import { z } from 'zod';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { formatSlackError, getWebClient } from '../client.js';
import { activeWorkspaceGuard } from '../guards.js';
import { getActiveWorkspaceId } from '../state.js';
import { BlocksSchema } from './blocks.js';

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
} as const;

const DESTRUCTIVE = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: true,
} as const;

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, '..', '..');
const TEMPLATES_DIR = resolve(PLUGIN_ROOT, 'templates');

const SLACK_MAX_SCHEDULE_DAYS = 120;
const SLACK_ID_PATTERN = /^[CGUWD][A-Z0-9]{6,}$/;

function parsePostAt(input: string): { unix: number; iso: string } | { error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { error: 'post_at is empty.' };
  let unixMs: number;
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    unixMs = trimmed.length >= 13 ? n : n * 1000;
  } else {
    const d = new Date(trimmed);
    if (Number.isNaN(d.getTime())) {
      return {
        error: `Could not parse "${input}" as a date. Use ISO 8601 (e.g. "2026-05-05T09:00:00Z") or Unix epoch seconds.`,
      };
    }
    unixMs = d.getTime();
  }
  const now = Date.now();
  const maxFuture = now + SLACK_MAX_SCHEDULE_DAYS * 24 * 60 * 60 * 1000;
  if (unixMs < now - 60_000) {
    return { error: `post_at "${input}" is in the past.` };
  }
  if (unixMs > maxFuture) {
    return { error: `post_at "${input}" is more than ${SLACK_MAX_SCHEDULE_DAYS} days in the future.` };
  }
  return { unix: Math.floor(unixMs / 1000), iso: new Date(unixMs).toISOString() };
}

const channelSpecSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(80)
    .describe('Channel name (Slack lowercases, replaces spaces/periods with hyphens, max 80 chars).'),
  is_private: z.boolean().optional().describe('Create as a private channel (default false).'),
  topic: z.string().max(250).optional().describe('Channel topic (short header line, max 250 chars).'),
  purpose: z
    .string()
    .max(250)
    .optional()
    .describe('Channel purpose (longer description shown in channel details, max 250 chars).'),
  members: z
    .array(z.string().min(1))
    .max(1000)
    .optional()
    .describe(
      'Slack user IDs to invite once the channel is created (e.g. ["U123","U456"]). Names/emails are not resolved here — pass real user IDs.',
    ),
});

const usergroupSpecSchema = z.object({
  name: z.string().min(1).describe('Usergroup display name (e.g. "Team Leads").'),
  handle: z
    .string()
    .min(1)
    .max(21)
    .describe('@-mention handle (e.g. "team-leads"). Lowercase letters/digits/hyphens, max 21 chars.'),
  description: z.string().max(140).optional(),
  channel_ids: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Default channels new members of this group will be auto-added to. Each entry can be a literal Slack channel ID (C…/G…) OR a channel name from the same template (resolved at apply time).',
    ),
  user_ids: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Slack user IDs to set as group members (e.g. ["U123"]). Applied only to newly-created groups (no-op when the usergroup is skipped because it already exists).',
    ),
});

const welcomeCanvasSpecSchema = z.object({
  channel_id: z
    .string()
    .min(1)
    .describe(
      'Channel to attach the canvas to. Either a literal Slack channel ID (C…/G…) OR a channel name from the same template / existing workspace (resolved at apply time).',
    ),
  markdown: z.string().min(1).describe('Canvas body in markdown.'),
});

const scheduledMessageSpecSchema = z.object({
  channel_id: z
    .string()
    .min(1)
    .describe(
      'Channel to post the scheduled message in. Either a literal Slack channel ID OR a channel name from the same template / existing workspace.',
    ),
  post_at: z
    .string()
    .min(1)
    .describe(
      `When to post — ISO 8601 (e.g. "2026-05-05T09:00:00Z") or Unix epoch seconds. Future-only, max ${SLACK_MAX_SCHEDULE_DAYS} days out.`,
    ),
  text: z.string().optional().describe('Plain-text body. Required if `blocks` is not provided.'),
  blocks: BlocksSchema.optional().describe('Block Kit blocks. Required if `text` is not provided.'),
});

const templateSpecSchema = z.object({
  name: z.string().optional().describe('Display name for the template (informational).'),
  description: z.string().optional().describe('What this template builds (informational).'),
  channels: z.array(channelSpecSchema).max(200).optional(),
  usergroups: z.array(usergroupSpecSchema).max(50).optional(),
  welcome_canvas: welcomeCanvasSpecSchema.optional(),
  scheduled_messages: z.array(scheduledMessageSpecSchema).max(50).optional(),
});

type TemplateSpec = z.infer<typeof templateSpecSchema>;
type ChannelSpec = z.infer<typeof channelSpecSchema>;
type UsergroupSpec = z.infer<typeof usergroupSpecSchema>;

interface ChannelOutcome {
  status: 'created' | 'skipped_exists' | 'failed';
  name: string;
  id?: string;
  is_private?: boolean;
  topic_set?: 'applied' | 'failed' | 'skipped';
  purpose_set?: 'applied' | 'failed' | 'skipped';
  invited?: number;
  detail?: string;
}

interface UsergroupOutcome {
  status: 'created' | 'skipped_exists' | 'failed';
  name: string;
  handle: string;
  id?: string;
  members_set?: 'applied' | 'failed' | 'skipped';
  detail?: string;
}

interface CanvasOutcome {
  status: 'created' | 'failed';
  channel: string;
  channel_id?: string;
  canvas_id?: string;
  detail?: string;
}

interface ScheduleOutcome {
  status: 'scheduled' | 'failed';
  channel: string;
  channel_id?: string;
  scheduled_message_id?: string;
  post_at_iso?: string;
  detail?: string;
}

interface RollbackLog {
  channels: Array<{ id: string; name: string; tool: 'slack_archive_channel' }>;
  usergroups: Array<{ id: string; name: string; handle: string; tool: 'slack_disable_usergroup' }>;
  canvases: Array<{ canvas_id: string; channel_id: string; tool: 'slack_delete_canvas' }>;
  scheduled_messages: Array<{
    scheduled_message_id: string;
    channel_id: string;
    tool: 'slack_delete_scheduled_message';
  }>;
}

interface ApplySummary {
  channels: ChannelOutcome[];
  usergroups: UsergroupOutcome[];
  welcome_canvas: CanvasOutcome | null;
  scheduled_messages: ScheduleOutcome[];
  rollback: RollbackLog;
}

function emptySummary(): ApplySummary {
  return {
    channels: [],
    usergroups: [],
    welcome_canvas: null,
    scheduled_messages: [],
    rollback: { channels: [], usergroups: [], canvases: [], scheduled_messages: [] },
  };
}

function listBundledTemplates(): string[] {
  if (!existsSync(TEMPLATES_DIR)) return [];
  return readdirSync(TEMPLATES_DIR)
    .filter((f) => f.toLowerCase().endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort();
}

function errorResult(text: string) {
  return { isError: true as const, content: [{ type: 'text' as const, text }] };
}

function loadSpec(
  template_name: string | undefined,
  inlineSpec: TemplateSpec | undefined,
): { spec: TemplateSpec; source: string } | { error: string } {
  if (template_name && inlineSpec) {
    return { error: 'Pass either template_name or spec, not both.' };
  }
  if (template_name) {
    const safe = template_name.trim();
    if (!/^[a-z0-9-]+$/i.test(safe)) {
      return {
        error: `template_name '${template_name}' must contain only letters, digits, and hyphens.`,
      };
    }
    const path = resolve(TEMPLATES_DIR, `${safe}.json`);
    if (!existsSync(path)) {
      const avail = listBundledTemplates();
      return {
        error: `No bundled template '${safe}'. Available: ${avail.join(', ') || '(none)'}`,
      };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf-8'));
    } catch (err) {
      return { error: `Failed to read template '${safe}': ${(err as Error).message}` };
    }
    const parsed = templateSpecSchema.safeParse(raw);
    if (!parsed.success) {
      return { error: `Bundled template '${safe}' failed validation: ${parsed.error.message}` };
    }
    return { spec: parsed.data, source: `template:${safe}` };
  }
  if (inlineSpec) {
    return { spec: inlineSpec, source: 'inline' };
  }
  return { error: 'Pass either template_name (bundled) or spec (inline).' };
}

function previewSpec(spec: TemplateSpec) {
  return {
    name: spec.name ?? null,
    description: spec.description ?? null,
    channels: (spec.channels ?? []).map((c) => ({
      name: c.name,
      visibility: c.is_private ? 'private' : 'public',
      topic: c.topic ?? null,
      purpose: c.purpose ?? null,
      member_count: c.members?.length ?? 0,
    })),
    usergroups: (spec.usergroups ?? []).map((g) => ({
      name: g.name,
      handle: g.handle,
      description: g.description ?? null,
      default_channels: g.channel_ids ?? [],
      user_count: g.user_ids?.length ?? 0,
    })),
    welcome_canvas: spec.welcome_canvas
      ? {
          channel: spec.welcome_canvas.channel_id,
          markdown_preview:
            spec.welcome_canvas.markdown.length > 120
              ? spec.welcome_canvas.markdown.slice(0, 120) + '…'
              : spec.welcome_canvas.markdown,
        }
      : null,
    scheduled_messages: (spec.scheduled_messages ?? []).map((s) => ({
      channel: s.channel_id,
      post_at: s.post_at,
      has_blocks: !!s.blocks,
      text_preview: s.text
        ? s.text.length > 80
          ? s.text.slice(0, 80) + '…'
          : s.text
        : null,
    })),
  };
}

type SlackChannel = Record<string, unknown> & { id?: string; name?: string };
type SlackUsergroup = Record<string, unknown> & {
  id?: string;
  name?: string;
  handle?: string;
};

async function loadExistingChannels(
  slack: ReturnType<typeof getWebClient>,
): Promise<Map<string, SlackChannel>> {
  const byName = new Map<string, SlackChannel>();
  let cursor: string | undefined = undefined;
  do {
    const r = await slack.conversations.list({
      types: 'public_channel,private_channel',
      exclude_archived: false,
      limit: 1000,
      cursor,
    });
    for (const c of (r.channels ?? []) as SlackChannel[]) {
      if (typeof c.name === 'string' && c.id) byName.set(c.name.toLowerCase(), c);
    }
    cursor = r.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return byName;
}

async function loadExistingUsergroups(slack: ReturnType<typeof getWebClient>): Promise<{
  byHandle: Map<string, SlackUsergroup>;
  byName: Map<string, SlackUsergroup>;
}> {
  const byHandle = new Map<string, SlackUsergroup>();
  const byName = new Map<string, SlackUsergroup>();
  const r = await slack.usergroups.list({ include_disabled: true });
  for (const g of (r.usergroups ?? []) as SlackUsergroup[]) {
    if (typeof g.handle === 'string') byHandle.set(g.handle.toLowerCase(), g);
    if (typeof g.name === 'string') byName.set(g.name.toLowerCase(), g);
  }
  return { byHandle, byName };
}

function resolveChannelRef(
  ref: string,
  channelByName: Map<string, SlackChannel>,
): { id: string } | { error: string } {
  if (SLACK_ID_PATTERN.test(ref)) return { id: ref };
  const ch = channelByName.get(ref.toLowerCase());
  if (ch?.id) return { id: ch.id };
  return {
    error: `channel '${ref}' was not found in the workspace and is not a literal Slack ID. Declare it in spec.channels[] or pass an existing ID.`,
  };
}

async function applyChannel(
  slack: ReturnType<typeof getWebClient>,
  spec: ChannelSpec,
  channelByName: Map<string, SlackChannel>,
  rollback: RollbackLog,
): Promise<ChannelOutcome> {
  const key = spec.name.toLowerCase();
  const existing = channelByName.get(key);
  if (existing?.id) {
    return {
      status: 'skipped_exists',
      name: spec.name,
      id: existing.id,
      is_private: (existing as { is_private?: boolean }).is_private ?? false,
    };
  }
  const out: ChannelOutcome = { status: 'created', name: spec.name };
  let createdId: string;
  try {
    const r = await slack.conversations.create({
      name: spec.name,
      is_private: spec.is_private ?? false,
    });
    const ch = (r.channel ?? {}) as SlackChannel;
    if (!ch.id) throw new Error('conversations.create returned no channel id');
    createdId = ch.id;
    out.id = createdId;
    out.is_private = (ch as { is_private?: boolean }).is_private ?? !!spec.is_private;
    channelByName.set(key, ch);
    rollback.channels.push({ id: createdId, name: spec.name, tool: 'slack_archive_channel' });
  } catch (err) {
    return { status: 'failed', name: spec.name, detail: formatSlackError(err) };
  }
  if (spec.topic !== undefined) {
    try {
      await slack.conversations.setTopic({ channel: createdId, topic: spec.topic });
      out.topic_set = 'applied';
    } catch (err) {
      out.topic_set = 'failed';
      out.detail = `topic: ${formatSlackError(err)}`;
    }
  }
  if (spec.purpose !== undefined) {
    try {
      await slack.conversations.setPurpose({ channel: createdId, purpose: spec.purpose });
      out.purpose_set = 'applied';
    } catch (err) {
      out.purpose_set = 'failed';
      const msg = `purpose: ${formatSlackError(err)}`;
      out.detail = out.detail ? `${out.detail}; ${msg}` : msg;
    }
  }
  if (spec.members?.length) {
    try {
      await slack.conversations.invite({ channel: createdId, users: spec.members.join(',') });
      out.invited = spec.members.length;
    } catch (err) {
      out.invited = 0;
      const msg = `invite: ${formatSlackError(err)}`;
      out.detail = out.detail ? `${out.detail}; ${msg}` : msg;
    }
  }
  return out;
}

async function applyUsergroup(
  slack: ReturnType<typeof getWebClient>,
  spec: UsergroupSpec,
  channelByName: Map<string, SlackChannel>,
  ugByHandle: Map<string, SlackUsergroup>,
  ugByName: Map<string, SlackUsergroup>,
  rollback: RollbackLog,
): Promise<UsergroupOutcome> {
  const handleKey = spec.handle.toLowerCase();
  const nameKey = spec.name.toLowerCase();
  const existing = ugByHandle.get(handleKey) ?? ugByName.get(nameKey);
  if (existing?.id) {
    return {
      status: 'skipped_exists',
      name: spec.name,
      handle: spec.handle,
      id: existing.id,
    };
  }
  const channelIds: string[] = [];
  const unresolved: string[] = [];
  for (const ref of spec.channel_ids ?? []) {
    const r = resolveChannelRef(ref, channelByName);
    if ('id' in r) channelIds.push(r.id);
    else unresolved.push(ref);
  }
  let createdId: string;
  try {
    const r = await slack.usergroups.create({
      name: spec.name,
      handle: spec.handle,
      description: spec.description,
      channels: channelIds.length ? channelIds.join(',') : undefined,
    });
    const ug = (r.usergroup ?? {}) as SlackUsergroup;
    if (!ug.id) throw new Error('usergroups.create returned no usergroup id');
    createdId = ug.id;
    ugByHandle.set(handleKey, ug);
    ugByName.set(nameKey, ug);
    rollback.usergroups.push({
      id: createdId,
      name: spec.name,
      handle: spec.handle,
      tool: 'slack_disable_usergroup',
    });
  } catch (err) {
    return {
      status: 'failed',
      name: spec.name,
      handle: spec.handle,
      detail: formatSlackError(err),
    };
  }
  const out: UsergroupOutcome = {
    status: 'created',
    name: spec.name,
    handle: spec.handle,
    id: createdId,
  };
  if (unresolved.length) {
    out.detail = `unresolved default_channel refs (skipped): ${unresolved.join(', ')}`;
  }
  if (spec.user_ids?.length) {
    try {
      await slack.usergroups.users.update({
        usergroup: createdId,
        users: spec.user_ids.join(','),
      });
      out.members_set = 'applied';
    } catch (err) {
      out.members_set = 'failed';
      const msg = `members: ${formatSlackError(err)}`;
      out.detail = out.detail ? `${out.detail}; ${msg}` : msg;
    }
  }
  return out;
}

async function applyTemplate(spec: TemplateSpec): Promise<ApplySummary> {
  const summary = emptySummary();
  const slack = getWebClient();

  let channelByName = new Map<string, SlackChannel>();
  const needsChannelLookup =
    !!spec.channels?.length ||
    !!spec.usergroups?.some((g) => g.channel_ids && g.channel_ids.length) ||
    !!spec.welcome_canvas ||
    !!spec.scheduled_messages?.length;
  if (needsChannelLookup) {
    try {
      channelByName = await loadExistingChannels(slack);
    } catch (err) {
      const detail = `failed to list existing channels: ${formatSlackError(err)}`;
      for (const c of spec.channels ?? []) {
        summary.channels.push({ status: 'failed', name: c.name, detail });
      }
      return summary;
    }
  }

  if (spec.channels?.length) {
    for (const c of spec.channels) {
      summary.channels.push(await applyChannel(slack, c, channelByName, summary.rollback));
    }
  }

  if (spec.usergroups?.length) {
    let ug: { byHandle: Map<string, SlackUsergroup>; byName: Map<string, SlackUsergroup> };
    try {
      ug = await loadExistingUsergroups(slack);
    } catch (err) {
      const detail = `failed to list existing usergroups: ${formatSlackError(err)}`;
      for (const g of spec.usergroups) {
        summary.usergroups.push({
          status: 'failed',
          name: g.name,
          handle: g.handle,
          detail,
        });
      }
      ug = { byHandle: new Map(), byName: new Map() };
    }
    if (ug.byHandle.size > 0 || ug.byName.size > 0 || summary.usergroups.length === 0) {
      for (const g of spec.usergroups) {
        summary.usergroups.push(
          await applyUsergroup(slack, g, channelByName, ug.byHandle, ug.byName, summary.rollback),
        );
      }
    }
  }

  if (spec.welcome_canvas) {
    const ref = spec.welcome_canvas.channel_id;
    const resolved = resolveChannelRef(ref, channelByName);
    if ('error' in resolved) {
      summary.welcome_canvas = { status: 'failed', channel: ref, detail: resolved.error };
    } else {
      try {
        const r = await slack.conversations.canvases.create({
          channel_id: resolved.id,
          document_content: { type: 'markdown', markdown: spec.welcome_canvas.markdown },
        } as unknown as Parameters<typeof slack.conversations.canvases.create>[0]);
        const canvasId = (r.canvas_id as string | undefined) ?? '';
        summary.welcome_canvas = {
          status: 'created',
          channel: ref,
          channel_id: resolved.id,
          canvas_id: canvasId || undefined,
        };
        if (canvasId) {
          summary.rollback.canvases.push({
            canvas_id: canvasId,
            channel_id: resolved.id,
            tool: 'slack_delete_canvas',
          });
        }
      } catch (err) {
        summary.welcome_canvas = {
          status: 'failed',
          channel: ref,
          channel_id: resolved.id,
          detail: formatSlackError(err),
        };
      }
    }
  }

  if (spec.scheduled_messages?.length) {
    for (const sm of spec.scheduled_messages) {
      const ref = sm.channel_id;
      if (!sm.text?.trim() && !sm.blocks?.length) {
        summary.scheduled_messages.push({
          status: 'failed',
          channel: ref,
          detail: 'either text or blocks must be provided',
        });
        continue;
      }
      const parsed = parsePostAt(sm.post_at);
      if ('error' in parsed) {
        summary.scheduled_messages.push({ status: 'failed', channel: ref, detail: parsed.error });
        continue;
      }
      const resolved = resolveChannelRef(ref, channelByName);
      if ('error' in resolved) {
        summary.scheduled_messages.push({
          status: 'failed',
          channel: ref,
          detail: resolved.error,
        });
        continue;
      }
      try {
        const args: Record<string, unknown> = {
          channel: resolved.id,
          post_at: parsed.unix,
          text: sm.text ?? ' ',
        };
        if (sm.blocks) args.blocks = sm.blocks;
        const r = await slack.chat.scheduleMessage(
          args as unknown as Parameters<typeof slack.chat.scheduleMessage>[0],
        );
        const smId = (r.scheduled_message_id as string | undefined) ?? '';
        summary.scheduled_messages.push({
          status: 'scheduled',
          channel: ref,
          channel_id: resolved.id,
          scheduled_message_id: smId || undefined,
          post_at_iso: parsed.iso,
        });
        if (smId) {
          summary.rollback.scheduled_messages.push({
            scheduled_message_id: smId,
            channel_id: resolved.id,
            tool: 'slack_delete_scheduled_message',
          });
        }
      } catch (err) {
        summary.scheduled_messages.push({
          status: 'failed',
          channel: ref,
          channel_id: resolved.id,
          detail: formatSlackError(err),
        });
      }
    }
  }

  return summary;
}

function summarizeCounts(summary: ApplySummary) {
  function tally<T extends { status: string }>(items: T[], statuses: Record<string, string>) {
    const out: Record<string, number> = {};
    for (const key of Object.keys(statuses)) out[key] = 0;
    for (const i of items) {
      const bucket = statuses[i.status];
      if (bucket) out[bucket] = (out[bucket] ?? 0) + 1;
    }
    return out;
  }
  return {
    channels: tally(summary.channels, {
      created: 'created',
      skipped_exists: 'skipped',
      failed: 'failed',
    }),
    usergroups: tally(summary.usergroups, {
      created: 'created',
      skipped_exists: 'skipped',
      failed: 'failed',
    }),
    welcome_canvas: summary.welcome_canvas
      ? { status: summary.welcome_canvas.status }
      : { status: 'not_requested' },
    scheduled_messages: tally(summary.scheduled_messages, {
      scheduled: 'scheduled',
      failed: 'failed',
    }),
  };
}

const TEMPLATE_SCHEMA_DOC =
  'Spec shape: { name?, description?, channels?: [{ name, is_private?, topic?, purpose?, members? }], ' +
  'usergroups?: [{ name, handle, description?, channel_ids?, user_ids? }], ' +
  'welcome_canvas?: { channel_id, markdown }, ' +
  'scheduled_messages?: [{ channel_id, post_at, text?, blocks? }] }. ' +
  'Cross-references (usergroup channel_ids, welcome_canvas.channel_id, scheduled_messages[].channel_id) ' +
  'accept either a literal Slack channel ID OR a channel name from the same template / existing workspace ' +
  '(resolved at apply time). members[] / user_ids[] must be real Slack user IDs.';

export function registerTemplateTools(server: McpServer): void {
  server.registerTool(
    'slack_list_templates',
    {
      description:
        'Lists the bundled workspace templates shipped with this plugin. Use the returned names as `template_name` for slack_apply_template / slack_dry_run_template. Each template is a JSON spec under templates/<name>.json describing channels, usergroups, an optional welcome canvas, and optional scheduled messages.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const names = listBundledTemplates();
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ count: names.length, templates: names }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'slack_dry_run_template',
    {
      description:
        'Previews what slack_apply_template WOULD do without making any API calls. Returns the parsed spec broken down by channels / usergroups / welcome_canvas / scheduled_messages. Use to confirm with the user before applying. Pass either `template_name` (bundled, see slack_list_templates) OR `spec` (inline). ' +
        TEMPLATE_SCHEMA_DOC,
      inputSchema: {
        template_name: z
          .string()
          .optional()
          .describe(
            'Name of a bundled template (from slack_list_templates). Mutually exclusive with `spec`.',
          ),
        spec: templateSpecSchema
          .optional()
          .describe('Inline template object. Mutually exclusive with `template_name`.'),
      },
      annotations: READ_ONLY,
    },
    async ({ template_name, spec: inlineSpec }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      const loaded = loadSpec(template_name, inlineSpec);
      if ('error' in loaded) return errorResult(loaded.error);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                dry_run: true,
                source: loaded.source,
                active_workspace_id: getActiveWorkspaceId(),
                preview: previewSpec(loaded.spec),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    'slack_apply_template',
    {
      description:
        'Applies a workspace template to the active workspace — bulk-creates channels, sets topics/purposes, invites members, creates user groups, attaches a welcome canvas, and schedules messages, all from one JSON spec. ' +
        'Idempotent: channels matching by name and usergroups matching by handle (or name fallback) are SKIPPED, never modified or deleted. Order: channels → usergroups → welcome_canvas → scheduled_messages, so cross-references resolve. ' +
        'Returns a `rollback` log naming each created resource and the destructive tool that undoes it (slack_archive_channel, slack_disable_usergroup, slack_delete_canvas, slack_delete_scheduled_message). ' +
        'Pass either `template_name` (bundled, see slack_list_templates) OR `spec` (inline). Marked DESTRUCTIVE because it creates many resources at once — preview first via slack_dry_run_template. ' +
        TEMPLATE_SCHEMA_DOC,
      inputSchema: {
        template_name: z
          .string()
          .optional()
          .describe(
            'Name of a bundled template (from slack_list_templates). Mutually exclusive with `spec`.',
          ),
        spec: templateSpecSchema
          .optional()
          .describe('Inline template object. Mutually exclusive with `template_name`.'),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ template_name, spec: inlineSpec }) => {
      const guard = activeWorkspaceGuard();
      if (guard) return guard;
      const loaded = loadSpec(template_name, inlineSpec);
      if ('error' in loaded) return errorResult(loaded.error);
      const summary = await applyTemplate(loaded.spec);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                ok: true,
                source: loaded.source,
                active_workspace_id: getActiveWorkspaceId(),
                counts: summarizeCounts(summary),
                summary,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
