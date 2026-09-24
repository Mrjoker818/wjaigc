import fs from 'node:fs';

/** Checks a runtime-selected path without asking the bundler to enumerate it. */
export function pathExistsSync(target: string): boolean {
  try {
    fs.accessSync(target, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
