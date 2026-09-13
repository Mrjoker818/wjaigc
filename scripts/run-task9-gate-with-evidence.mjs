import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function parseArguments(argv) {
  const separator = argv.indexOf('--');
  if (separator < 0) fail('Usage: --name NAME --output DIR -- COMMAND [ARGS...]');
  const options = argv.slice(0, separator);
  const command = argv.slice(separator + 1);
  const nameIndex = options.indexOf('--name');
  const outputIndex = options.indexOf('--output');
  const name = nameIndex >= 0 ? options[nameIndex + 1] : undefined;
  const output = outputIndex >= 0 ? options[outputIndex + 1] : undefined;
  if (!name || !/^[A-Za-z0-9._-]+$/.test(name) || !output || command.length === 0) {
    fail('A safe --name, --output, and command are required');
  }
  return { name, output, command };
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function artifact(path, data) {
  return { path, bytes: data.byteLength, sha256: sha256(data) };
}

const { name, output, command } = parseArguments(process.argv.slice(2));
const directory = resolve(output, name);
mkdirSync(directory, { recursive: true });
const startedAt = new Date().toISOString();
const started = Date.now();
const commitProbe = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  windowsHide: true,
});
const commit = commitProbe.status === 0 ? commitProbe.stdout.trim() : 'unknown';
const executable = process.platform === 'win32' && command[0] === 'pnpm' ? 'pnpm.cmd' : command[0];
const child = spawn(executable, command.slice(1), {
  cwd: process.cwd(),
  env: process.env,
  shell: false,
  windowsHide: true,
});
const stdoutChunks = [];
const stderrChunks = [];
child.stdout.on('data', chunk => {
  const buffer = Buffer.from(chunk);
  stdoutChunks.push(buffer);
  process.stdout.write(buffer);
});
child.stderr.on('data', chunk => {
  const buffer = Buffer.from(chunk);
  stderrChunks.push(buffer);
  process.stderr.write(buffer);
});

child.on('error', error => {
  stderrChunks.push(Buffer.from(`${error.message}\n`));
});

child.on('close', (code, signal) => {
  const stdout = Buffer.concat(stdoutChunks);
  const stderr = Buffer.concat(stderrChunks);
  const stdoutPath = resolve(directory, 'stdout.log');
  const stderrPath = resolve(directory, 'stderr.log');
  writeFileSync(stdoutPath, stdout);
  writeFileSync(stderrPath, stderr);
  const finishedAt = new Date().toISOString();
  const exitCode = typeof code === 'number' ? code : 1;
  const manifest = {
    schemaVersion: 1,
    name,
    command,
    cwd: process.cwd(),
    commit,
    startedAt,
    finishedAt,
    durationMs: Date.now() - started,
    exitCode,
    signal: signal || null,
    artifacts: {
      stdout: artifact(stdoutPath, stdout),
      stderr: artifact(stderrPath, stderr),
    },
  };
  writeFileSync(resolve(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.exitCode = exitCode;
});
