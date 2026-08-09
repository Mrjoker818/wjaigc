import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  validateEvidenceManifest,
  writeEvidenceManifest,
  type EvidenceManifestInput,
} from '../helpers/evidence-manifest';

const completeInput: EvidenceManifestInput = {
  commit: '69ba94ef6bde041293ad9609ec76285d3e287a7f',
  deploymentUrl: 'https://www.wjaigc.top/',
  browser: 'chromium',
  viewport: { width: 1440, height: 900 },
  capturedAt: '2026-08-08T13:45:00+08:00',
  featureId: 'workspace.canvas.core',
  artifactPaths: {
    screenshot: 'screenshots/canvas.png',
    console: 'console/canvas.json',
    network: 'network/canvas.har',
    task: 'tasks/canvas.json',
  },
  requestIds: ['req_stage0'],
  status: 'completed',
};

describe('evidence manifest contract', () => {
  it.each([
    ['commit'],
    ['deploymentUrl'],
    ['featureId'],
    ['artifactPaths'],
  ] as const)('rejects a manifest missing %s', (field) => {
    const input = { ...completeInput } as Record<string, unknown>;
    delete input[field];

    expect(() => validateEvidenceManifest(input)).toThrow(field);
  });

  it('requires screenshot, console, network, and task evidence for completed records', () => {
    const input = {
      ...completeInput,
      artifactPaths: {
        screenshot: 'screenshots/canvas.png',
        console: 'console/canvas.json',
        network: 'network/canvas.har',
      },
    };

    expect(() => validateEvidenceManifest(input)).toThrow(/task/);
  });

  it('writes a deterministic evidence directory and manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wujie-evidence-'));
    const result = await writeEvidenceManifest(completeInput, { root });
    const persisted = JSON.parse(await readFile(result.manifestPath, 'utf8'));

    expect(result.directory).toContain(
      join(
        '69ba94ef6bde041293ad9609ec76285d3e287a7f',
        'workspace.canvas.core',
        'chromium',
      ),
    );
    expect(persisted).toEqual(completeInput);
  });
});
