const { spawnSync } = require('node:child_process');
const path = require('node:path');

if (process.platform === 'win32') {
  console.log('[PREPARE-TOOLS] Skipping optional Linux SVG tools on Windows.');
  process.exit(0);
}

const scriptPath = path.join(__dirname, 'prepare-tools.sh');
const result = spawnSync('bash', [scriptPath], { stdio: 'inherit' });

if (result.error || result.status !== 0) {
  console.warn('[PREPARE-TOOLS] Optional SVG tool setup was skipped.');
}
