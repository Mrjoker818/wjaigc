import { readFile } from 'node:fs/promises';

// Same CPU-generated synthetic clip as the original mobile acceptance fixtures.
// Package it with the tests; never depend on machine-local diagnostic folders.
export async function readOwnedOneSecondVideo(): Promise<Buffer> {
  return readFile(new URL('../fixtures/owned-one-second.mp4', import.meta.url));
}
