import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';
import { Client } from 'pg';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';

// Test isolation: DOCTOR_SKIP_ENV_FILE=1 skips loading .env/.env.local so
// production-credential checks run against a clean environment.
if (process.env.DOCTOR_SKIP_ENV_FILE !== '1') {
  dotenv.config({ path: '.env.local', quiet: true });
  dotenv.config({ path: '.env', quiet: true });
}

const production = process.argv.includes('--production') || process.env.COZE_PROJECT_ENV === 'PROD' || process.env.NODE_ENV === 'production';
const startup = process.argv.includes('--startup');
const remoteUrl = process.argv.find((arg) => arg.startsWith('--url='))?.slice('--url='.length)?.replace(/\/$/, '');
const results = [];

function add(status, area, detail) {
  results.push({ status, area, detail });
}

function configured(name, minLength = 1) {
  const value = process.env[name]?.trim() || '';
  return value.length >= minLength && !/replace-with|your[_-]?|change[_-]?me|example/i.test(value);
}

function secretCheck(name, strict = production) {
  if (configured(name, 32)) add('PASS', name, 'configured');
  else add(strict ? 'FAIL' : 'WARN', name, strict ? 'missing or placeholder value' : 'not configured for this runtime');
}

function secretCheckAny(area, names, strict = production) {
  if (names.some((name) => configured(name, 32))) add('PASS', area, 'configured');
  else add(strict ? 'FAIL' : 'WARN', area, strict ? `missing or placeholder value (${names.join(' or ')})` : 'not configured for this runtime');
}

function normalizePostgresConnectionString(connectionString) {
  try {
    const parsed = new URL(connectionString);
    if (
      parsed.searchParams.get('sslmode')?.toLowerCase() === 'require'
      && !parsed.searchParams.has('uselibpqcompat')
    ) {
      parsed.searchParams.set('uselibpqcompat', 'true');
      return parsed.toString();
    }
  } catch {
    return connectionString;
  }
  return connectionString;
}

async function checkDataDir() {
  const dataDir = path.resolve(process.env.WUJIE_DATA_DIR || './data');
  try {
    await fs.access(dataDir, fs.constants.R_OK | fs.constants.W_OK);
    add('PASS', 'data-directory', dataDir);
  } catch {
    add(production ? 'FAIL' : 'WARN', 'data-directory', `not readable and writable: ${dataDir}`);
  }
}

