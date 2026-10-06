import { register } from 'node:module';

// Test-only dependency substitution; the actual production CLI remains the entry.
register('./presence-cli-next-loader.mjs', import.meta.url);
