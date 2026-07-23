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

    // Replace the deprecatedSslModeWarning function definition with a no-op
    // Matches: function deprecatedSslModeWarning(...) { ... }
    // where ... can be any content including nested braces
    let depth = 0;
    let start = content.indexOf('function deprecatedSslModeWarning');
    if (start === -1) {
      console.log(`No deprecatedSslModeWarning found in: ${file}`);
      continue;
    }
    // Find the opening brace of the function body
    let braceStart = content.indexOf('{', start);
    if (braceStart === -1) {
      console.log(`No function body found in: ${file}`);
      continue;
    }
    // Find matching closing brace
    depth = 1;
    let end = braceStart + 1;
    while (depth > 0 && end < content.length) {
      if (content[end] === '{') depth++;
      else if (content[end] === '}') depth--;
      end++;
    }
    if (depth !== 0) {
      console.log(`Unmatched braces in: ${file}`);
      continue;
    }

    const patchedContent =
      content.substring(0, start) +
      '// patched by patch-pg-ssl\nfunction deprecatedSslModeWarning() {}\n' +
      content.substring(end);

    fs.writeFileSync(file, patchedContent, 'utf-8');
    console.log(`Patched: ${file}`);
  } catch (e) {
    console.log(`Skip: ${file} (${e.message})`);
  }
}