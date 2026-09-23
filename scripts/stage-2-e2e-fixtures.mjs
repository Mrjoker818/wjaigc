import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

const BROWSERS = ['chromium', 'chromium-1080p', 'firefox', 'webkit', 'mobile-chromium'];
const PROJECT_ROLES = {
  E2E_STAGE2_LEGACY_PROJECT_IDS: 'legacy',
  E2E_STAGE2_COPY_ON_WRITE_PROJECT_IDS: 'cow',
  E2E_STAGE2_UPLOAD_PROJECT_IDS: 'upload',
  E2E_STAGE2_LIFECYCLE_PROJECT_IDS: 'lifecycle',
  E2E_STAGE2_MISSING_PROJECT_IDS: 'missing',
  E2E_STAGE2_REFRESH_PROJECT_IDS: 'refresh',
  E2E_STAGE2_EMBEDDED_CHAT_PROJECT_IDS: 'embedded-chat',
  E2E_STAGE2_WORKFLOW_PROJECT_IDS: 'workflow',
  E2E_STAGE2_STANDALONE_CHAT_PROJECT_IDS: 'standalone-chat',
  E2E_STAGE2_STANDALONE_TARGET_PROJECT_IDS: 'standalone-target',
  E2E_STAGE2_SHARED_REFERENCE_PROJECT_IDS: 'shared-reference',
  E2E_STAGE2_SHARED_CHAT_PROJECT_IDS: 'shared-chat',
};
const GRAPH_ROLES = new Set([
  'upload', 'lifecycle', 'missing', 'refresh', 'embedded-chat',
  'workflow', 'standalone-target', 'shared-reference',
]);
const ASSET_ROLES = new Set([
  'lifecycle', 'missing', 'refresh', 'embedded-chat',
  'workflow', 'standalone-chat', 'shared',
]);
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAUElEQVR42u3PQQkAAAgEsAtjSMMaxgi+hcEKLNXzWgQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQErsAC6YuBWqb8nNIAAAAASUVORK5CYII=',
  'base64',
);

export function stage2FixturePngBytes() {
  return Buffer.from(PNG_BYTES);
}

export function defaultStage2FixturePaths(runId) {
  const root = resolve(tmpdir(), 'wujie-stage-2-e2e', safeToken(runId));
  return {
    dataRoot: resolve(root, 'data'),
    uploadFixture: resolve(root, 'upload.png'),
    output: resolve(root, 'environment.json'),
  };
}

export function assertStage2OutputOutsideRepository(outputPath, repositoryRoot = process.cwd()) {
  const relativeOutput = relative(resolve(repositoryRoot), resolve(outputPath));
  if (relativeOutput === '' || (!relativeOutput.startsWith('..') && !relativeOutput.includes(':'))) {
    throw new Error('Stage 2 credential output must remain outside the repository');
  }
}

export async function assertStage2DatabaseGuard(query, expectedToken) {
  if (!expectedToken) throw new Error('Stage 2 database guard token is required');
  let result;
  try {
    result = await query(
      'SELECT guard_token FROM wujie_stage2_e2e_guard WHERE guard_token=$1',
      [expectedToken],
    );
  } catch {
    throw new Error('Stage 2 database guard is missing or unreadable');
  }
  if (!Array.isArray(result?.rows) || result.rows.length !== 1 || result.rows[0]?.guard_token !== expectedToken) {
    throw new Error('Stage 2 database guard token does not match this database');
  }
}

