import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

interface Step { name?: string; run?: string }
interface Workflow { jobs: Record<string, { steps: Step[] }> }

function runSetup(path: string, job: string, testStep: string, failure: string = ''): SpawnSyncReturns<string> {
  const workflow = YAML.parse(readFileSync(path, 'utf8')) as Workflow;
  const steps = workflow.jobs[job].steps;
  const testIndex = steps.findIndex(step => step.name === testStep);
  expect(testIndex).toBeGreaterThan(0);
  const setup = steps.slice(0, testIndex).find(step => step.name === 'Install CPU media tools');
  // Only apt and executable availability are controlled. The workflow's Bash
  // command and fail-fast behavior are real; this is not an Ubuntu install.
  const boundary = `
    sudo() { printf 'sudo:%s\\n' "$*"; [ "$MEDIA_FAILURE" != apt ]; }
    ffmpeg() { printf 'ffmpeg:%s\\n' "$*"; [ "$MEDIA_FAILURE" != ffmpeg ]; }
    ffprobe() { printf 'ffprobe:%s\\n' "$*"; [ "$MEDIA_FAILURE" != ffprobe ]; }
  `;
  return spawnSync(process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash',
    ['--noprofile', '--norc', '-e', '-c', boundary + (setup?.run ?? ':')], {
      encoding: 'utf8', timeout: 10_000, windowsHide: true,
      env: { NODE_ENV: 'test', MEDIA_FAILURE: failure,
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) },
    });
}

describe.each([
  ['.github/workflows/quality.yml', 'static-and-tests', 'Unit and integration tests'],
  ['.github/workflows/stage-0-quality.yml', 'stage-1-local-gates', 'Full automated test suite'],
])('CI CPU media dependencies: %s', (path, job, testStep) => {
  // Removing installation, installing the wrong package, or moving setup after
  // tests must break the observable dependency sequence.
  it('installs and verifies both tools before the real media tests', () => {
    const result = runSetup(path, job, testStep);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim().split(/\r?\n/)).toEqual([
      'sudo:apt-get update',
      'sudo:apt-get install -y --no-install-recommends ffmpeg',
      'ffmpeg:-version', 'ffprobe:-version',
    ]);
  });

  it.each(['apt', 'ffmpeg', 'ffprobe'])('fails closed when %s is unavailable', (failure) => {
    const result = runSetup(path, job, testStep, failure);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    if (failure === 'apt') expect(result.stdout).not.toContain('ffmpeg:');
    if (failure === 'ffmpeg') expect(result.stdout).not.toContain('ffprobe:');
  });
});
