import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const requireFromStage4Fixture = createRequire(import.meta.url);
const requireFromPg = createRequire(requireFromStage4Fixture.resolve('pg/lib/connection-parameters'));
const parsePgConnectionString = requireFromPg('pg-connection-string').parse;

const BROWSER_PROFILES = [
  'chromium',
  'chromium-1080p',
  'firefox',
  'webkit',
  'mobile-chromium',
];

function safeToken(value) {
  return String(value).trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

export function stage4UsernameRunToken(value) {
  const normalized = safeToken(value).toLowerCase().replaceAll('-', '_');
  return normalized.length <= 9
    ? normalized
    : createHash('sha256').update(normalized).digest('hex').slice(0, 9);
}

function makePorts(index, total) {
  if (index === 0) {
    return [
      { id: `node-${index}-out-text`, label: '文本', type: 'prompt', direction: 'out' },
    ];
  }
  if (index === total - 1) {
    return [
      { id: `node-${index}-in-image`, label: '图片', type: 'image', direction: 'in' },
    ];
  }
  return [
    { id: `node-${index}-in-text`, label: '输入', type: 'prompt', direction: 'in' },
    { id: `node-${index}-out-text`, label: '输出', type: 'prompt', direction: 'out' },
  ];
}

function makeNode(index, total) {
  const type = index === 0
    ? 'input-text'
    : index === total - 1
      ? 'output-image'
      : 'ai-llm';
  const ports = makePorts(index, total);

  return {
    id: `stage4-node-${index + 1}`,
    type,
    label: `Stage 4 Node ${index + 1}`,
    x: 80 + (index % 10) * 400,
    y: 80 + Math.floor(index / 10) * 260,
    width: 200,
    height: 92,
    ports,
    config: index === 0
      ? { textContent: 'Stage 4 baseline legacy workflow' }
      : { prompt: `Step ${index + 1}` },
  };
}

function makeConnections(total) {
  return Array.from({ length: total - 1 }, (_, index) => {
    const fromId = `stage4-node-${index + 1}`;
    const toId = `stage4-node-${index + 2}`;
    return {
      id: `stage4-connection-${index + 1}`,
      fromNodeId: fromId,
      fromPortId: index === 0 ? `node-${index}-out-text` : `node-${index}-out-text`,
      toNodeId: toId,
      toPortId: index + 1 === total - 1 ? `node-${index + 1}-in-image` : `node-${index + 1}-in-text`,
      type: index + 1 === total - 1 ? 'image' : 'prompt',
    };
  });
}

function buildWorkflow(profileId, runId, nodeCount = 100) {
  return {
    id: `stage4-workflow-${runId}-${profileId}`,
    name: `Stage 4 ${profileId} workflow`,
    version: 'v1.0',
    nodes: Array.from({ length: nodeCount }, (_, index) => makeNode(index, nodeCount)),
    connections: makeConnections(nodeCount),
    status: 'idle',
    createdAt: 1786838400000,
    updatedAt: 1786838400000,
    description: 'Stage 4 legacy baseline fixture workflow',
  };
}

function buildCanvasProject(runId, profileId, workflow) {
  return {
    id: `stage4-canvas-${runId}-${profileId}`,
    userId: '',
    name: `Stage 4 Canvas ${profileId}`,
    schemaVersion: 3,
    createdAt: 1786838400000,
    updatedAt: 1786838400000,
    settings: {},
    canvasImages: [
      {
        id: `stage4-image-${profileId}`,
        url: '/logo.png',
        x: 96,
        y: 96,
        width: 160,
        height: 160,
        originalWidth: 160,
        originalHeight: 160,
        rotation: 0,
        zIndex: 1,
        createdAt: 1786838400000,
        prompt: 'Stage 4 baseline image',
      },
    ],
    metadata: {
      workflow,
      stage4RunId: runId,
      stage4BrowserProfile: profileId,
    },
  };
}

function buildChatProject(runId, profileId) {
  const projectId = `stage4-chat-${runId}-${profileId}`;
  const taskId = `stage4-chat-task-${profileId}`;
  return {
    id: projectId,
    name: `Stage 4 Chat ${profileId}`,
    description: 'Stage 4 legacy baseline seeded chat project',
    emoji: 'S4',
    createdAt: 1786838400000,
    updatedAt: 1786838400000,
    tasks: [
      {
        id: taskId,
        projectId,
        name: 'Stage 4 baseline task',
        messages: [
          {
            id: `stage4-chat-message-${profileId}`,
            role: 'user',
            content: 'Stage 4 baseline placeholder',
            createdAt: 1786838400000,
          },
        ],
        model: '',
        providerId: '',
        createdAt: 1786838400000,
        updatedAt: 1786838400000,
      },
    ],
    agents: [
      {
        id: `stage4-agent-${profileId}`,
        name: 'Stage 4 Agent',
        description: 'Baseline seeded agent',
        systemPrompt: 'You are the Stage 4 baseline seeded agent.',
        tools: ['analyze_image'],
        createdAt: 1786838400000,
        updatedAt: 1786838400000,
      },
    ],
    knowledgeItems: [],
  };
}

function normalizeStage4RunId(rawRunId) {
  if (!rawRunId || !String(rawRunId).trim()) {
    throw new Error('BLOCKED: E2E_STAGE4_RUN_ID is required for Stage 4 fixture isolation');
  }
  const runId = String(rawRunId).trim();
  if (runId.length < 4 || runId.length > 80 || safeToken(runId) !== runId) {
    throw new Error('BLOCKED: E2E_STAGE4_RUN_ID must contain 4-80 letters, numbers, underscores, or hyphens');
  }
  return runId.toLowerCase().replaceAll('-', '_');
}

function stage4DatabaseTarget(rawUrl, rawRunId) {
  if (!rawUrl || !String(rawUrl).trim()) {
    throw new Error('BLOCKED: E2E_STAGE4_DATABASE_URL is required for Stage 4 fixture isolation');
  }
  const normalizedRunId = normalizeStage4RunId(rawRunId);
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Stage 4 fixture database URL must be a valid URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('Stage 4 fixture database URL must use postgres or postgresql');
  }

  const allowedQueryKeys = new Set(['sslmode']);
  const allowedSslModes = new Set(['disable', 'prefer', 'require', 'verify-ca', 'verify-full', 'no-verify']);
  const queryEntries = [...parsed.searchParams.entries()];
  if (
    queryEntries.some(([key]) => key !== key.toLowerCase() || !allowedQueryKeys.has(key))
    || queryEntries.filter(([key]) => key === 'sslmode').length > 1
  ) {
    throw new Error('BLOCKED: Stage 4 fixture database URL must not use connection query parameters other than sslmode');
  }
  const sslMode = parsed.searchParams.get('sslmode') || '';
  if (sslMode && (!allowedSslModes.has(sslMode) || sslMode !== sslMode.toLowerCase())) {
    throw new Error('BLOCKED: Stage 4 fixture database URL sslmode is not allowed');
  }

  const parserUrl = new URL(parsed);
  if (sslMode === 'require') {
    parserUrl.searchParams.set('uselibpqcompat', 'true');
  }
  let connectionConfig;
  try {
    connectionConfig = parsePgConnectionString(parserUrl.toString());
  } catch {
    throw new Error('Stage 4 fixture database URL could not be parsed safely');
  }

  const hostname = String(connectionConfig.host || '').toLowerCase();
  if (!hostname) {
    throw new Error('Stage 4 fixture database host is required');
  }
  if (/(^|[._-])(prod|production|shared|stable|main|primary|restore)([._-]|$)/i.test(hostname)) {
    throw new Error('BLOCKED: Stage 4 fixture database must not use a production-looking database host');
  }

  const databaseName = String(connectionConfig.database || '');
  const username = String(connectionConfig.user || '');
  const expectedDatabaseName = `wujie_stage4_${normalizedRunId}`;
  if (databaseName !== expectedDatabaseName) {
    throw new Error(`BLOCKED: Stage 4 fixture database name must exactly match ${expectedDatabaseName}`);
  }
  if (!username) {
    throw new Error('BLOCKED: Stage 4 fixture database user is required');
  }

  return {
    protocol: 'postgresql:',
    hostname,
    port: String(connectionConfig.port || '5432'),
    databaseName,
    username,
    sslMode,
    sslEnabled: connectionConfig.ssl === false ? false : Boolean(connectionConfig.ssl),
    sslRejectUnauthorized: connectionConfig.ssl && typeof connectionConfig.ssl === 'object'
      ? connectionConfig.ssl.rejectUnauthorized !== false
      : null,
  };
}

