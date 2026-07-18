import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';
import { Client } from 'pg';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';

dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ path: '.env', quiet: true });

const production = process.argv.includes('--production') || process.env.COZE_PROJECT_ENV === 'PROD' || process.env.NODE_ENV === 'production';
const remoteUrl = process.argv.find((arg) => arg.startsWith('--url='))?.slice('--url='.length)?.replace(/\/$/, '');
const results = [];

function add(status, area, detail) {
  results.push({ status, area, detail });
}

function configured(name, minLength = 1) {
  const value = process.env[name]?.trim() || '';
  return value.length >= minLength && !/replace-with|your[_-]?|change[_-]?me|example/i.test(value);
}

function secretCheck(name) {
  if (configured(name, 32)) add('PASS', name, 'configured');
  else add(production ? 'FAIL' : 'WARN', name, production ? 'missing or placeholder value' : 'not configured for this local environment');
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
  const client = new Client({ connectionString, connectionTimeoutMillis: 5_000 });
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
    add('FAIL', 'object-storage', 'bucket endpoint configured without credentials');
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

async function main() {
  add('PASS', 'runtime', `Node ${process.version}; mode=${production ? 'production' : 'development'}`);
  secretCheck('WUJIE_AUTH_SECRET');
  secretCheck('INTERNAL_API_SECRET');
  secretCheck('PAYMENT_TOKEN_SECRET');
  if (configured('WUJIE_ADMIN_PASSWORD', 12)) add('PASS', 'WUJIE_ADMIN_PASSWORD', 'configured');
  else add(production ? 'FAIL' : 'WARN', 'WUJIE_ADMIN_PASSWORD', 'missing, weak, or placeholder value');
  if (process.env.MANDATORY_API_AUTH === 'true') add('PASS', 'MANDATORY_API_AUTH', 'enabled');
  else add(production ? 'FAIL' : 'WARN', 'MANDATORY_API_AUTH', 'must be true for a release environment');
  for (const provider of ['APIMART_API_KEY', 'GEMINI_API_KEY']) {
    add(configured(provider) ? 'PASS' : 'WARN', provider, configured(provider) ? 'configured' : 'not configured in local environment');
  }
  await checkDataDir();
  await checkDatabase();
  await checkObjectStorage();
  await checkRemote();

  for (const result of results) console.log(`[${result.status}] ${result.area}: ${result.detail}`);
  const failed = results.filter((result) => result.status === 'FAIL');
  console.log(`\nSummary: ${results.filter((result) => result.status === 'PASS').length} passed, ${results.filter((result) => result.status === 'WARN').length} warnings, ${failed.length} failed`);
  if (failed.length > 0) process.exitCode = 1;
}

await main();