function safeToken(value) {
  return String(value).trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function matrixFor(runId, role) {
  return Object.fromEntries(BROWSERS.map(browser => [browser, `stage2-${runId}-${role}-${safeToken(browser)}`]));
}

function assetRecord(runId, browser, role, projectId) {
  const stem = `stage2-${runId}-${role}-${safeToken(browser)}`;
  return {
    role,
    browser,
    projectId,
    assetId: `${stem}-asset`,
    versionId: `${stem}-version`,
    placementId: `${stem}-placement`,
    workflowPlacementId: `${stem}-workflow-placement`,
    chatPlacementId: `${stem}-chat-placement`,
    entityId: `${stem}-entity`,
    filename: `${stem}.png`,
    url: `/api/serve-upload/uploads/${stem}.png`,
  };
}

export function buildStage2FixturePlan(rawRunId) {
  const runId = safeToken(rawRunId);
  if (!runId || runId.length < 4) throw new Error('Stage 2 run id must contain at least four safe characters');
  const projectMatrices = Object.fromEntries(
    Object.entries(PROJECT_ROLES).map(([name, role]) => [name, matrixFor(runId, role)]),
  );
  const legacyProjects = [];
  const graphProjects = [];
  const assets = [];

  for (const browser of BROWSERS) {
    for (const [envName, role] of Object.entries(PROJECT_ROLES)) {
      const id = projectMatrices[envName][browser];
      legacyProjects.push({ id, browser, role });
      if (GRAPH_ROLES.has(role)) graphProjects.push({ id, browser, role });
    }
    for (const role of ASSET_ROLES) {
      const projectRole = role === 'standalone-chat'
        ? 'standalone-target'
        : role === 'shared'
          ? 'shared-reference'
          : role;
      const envName = Object.entries(PROJECT_ROLES).find(([, value]) => value === projectRole)?.[0];
      assets.push(assetRecord(runId, browser, role, projectMatrices[envName][browser]));
    }
  }

  return { runId, browsers: [...BROWSERS], projectMatrices, legacyProjects, graphProjects, assets };
}

export function stringifyStage2Environment(environment) {
  return JSON.stringify(environment, null, 2).replace(/[\u0080-\uffff]/g, character => (
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
  ));
}

export function buildStage2FixtureUsername(baseUsername, runId) {
  const prefix = safeToken(baseUsername).slice(0, 51) || 'stage2-user';
  const runDigest = createHash('sha256').update(String(runId)).digest('hex').slice(0, 12);
  return `${prefix}_${runDigest}`;
}

export function buildStage2FixtureUser({ userId, username }) {
  return {
    id: userId,
    name: username,
    role: 'user',
    status: 'active',
    productType: 'canvas,chat',
  };
}

export function stage2CompletedMigrationCheckpoint(plan, project) {
  const projectAssets = plan.assets.filter(asset => asset.projectId === project.id);
  const legacyImageMappings = Object.fromEntries(projectAssets
    .filter(asset => ['lifecycle', 'missing', 'refresh', 'shared'].includes(asset.role))
    .map(asset => [asset.entityId, {
      assetId: asset.assetId,
      versionId: asset.versionId,
      placementId: asset.placementId,
    }]));
  return {
    id: `stage2-${plan.runId}-${project.role}-${project.browser}-migration`,
    projectId: project.id,
    legacyProjectId: project.id,
    status: 'completed',
    checkpoint: { sourceSchemaVersion: 3, legacyImageMappings },
  };
}

function projectImage(asset, placementId = asset.placementId, availability = 'ready') {
  return {
    id: asset.entityId,
    url: asset.url,
    x: 120,
    y: 100,
    width: 256,
    height: 256,
    originalWidth: 64,
    originalHeight: 64,
    rotation: 0,
    zIndex: 1,
    createdAt: Date.now(),
    prompt: `Stage 2 ${asset.role}`,
    assetId: asset.assetId,
    assetVersionId: asset.versionId,
    placementId,
    mediaAvailability: availability,
  };
}

function workflowFor(asset, projectId) {
  const inputId = `${asset.entityId}-input`;
  const outputId = `${asset.entityId}-output`;
  return {
    id: `${asset.entityId}-workflow`,
    name: `Stage 2 ${asset.browser} workflow`,
    version: 'v1.0',
    status: 'idle',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    nodes: [
      {
        id: inputId,
        type: 'input-image',
        label: 'Stage 2 input',
        x: 100,
        y: 140,
        width: 220,
        height: 180,
        ports: [{ id: `${inputId}-out`, label: 'Image', type: 'image', direction: 'out' }],
        config: {
          source: 'canvas',
          imageUrl: asset.url,
          projectId,
          assetId: asset.assetId,
          assetVersionId: asset.versionId,
          placementId: asset.workflowPlacementId,
        },
      },
      {
        id: outputId,
        type: 'output-image',
        label: 'Stage 2 output',
        x: 500,
        y: 140,
        width: 220,
        height: 180,
        ports: [{ id: `${outputId}-in`, label: 'Image', type: 'image', direction: 'in' }],
        config: {},
      },
    ],
    connections: [{
      id: `${asset.entityId}-connection`,
      fromNodeId: inputId,
      fromPortId: `${inputId}-out`,
      toNodeId: outputId,
      toPortId: `${outputId}-in`,
      type: 'image',
    }],
  };
}

function canvasProject(plan, item) {
  const asset = plan.assets.find(candidate => candidate.browser === item.browser && (
    candidate.role === item.role
    || (item.role === 'standalone-target' && candidate.role === 'standalone-chat')
    || (item.role === 'shared-reference' && candidate.role === 'shared')
  ));
  const base = {
    id: item.id,
    userId: '',
    name: `Stage 2 ${item.role} ${item.browser}`,
    schemaVersion: item.role === 'legacy' || item.role === 'cow' ? 1 : 3,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    settings: {},
    canvasImages: [],
    metadata: {},
  };
  if (item.role === 'legacy' || item.role === 'cow') {
    const legacyAsset = assetRecord(plan.runId, item.browser, item.role, item.id);
    base.canvasImages = [{ ...projectImage(legacyAsset), assetId: undefined, assetVersionId: undefined, placementId: undefined }];
    return base;
  }
  if (['lifecycle', 'refresh', 'missing'].includes(item.role) && asset) {
    base.canvasImages = [projectImage(asset, asset.placementId, item.role === 'missing' ? 'missing' : 'ready')];
  }
  if (item.role === 'shared-reference' && asset) {
    base.canvasImages = [projectImage(asset)];
    base.metadata = { workflow: workflowFor(asset, item.id) };
  }
  if (item.role === 'workflow' && asset) base.metadata = { workflow: workflowFor(asset, item.id) };
  return base;
}

function chatReference(asset, placementId = asset.chatPlacementId) {
  return {
    url: asset.url,
    name: `Stage 2 ${asset.role}`,
    assetId: asset.assetId,
    assetVersionId: asset.versionId,
    placementId,
  };
}

function simpleChatProject(plan, browser, role, sourceRole) {
  const projectId = Object.values(plan.projectMatrices)[Object.values(PROJECT_ROLES).indexOf(role)]?.[browser]
    || Object.entries(PROJECT_ROLES).find(([, value]) => value === role)?.[0]
      && plan.projectMatrices[Object.entries(PROJECT_ROLES).find(([, value]) => value === role)[0]][browser];
  const asset = plan.assets.find(candidate => candidate.browser === browser && candidate.role === sourceRole);
  const messageId = `stage2-${plan.runId}-${role}-${browser}-message`;
  const taskId = `stage2-${plan.runId}-${role}-${browser}-task`;
  return {
    id: projectId,
    name: `Stage 2 ${role} ${browser}`,
    description: '',
    emoji: 'S2',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tasks: [{
      id: taskId,
      projectId,
      name: 'Stage 2 asset transfer',
      messages: [{
        id: messageId,
        role: 'assistant',
        content: 'Stage 2 managed image',
        images: [asset.url],
        imageRefs: [chatReference(asset)],
        createdAt: Date.now(),
      }],
      model: '',
      providerId: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }],
    agents: [],
    knowledgeItems: [],
  };
}

export function stage2PlacementEntityId(asset, entityType) {
  if (entityType === 'canvas-image') return asset.entityId;
  if (entityType === 'workflow-input') return `${asset.entityId}-input`;
  return `${asset.entityId}:${entityType}`;
}

async function insertPlacement(client, asset, ownerId, workspace, workspaceId, entityType, placementId) {
  await client.query(
    `INSERT INTO wujie_workspace_placements(
       id, owner_id, project_id, asset_id, asset_version_id, workspace_kind,
       workspace_id, entity_type, entity_id, status, transform, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active','{}'::jsonb,$10::jsonb)`,
    [placementId, ownerId, asset.projectId, asset.assetId, asset.versionId, workspace,
      workspaceId, entityType, stage2PlacementEntityId(asset, entityType), JSON.stringify({ source: 'stage-2-e2e', role: asset.role })],
  );
}

async function seedDatabase(plan, options) {
  const client = new Client({ connectionString: options.databaseUrl, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    await assertStage2DatabaseGuard(client.query.bind(client), options.databaseGuard);
    await client.query('BEGIN');
    const now = Date.now();
    const passwordHash = createHash('sha256').update(`${options.authSecret}:${options.password}`).digest('hex');
    const fixtureUser = buildStage2FixtureUser(options);
    await client.query(
      `INSERT INTO wujie_users(id,name,password_hash,role,status,product_type,api_permissions,storage_folder,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$9)
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name,
         password_hash=EXCLUDED.password_hash,
         role=EXCLUDED.role,
         status=EXCLUDED.status,
         product_type=EXCLUDED.product_type,
         api_permissions=EXCLUDED.api_permissions,
         updated_at=EXCLUDED.updated_at`,
      [fixtureUser.id, fixtureUser.name, passwordHash, fixtureUser.role, fixtureUser.status,
        fixtureUser.productType, JSON.stringify({ image: true, chat: true, threeD: true, imageEdit: true, vectorize: true, vlm: true, layer: true, video: true, upscaler: true, removebg: true, audio: true }),
        `data/users/${options.userId}`, now],
    );
    await client.query(
      `INSERT INTO wujie_system_settings(key,value,updated_at) VALUES ('auth_secret',$1::jsonb,$2)
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=EXCLUDED.updated_at`,
      [JSON.stringify(options.authSecret), now],
    );

    const projects = plan.legacyProjects.map(item => ({ ...canvasProject(plan, item), userId: options.userId }));
    await client.query(
      `INSERT INTO wujie_user_data(user_id,data_key,data_value,updated_at) VALUES ($1,'projects',$2::jsonb,$3)
       ON CONFLICT (user_id,data_key) DO UPDATE SET data_value=EXCLUDED.data_value,updated_at=EXCLUDED.updated_at`,
      [options.userId, JSON.stringify(projects), now],
    );

    for (const project of plan.graphProjects) {
      await client.query(
        `INSERT INTO wujie_projects(id,owner_id,name,status,schema_version,metadata)
         VALUES ($1,$2,$3,'active',3,$4::jsonb)`,
        [project.id, options.userId, `Stage 2 ${project.role} ${project.browser}`, JSON.stringify({ runId: plan.runId, role: project.role })],
      );
      const migration = stage2CompletedMigrationCheckpoint(plan, project);
      await client.query(
        `INSERT INTO wujie_asset_migration_checkpoints(
           id,owner_id,project_id,legacy_project_id,status,checkpoint
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        [migration.id, options.userId, migration.projectId, migration.legacyProjectId,
          migration.status, JSON.stringify(migration.checkpoint)],
      );
    }

    for (const asset of plan.assets) {
      await client.query(
        `INSERT INTO wujie_assets(id,owner_id,project_id,kind,status,metadata)
         VALUES ($1,$2,$3,'image','active',$4::jsonb)`,
        [asset.assetId, options.userId, asset.projectId, JSON.stringify({ runId: plan.runId, role: asset.role })],
      );
      await client.query(
        `INSERT INTO wujie_asset_versions(
           id,asset_id,owner_id,project_id,file_url,storage_key,mime_type,byte_size,width,height,availability,metadata
         ) VALUES ($1,$2,$3,$4,$5,$6,'image/png',$7,64,64,$8,$9::jsonb)`,
        [asset.versionId, asset.assetId, options.userId, asset.projectId, asset.url,
          `uploads/${asset.filename}`, PNG_BYTES.length, asset.role === 'missing' ? 'missing' : 'ready',
          JSON.stringify({ runId: plan.runId, role: asset.role })],
      );
      await client.query('UPDATE wujie_assets SET current_version_id=$2 WHERE id=$1', [asset.assetId, asset.versionId]);

      if (['lifecycle', 'missing', 'refresh', 'shared'].includes(asset.role)) {
        await insertPlacement(client, asset, options.userId, 'canvas', `canvas:${asset.projectId}`, 'canvas-image', asset.placementId);
      }
      if (['workflow', 'shared'].includes(asset.role)) {
        await insertPlacement(client, asset, options.userId, 'workflow', `${asset.entityId}-workflow`, 'workflow-input', asset.workflowPlacementId);
      }
      if (['embedded-chat', 'standalone-chat', 'shared'].includes(asset.role)) {
        await insertPlacement(client, asset, options.userId, 'chat', `chat:${asset.projectId}`, 'chat-result', asset.chatPlacementId);
      }
    }

    const embeddedAssets = plan.assets.filter(asset => asset.role === 'embedded-chat');
    const embeddedSession = [{
      id: `stage2-${plan.runId}-embedded-session`,
      title: 'Stage 2 embedded chat',
      messages: [{
        id: `stage2-${plan.runId}-embedded-message`,
        role: 'assistant',
        content: 'Stage 2 managed images',
        timestamp: now,
        generatedImages: embeddedAssets.map(asset => asset.url),
        generatedImageRefs: embeddedAssets.map(asset => chatReference(asset)),
      }],
      model: '',
      systemPrompt: '',
      createdAt: now,
      updatedAt: now,
    }];
    await client.query(
      `INSERT INTO wujie_user_data(user_id,data_key,data_value,updated_at) VALUES ($1,'chat_sessions',$2::jsonb,$3)
       ON CONFLICT (user_id,data_key) DO UPDATE SET data_value=EXCLUDED.data_value,updated_at=EXCLUDED.updated_at`,
      [options.userId, JSON.stringify(embeddedSession), now],
    );

    const simpleProjects = BROWSERS.flatMap(browser => [
      simpleChatProject(plan, browser, 'standalone-chat', 'standalone-chat'),
      simpleChatProject(plan, browser, 'shared-chat', 'shared'),
    ]);
    await client.query(
      `INSERT INTO wujie_user_data(user_id,data_key,data_value,updated_at) VALUES ($1,'chat_simple_projects',$2::jsonb,$3)
       ON CONFLICT (user_id,data_key) DO UPDATE SET data_value=EXCLUDED.data_value,updated_at=EXCLUDED.updated_at`,
      [options.userId, JSON.stringify(simpleProjects), now],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

async function writeMedia(plan, dataRoot, uploadFixture) {
  const uploads = resolve(dataRoot, 'uploads');
  await mkdir(uploads, { recursive: true });
  for (const project of plan.legacyProjects.filter(item => item.role === 'legacy' || item.role === 'cow')) {
    const asset = assetRecord(plan.runId, project.browser, project.role, project.id);
    await writeFile(resolve(uploads, asset.filename), PNG_BYTES);
  }
  for (const asset of plan.assets.filter(item => item.role !== 'missing')) {
    await writeFile(resolve(uploads, asset.filename), PNG_BYTES);
  }
  await mkdir(dirname(uploadFixture), { recursive: true });
  await writeFile(uploadFixture, PNG_BYTES);
}

function environmentFor(plan, options) {
  const env = {
    E2E_BASE_URL: options.baseUrl,
    E2E_TEST_USERNAME: options.username,
    E2E_TEST_PASSWORD: options.password,
    E2E_STAGE2_DATABASE_URL: options.databaseUrl,
    E2E_STAGE2_RUN_ID: plan.runId,
    E2E_STAGE2_UPLOAD_FIXTURE: options.uploadFixture,
  };
  for (const [name, matrix] of Object.entries(plan.projectMatrices)) env[name] = JSON.stringify(matrix);
  const assetsByRole = role => Object.fromEntries(BROWSERS.map(browser => {
    const asset = plan.assets.find(candidate => candidate.browser === browser && candidate.role === role);
    return [browser, asset];
  }));
  const lifecycle = assetsByRole('lifecycle');
  const missing = assetsByRole('missing');
  const embedded = assetsByRole('embedded-chat');
  const standalone = assetsByRole('standalone-chat');
  const shared = assetsByRole('shared');
  env.E2E_STAGE2_LIFECYCLE_ASSET_IDS = JSON.stringify(Object.fromEntries(BROWSERS.map(browser => [browser, lifecycle[browser].assetId])));
  env.E2E_STAGE2_LIFECYCLE_VERSION_IDS = JSON.stringify(Object.fromEntries(BROWSERS.map(browser => [browser, lifecycle[browser].versionId])));
  env.E2E_STAGE2_LIFECYCLE_PLACEMENT_IDS = JSON.stringify(Object.fromEntries(BROWSERS.map(browser => [browser, lifecycle[browser].placementId])));
  env.E2E_STAGE2_MISSING_FILENAMES = JSON.stringify(Object.fromEntries(BROWSERS.map(browser => [browser, missing[browser].filename])));
  env.E2E_STAGE2_EMBEDDED_CHAT_SOURCE_URLS = JSON.stringify(Object.fromEntries(BROWSERS.map(browser => [browser, embedded[browser].url])));
  env.E2E_STAGE2_STANDALONE_SOURCE_URLS = JSON.stringify(Object.fromEntries(BROWSERS.map(browser => [browser, standalone[browser].url])));
  env.E2E_STAGE2_SHARED_ASSET_IDS = JSON.stringify(Object.fromEntries(BROWSERS.map(browser => [browser, shared[browser].assetId])));
  env.E2E_STAGE2_SHARED_VERSION_IDS = JSON.stringify(Object.fromEntries(BROWSERS.map(browser => [browser, shared[browser].versionId])));
  env.E2E_STAGE2_SHARED_PLACEMENT_IDS = JSON.stringify(Object.fromEntries(BROWSERS.map(browser => [browser, shared[browser].placementId])));
  return env;
}

async function main() {
  if (process.env.E2E_STAGE2_ALLOW_SEED !== '1') throw new Error('Set E2E_STAGE2_ALLOW_SEED=1 to seed controlled fixtures');
  const databaseUrl = process.env.E2E_STAGE2_DATABASE_URL?.trim();
  const runId = process.env.E2E_STAGE2_RUN_ID?.trim();
  const username = process.env.E2E_TEST_USERNAME?.trim();
  const password = process.env.E2E_TEST_PASSWORD?.trim();
  const authSecret = process.env.WUJIE_AUTH_SECRET?.trim();
  const databaseGuard = process.env.E2E_STAGE2_DATABASE_GUARD?.trim();
  if (!databaseUrl || !runId || !username || !password || !authSecret || !databaseGuard) {
    throw new Error('E2E_STAGE2_DATABASE_URL, E2E_STAGE2_DATABASE_GUARD, E2E_STAGE2_RUN_ID, E2E_TEST_USERNAME, E2E_TEST_PASSWORD and WUJIE_AUTH_SECRET are required');
  }
  if (authSecret.length < 32) {
    throw new Error('WUJIE_AUTH_SECRET must contain at least 32 characters');
  }
  const plan = buildStage2FixturePlan(runId);
  const defaults = defaultStage2FixturePaths(plan.runId);
  const dataRoot = resolve(process.env.WUJIE_DATA_DIR || defaults.dataRoot);
  const uploadFixture = resolve(process.env.E2E_STAGE2_UPLOAD_FIXTURE || defaults.uploadFixture);
  const output = resolve(process.env.E2E_STAGE2_ENV_OUTPUT || defaults.output);
  assertStage2OutputOutsideRepository(output);
  const options = {
    databaseUrl,
    runId: plan.runId,
    username: buildStage2FixtureUsername(username, plan.runId),
    password,
    authSecret,
    databaseGuard,
    userId: `stage2-user-${plan.runId}`,
    dataRoot,
    uploadFixture,
    baseUrl: process.env.E2E_BASE_URL || 'http://127.0.0.1:5002',
  };
  await seedDatabase(plan, options);
  await writeMedia(plan, dataRoot, uploadFixture);
  const environment = environmentFor(plan, options);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, stringifyStage2Environment(environment), { encoding: 'ascii', mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ runId: plan.runId, userId: options.userId, projectCount: plan.legacyProjects.length, assetCount: plan.assets.length, output }, null, 2)}\n`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) main().catch(error => { console.error(error); process.exitCode = 1; });
