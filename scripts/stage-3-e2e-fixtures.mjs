import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

const BROWSERS = ['chromium', 'chromium-1080p', 'firefox', 'webkit', 'mobile-chromium'];
const NODE_COUNTS = [1, 100, 300];
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAUElEQVR42u3PQQkAAAgEsAtjSMMaxgi+hcEKLNXzWgQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQErsAC6YuBWqb8nNIAAAAASUVORK5CYII=',
  'base64',
);

function safeToken(value) {
  return String(value).trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

export function stage3FixturePngBytes() {
  return Buffer.from(PNG_BYTES);
}

export function defaultStage3FixturePaths(runId) {
  const root = resolve(tmpdir(), 'wujie-stage-3-e2e', safeToken(runId));
  return {
    dataRoot: resolve(root, 'data'),
    output: resolve(root, 'environment.json'),
  };
}

export function assertStage3OutputOutsideRepository(outputPath, repositoryRoot = process.cwd()) {
  const relativeOutput = relative(resolve(repositoryRoot), resolve(outputPath));
  if (relativeOutput === '' || (!relativeOutput.startsWith('..') && !relativeOutput.includes(':'))) {
    throw new Error('Stage 3 credential output must remain outside the repository');
  }
}

export async function assertStage3DatabaseGuard(query, expectedToken) {
  if (!expectedToken) throw new Error('Stage 3 database guard token is required');
  let result;
  try {
    result = await query(
      'SELECT guard_token FROM wujie_stage3_e2e_guard WHERE guard_token=$1',
      [expectedToken],
    );
  } catch {
    throw new Error('Stage 3 database guard is missing or unreadable');
  }
  if (!Array.isArray(result?.rows) || result.rows.length !== 1 || result.rows[0]?.guard_token !== expectedToken) {
    throw new Error('Stage 3 database guard token does not match this database');
  }
}

function buildImages(runId, browser, nodeCount, url) {
  const columns = nodeCount === 1 ? 1 : 20;
  return Array.from({ length: nodeCount }, (_, index) => {
    const id = `s3-${runId}-${safeToken(browser)}-${nodeCount}-${index}`;
    return {
      id,
      url,
      x: 80 + (index % columns) * 132,
      y: 80 + Math.floor(index / columns) * 132,
      width: 96,
      height: 96,
      originalWidth: 64,
      originalHeight: 64,
      rotation: 0,
      zIndex: index + 1,
      createdAt: 1786550400000 + index,
      prompt: id,
      mediaAvailability: 'ready',
    };
  });
}

export function buildStage3FixturePlan(rawRunId) {
  const runId = safeToken(rawRunId);
  if (!runId || runId.length < 4) throw new Error('Stage 3 run id must contain at least four safe characters');
  const filename = `stage3-${runId}.png`;
  const url = `/api/serve-upload/uploads/${filename}`;
  const projects = BROWSERS.flatMap(browser => NODE_COUNTS.map(nodeCount => {
    const id = `stage3-${runId}-${safeToken(browser)}-${nodeCount}`;
    return {
      id,
      browser,
      nodeCount,
      images: buildImages(runId, browser, nodeCount, url),
    };
  }));
  const projectMatrix = Object.fromEntries(BROWSERS.map(browser => [
    browser,
    Object.fromEntries(NODE_COUNTS.map(nodeCount => [
      String(nodeCount),
      projects.find(project => project.browser === browser && project.nodeCount === nodeCount).id,
    ])),
  ]));
  return { runId, browsers: [...BROWSERS], nodeCounts: [...NODE_COUNTS], filename, url, projects, projectMatrix };
}

export function buildStage3CleanupPlan({ ownerId, runId, projectIds }) {
  if (!ownerId || !runId || !Array.isArray(projectIds) || projectIds.length === 0) {
    throw new Error('Stage 3 cleanup requires owner, run id and exact project ids');
  }
  const params = [ownerId, runId, [...projectIds]];
  const scopedProjectRows = "owner_id = $1 AND metadata->>'stage3RunId' = $2 AND project_id = ANY($3::text[])";
  const scopedProjects = "owner_id = $1 AND metadata->>'stage3RunId' = $2 AND id = ANY($3::text[])";
  return [
    { sql: `DELETE FROM wujie_workspace_placements WHERE ${scopedProjectRows}`, params },
    { sql: `DELETE FROM wujie_asset_versions WHERE ${scopedProjectRows}`, params },
    { sql: `DELETE FROM wujie_assets WHERE ${scopedProjectRows}`, params },
    { sql: `DELETE FROM wujie_projects WHERE ${scopedProjects}`, params },
  ];
}

function buildFixtureUsername(baseUsername, runId) {
  const prefix = safeToken(baseUsername).slice(0, 51) || 'stage3-user';
  const digest = createHash('sha256').update(String(runId)).digest('hex').slice(0, 12);
  return `${prefix}_${digest}`;
}

function canvasProject(plan, project, userId) {
  return {
    id: project.id,
    userId,
    name: `Stage 3 ${project.nodeCount} nodes ${project.browser}`,
    schemaVersion: 1,
    createdAt: 1786550400000,
    updatedAt: 1786550400000,
    settings: {},
    canvasImages: project.images,
    metadata: {
      stage3RunId: plan.runId,
      browser: project.browser,
      nodeCount: project.nodeCount,
    },
  };
}

async function cleanupGraph(client, plan, ownerId) {
  const cleanup = buildStage3CleanupPlan({
    ownerId,
    runId: plan.runId,
    projectIds: plan.projects.map(project => project.id),
  });
  for (const statement of cleanup) await client.query(statement.sql, statement.params);
}

async function seedDatabase(plan, options) {
  const client = new Client({ connectionString: options.databaseUrl, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    await assertStage3DatabaseGuard(client.query.bind(client), options.databaseGuard);
    await client.query('BEGIN');
    await cleanupGraph(client, plan, options.userId);
    const now = Date.now();
    const passwordHash = createHash('sha256').update(`${options.authSecret}:${options.password}`).digest('hex');
    await client.query(
      `INSERT INTO wujie_users(id,name,password_hash,role,status,product_type,api_permissions,storage_folder,created_at,updated_at)
       VALUES ($1,$2,$3,'user','active','canvas,chat',$4::jsonb,$5,$6,$6)
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name,password_hash=EXCLUDED.password_hash,status='active',
         product_type=EXCLUDED.product_type,api_permissions=EXCLUDED.api_permissions,updated_at=EXCLUDED.updated_at`,
      [
        options.userId,
        options.username,
        passwordHash,
        JSON.stringify({ image: true, chat: true, imageEdit: true }),
        `data/users/${options.userId}`,
        now,
      ],
    );
    await client.query(
      `INSERT INTO wujie_system_settings(key,value,updated_at) VALUES ('auth_secret',$1::jsonb,$2)
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=EXCLUDED.updated_at`,
      [JSON.stringify(options.authSecret), now],
    );
    const projects = plan.projects.map(project => canvasProject(plan, project, options.userId));
    await client.query(
      `INSERT INTO wujie_user_data(user_id,data_key,data_value,updated_at) VALUES ($1,'projects',$2::jsonb,$3)
       ON CONFLICT (user_id,data_key) DO UPDATE SET data_value=EXCLUDED.data_value,updated_at=EXCLUDED.updated_at`,
      [options.userId, JSON.stringify(projects), now],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

async function writeMedia(plan, dataRoot) {
  const uploads = resolve(dataRoot, 'uploads');
  await mkdir(uploads, { recursive: true });
  await writeFile(resolve(uploads, plan.filename), PNG_BYTES);
}

function stringifyEnvironment(environment) {
  return JSON.stringify(environment, null, 2).replace(/[\u0080-\uffff]/g, character => (
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
  ));
}

async function main() {
  if (process.env.E2E_STAGE3_ALLOW_SEED !== '1') {
    throw new Error('Set E2E_STAGE3_ALLOW_SEED=1 to seed controlled Stage 3 fixtures');
  }
  const databaseUrl = process.env.E2E_STAGE3_DATABASE_URL?.trim();
  const databaseGuard = process.env.E2E_STAGE3_DATABASE_GUARD?.trim();
  const runId = process.env.E2E_STAGE3_RUN_ID?.trim();
  const baseUsername = process.env.E2E_TEST_USERNAME?.trim();
  const password = process.env.E2E_TEST_PASSWORD?.trim();
  const authSecret = process.env.WUJIE_AUTH_SECRET?.trim();
  if (!databaseUrl || !databaseGuard || !runId || !baseUsername || !password || !authSecret) {
    throw new Error('E2E_STAGE3_DATABASE_URL, E2E_STAGE3_DATABASE_GUARD, E2E_STAGE3_RUN_ID, E2E_TEST_USERNAME, E2E_TEST_PASSWORD and WUJIE_AUTH_SECRET are required');
  }
  const plan = buildStage3FixturePlan(runId);
  const defaults = defaultStage3FixturePaths(plan.runId);
  const dataRoot = resolve(process.env.WUJIE_DATA_DIR || defaults.dataRoot);
  const output = resolve(process.env.E2E_STAGE3_ENV_OUTPUT || defaults.output);
  assertStage3OutputOutsideRepository(output);
  const options = {
    databaseUrl,
    databaseGuard,
    userId: `stage3-user-${plan.runId}`,
    username: buildFixtureUsername(baseUsername, plan.runId),
    password,
    authSecret,
  };
  await seedDatabase(plan, options);
  await writeMedia(plan, dataRoot);
  const environment = {
    E2E_BASE_URL: process.env.E2E_BASE_URL || 'http://127.0.0.1:5000',
    E2E_TEST_USERNAME: options.username,
    E2E_TEST_PASSWORD: password,
    E2E_STAGE3_RUN_ID: plan.runId,
    E2E_STAGE3_PROJECT_IDS: JSON.stringify(plan.projectMatrix),
    WUJIE_DATA_DIR: dataRoot,
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, stringifyEnvironment(environment), { encoding: 'ascii', mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    runId: plan.runId,
    userId: options.userId,
    projectCount: plan.projects.length,
    nodeCounts: plan.nodeCounts,
    output,
  }, null, 2)}\n`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) main().catch(error => { console.error(error); process.exitCode = 1; });
