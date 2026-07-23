// Patch pg-connection-string to suppress SSL deprecation warning
const fs = require('fs');
const path = require('path');

const targets = [
  path.join(__dirname, '..', 'node_modules', 'pg-connection-string', 'index.js'),
  path.join(__dirname, '..', 'node_modules', 'pg', 'lib', 'connection-parameters.js'),
];

for (const file of targets) {
  try {
    let content = fs.readFileSync(file, 'utf-8');
    // Skip if already patched
    if (content.includes('// patched by patch-pg-ssl')) {
      console.log(`Already patched: ${file}`);
      continue;
    }
    // Replace deprecatedSslModeWarning function with no-op
    const patched = content.replace(
      /function deprecatedSslModeWarning[\s\S]*?deprecatedSslModeWarning[\s\S]*?}/,
      '// patched by patch-pg-ssl\nfunction deprecatedSslModeWarning() {}'
    );
    fs.writeFileSync(file, patched, 'utf-8');
    console.log(`Patched: ${file}`);
  } catch (e) {
    console.log(`Skip: ${file} (${e.message})`);
  }
}