export function assertStage4FixtureDatabase(rawUrl, rawRunId) {
  stage4DatabaseTarget(rawUrl, rawRunId);
}

/** @param {Record<string, string | undefined>} [environment] */
export function assertStage4FixtureDatabaseEnvironment(environment = process.env) {
  const fixtureUrl = environment.E2E_STAGE4_DATABASE_URL?.trim();
  const runId = environment.E2E_STAGE4_RUN_ID?.trim();
  const fixtureTarget = stage4DatabaseTarget(fixtureUrl, runId);

  const databaseUrl = environment.DATABASE_URL;
  const pgDatabaseUrl = environment.PGDATABASE_URL;
  const applicationUrl = databaseUrl || pgDatabaseUrl;
  if (!applicationUrl || !String(applicationUrl).trim()) {
    throw new Error('BLOCKED: application database URL (PGDATABASE_URL or DATABASE_URL) is required for Stage 4 fixture isolation');
  }
  const applicationTarget = stage4DatabaseTarget(applicationUrl, runId);
  if (databaseUrl && pgDatabaseUrl) {
    const databaseTarget = stage4DatabaseTarget(databaseUrl, runId);
    const pgDatabaseTarget = stage4DatabaseTarget(pgDatabaseUrl, runId);
    if (JSON.stringify(databaseTarget) !== JSON.stringify(pgDatabaseTarget)) {
      throw new Error('BLOCKED: configured database targets must match exactly for Stage 4 fixture isolation');
    }
  }
  if (JSON.stringify(fixtureTarget) !== JSON.stringify(applicationTarget)) {
    throw new Error('BLOCKED: application database target must exactly match E2E_STAGE4_DATABASE_URL for Stage 4 fixture isolation');
  }
}