async function checkDatabase() {
  const connectionString = process.env.PGDATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    add(production ? 'FAIL' : 'WARN', 'database', 'PGDATABASE_URL or DATABASE_URL is not configured');
    return;
  }
  const normalizedConnectionString = normalizePostgresConnectionString(connectionString);
  const client = new Client({ connectionString: normalizedConnectionString, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    await client.query('SELECT 1 AS healthcheck');
    add('PASS', 'database', 'connection and query succeeded');
  } catch (error) {
    add('FAIL', 'database', `connection failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function checkObjectStorage() {
  const endpoint = process.env.COZE_BUCKET_ENDPOINT_URL;
  const bucket = process.env.COZE_BUCKET_NAME;
  if (!endpoint || !bucket) {
    add('WARN', 'object-storage', 'COZE_BUCKET_ENDPOINT_URL / COZE_BUCKET_NAME not configured; local storage fallback must be verified');
    return;
  }
  const accessKeyId = process.env.COZE_BUCKET_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.COZE_BUCKET_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    add(
      startup ? 'WARN' : 'FAIL',
      'object-storage',
      startup
        ? 'bucket endpoint configured without explicit credentials; managed identity must be verified after startup'
        : 'bucket endpoint configured without credentials',
    );
    return;
  }
  const client = new S3Client({
    endpoint,
    region: process.env.COZE_BUCKET_REGION || 'cn-beijing',
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    add('PASS', 'object-storage', 'bucket is reachable');
  } catch (error) {
    add('FAIL', 'object-storage', `bucket probe failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function checkRemote() {
  if (!remoteUrl) {
    add('WARN', 'deployment-url', 'not supplied; use pnpm doctor -- --url=https://deployment.example');
    return;
  }
  try {
    const response = await fetch(`${remoteUrl}/api/auth/me`, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    if ([200, 401].includes(response.status)) add('PASS', 'deployment-url', `/api/auth/me responded ${response.status}`);
    else add('FAIL', 'deployment-url', `/api/auth/me responded ${response.status}`);
  } catch (error) {
    add('FAIL', 'deployment-url', `unreachable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ===== 新增: Node.js 版本检查 =====
function checkNodeVersion() {
  const major = parseInt(process.version.slice(1).split('.')[0], 10);
  add(major >= 18 ? 'PASS' : 'FAIL', 'node-version', `${process.version} (require >= 18)`);
}

// ===== 新增: 构建产物检查 =====
async function checkBuildArtifacts() {
  const nextDir = path.resolve('.next');
  if (existsSync(nextDir)) {
    add('PASS', 'build-artifacts', '.next directory exists');
    const buildManifest = path.join(nextDir, 'build-manifest.json');
    add(existsSync(buildManifest) ? 'PASS' : 'WARN', 'build-manifest', existsSync(buildManifest) ? 'exists' : 'missing (rebuild recommended)');
  } else {
    add('WARN', 'build-artifacts', '.next not found (run pnpm build for production)');
  }
}

// ===== 新增: 目录结构检查 =====
async function checkDirectoryStructure() {
  const dirs = ['src/app', 'src/components', 'src/lib', 'public'];
  for (const dir of dirs) {
    const exists = existsSync(path.resolve(dir));
    add(exists ? 'PASS' : 'FAIL', `dir:${dir}`, exists ? 'exists' : 'missing');
  }
  // public 可写
  const publicDir = path.resolve('public');
  if (existsSync(publicDir)) {
    try {
      await fs.access(publicDir, fs.constants.W_OK);
      add('PASS', 'public-writable', 'writable');
    } catch {
      add('FAIL', 'public-writable', 'not writable');
    }
  }
}

// ===== 新增: 依赖完整性检查 =====
async function checkDependencies() {
  const nm = path.resolve('node_modules');
  add(existsSync(nm) ? 'PASS' : 'FAIL', 'node_modules', existsSync(nm) ? 'installed' : 'missing (run pnpm install)');
  const critical = ['next', 'react', 'react-dom', 'pg', 'jose', 'sharp'];
  for (const dep of critical) {
    const exists = existsSync(path.join(nm, dep));
    add(exists ? 'PASS' : 'FAIL', `dep:${dep}`, exists ? 'installed' : 'missing');
  }
}

// ===== 新增: 配置文件检查 =====
async function checkConfigFiles() {
  for (const cfg of ['.coze', 'package.json', 'tsconfig.json']) {
    add(existsSync(path.resolve(cfg)) ? 'PASS' : 'FAIL', `config:${cfg}`, existsSync(path.resolve(cfg)) ? 'exists' : 'missing');
  }
}

// ===== 新增: 端口与 API 可达性 =====
async function checkPortAndAPI() {
  const port = process.env.DEPLOY_RUN_PORT || '5000';
  add('PASS', 'port-config', `port=${port}`);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/session`, { signal: AbortSignal.timeout(5_000) });
    add('PASS', 'api:session', `HTTP ${res.status}`);
  } catch {
    add('WARN', 'api:session', 'unreachable (service may not be running)');
  }
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/models?type=image`, { signal: AbortSignal.timeout(5_000) });
    add('PASS', 'api:models', `HTTP ${res.status}`);
  } catch {
    add('WARN', 'api:models', 'unreachable (service may not be running)');
  }
}

// ===== 新增: 关键数据表检查 =====
async function checkDatabaseTables() {
  const connectionString = process.env.PGDATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) return;
  const client = new Client({ connectionString: normalizePostgresConnectionString(connectionString), connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    const tables = ['wujie_users', 'wujie_api_providers', 'wujie_user_data', 'wujie_system_settings', 'wujie_audit_log', 'cloud_tasks'];
    for (const table of tables) {
      try {
        await client.query(`SELECT 1 FROM ${table} LIMIT 1`);
        add('PASS', `db-table:${table}`, 'exists');
      } catch {
        add('WARN', `db-table:${table}`, 'missing (auto-created on first use)');
      }
    }
  } catch {
    // already reported by checkDatabase
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main() {
  checkNodeVersion();
  add('PASS', 'runtime', `Node ${process.version}; mode=${production ? 'production' : 'development'}`);
  const strictCredentials = production && !startup;
  secretCheckAny('authentication-secret', ['WUJIE_AUTH_SECRET', 'NEXTAUTH_SECRET'], strictCredentials);
  secretCheck('INTERNAL_API_SECRET', strictCredentials);
  secretCheck('PAYMENT_TOKEN_SECRET', strictCredentials);
  if (configured('WUJIE_ADMIN_PASSWORD', 12)) add('PASS', 'WUJIE_ADMIN_PASSWORD', 'configured');
  else add(strictCredentials ? 'FAIL' : 'WARN', 'WUJIE_ADMIN_PASSWORD', 'missing, weak, or placeholder value');
  if (process.env.MANDATORY_API_AUTH === 'true') add('PASS', 'MANDATORY_API_AUTH', 'enabled');
  else add(strictCredentials ? 'FAIL' : 'WARN', 'MANDATORY_API_AUTH', 'must be true for a release environment');
  for (const provider of ['APIMART_API_KEY', 'GEMINI_API_KEY']) {
    add(configured(provider) ? 'PASS' : 'WARN', provider, configured(provider) ? 'configured' : 'not configured in local environment');
  }
  await checkDataDir();
  await checkDatabase();
  await checkDatabaseTables();
  await checkObjectStorage();
  await checkBuildArtifacts();
  await checkDirectoryStructure();
  await checkDependencies();
  await checkConfigFiles();
  await checkPortAndAPI();
  await checkRemote();

  for (const result of results) console.log(`[${result.status}] ${result.area}: ${result.detail}`);
  const failed = results.filter((result) => result.status === 'FAIL');
  console.log(`\nSummary: ${results.filter((result) => result.status === 'PASS').length} passed, ${results.filter((result) => result.status === 'WARN').length} warnings, ${failed.length} failed`);
  if (failed.length > 0) process.exitCode = 1;
}

await main();
