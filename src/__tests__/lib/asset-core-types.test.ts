import { describe, expect, it } from 'vitest';

import {
  assertWorkspaceEntityType,
  isTerminalMediaAvailability,
} from '@/lib/asset-core/types';
import { resolveAssetGraphMode } from '@/lib/asset-core/mode';

describe('asset core domain invariants', () => {
  it('defaults the graph mode to legacy and accepts only staged modes', () => {
    expect(resolveAssetGraphMode(undefined)).toBe('legacy');
    expect(resolveAssetGraphMode('shadow')).toBe('shadow');
    expect(resolveAssetGraphMode('asset-v3')).toBe('asset-v3');
    expect(resolveAssetGraphMode('unexpected')).toBe('legacy');
  });

  it('keeps recoverable media availability states non-terminal', () => {
    expect(isTerminalMediaAvailability('missing')).toBe(false);
    expect(isTerminalMediaAvailability('ready')).toBe(true);
    expect(isTerminalMediaAvailability('unrecoverable')).toBe(true);
  });

  it('accepts only supported workspace entity types', () => {
    expect(assertWorkspaceEntityType('canvas-image')).toBe('canvas-image');
    expect(assertWorkspaceEntityType('chat-result')).toBe('chat-result');
    expect(() => assertWorkspaceEntityType('canvas-node')).toThrow(
      'Unsupported workspace entity type',
    );
  });
});