export function buildStage4FixturePlan(rawRunId) {
  const runId = safeToken(rawRunId);
  if (!runId || runId.length < 4) {
    throw new Error('Stage 4 run id must contain at least four safe characters');
  }

  const workflows = BROWSER_PROFILES.map(profileId => {
    const workflow = buildWorkflow(profileId, runId, 100);
    return {
      id: workflow.id,
      browserProfile: profileId,
      nodeCount: workflow.nodes.length,
      expectedNodeIds: workflow.nodes.map(node => node.id),
      workflow,
      canvasProject: buildCanvasProject(runId, profileId, workflow),
      chatProject: buildChatProject(runId, profileId),
    };
  });

  const users = BROWSER_PROFILES.map(profileId => ({
    id: `stage4-user-${runId}-${profileId}`,
    browserProfile: profileId,
    username: `stage4_${profileId.replaceAll('-', '_')}_${stage4UsernameRunToken(runId)}`,
    password: `Stage4!${runId}${profileId.slice(0, 3)}`,
  }));

  const browserProfiles = BROWSER_PROFILES.map(profileId => ({
    id: profileId,
    userId: users.find(user => user.browserProfile === profileId).id,
    workflowId: workflows.find(item => item.browserProfile === profileId).id,
  }));

  return {
    runId,
    browserProfiles,
    users,
    workflows,
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const runId = process.env.E2E_STAGE4_RUN_ID?.trim() || `stage4-${Date.now()}`;
  const plan = buildStage4FixturePlan(runId);
  process.stdout.write(`${JSON.stringify({
    runId: plan.runId,
    browserProfiles: plan.browserProfiles,
    userIds: plan.users.map(user => user.id),
    workflowIds: plan.workflows.map(workflow => workflow.id),
  }, null, 2)}\n`);
}
