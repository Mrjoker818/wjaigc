import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

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
    x: 80 + (index % 10) * 240,
    y: 80 + Math.floor(index / 10) * 140,
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

export function assertStage4FixtureDatabase(rawUrl) {
  if (!rawUrl) return;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Stage 4 fixture database URL must be a valid URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('Stage 4 fixture database URL must use postgres or postgresql');
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
      workflow,
      canvasProject: buildCanvasProject(runId, profileId, workflow),
      chatProject: buildChatProject(runId, profileId),
    };
  });

  const users = BROWSER_PROFILES.map(profileId => ({
    id: `stage4-user-${runId}-${profileId}`,
    browserProfile: profileId,
    username: `stage4_${profileId}_${runId}`,
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
