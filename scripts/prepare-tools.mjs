import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform === 'win32') {
  console.log('[PREPARE-TOOLS] Skipping optional Linux SVG tools on Windows.');
  process.exit(0);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(scriptDir, 'prepare-tools.sh');
const result = spawnSync('bash', [scriptPath], { stdio: 'inherit' });

if (result.error || result.status !== 0) {
  console.warn('[PREPARE-TOOLS] Optional SVG tool setup was skipped.');
}
