import { describe, expect, it } from 'vitest';

import {
  isRecoveredStage3CanvasSkillCatalogAbort,
  isRecoveredStage3OwnerStatusReloadAbort,
} from '../../../tests/helpers/stage-3-e2e';
import {
  isBenignStage3RequestAbort,
  isRecoveredStage3RequestAbort,
  isRecoveredStage3SyncConflict,
  stage3RequestFingerprint,
} from '../../../tests/helpers/stage-3-evidence-filter';

describe('Stage 3 browser evidence request filtering', () => {
  it('accepts only known lifecycle request aborts as benign', () => {
    expect(isBenignStage3RequestAbort({
      method: 'POST',
      url: 'http://127.0.0.1:5000/api/user-data/record',
      text: 'net::ERR_ABORTED',
    })).toBe(true);
    expect(isBenignStage3RequestAbort({
      method: 'POST',
      url: 'http://127.0.0.1:5000/api/user-data/sync',
      text: 'net::ERR_ABORTED',
    })).toBe(false);
    expect(isBenignStage3RequestAbort({
      method: 'POST',
      status: 500,
      url: 'http://127.0.0.1:5000/api/user-data/record',
      text: 'server error',
    })).toBe(false);
  });

  describe('Canvas skill catalog recovery', () => {
    const aborted = {
      method: 'GET',
      url: 'http://127.0.0.1:5000/api/skills?surface=canvas',
      text: 'NS_BINDING_ABORTED',
      canvasCatalogNavigation: 1,
    };
    const completed = {
      method: 'GET',
      url: aborted.url,
      status: 200,
      canvasCatalogNavigation: 1,
    };

    it('accepts an abort followed by a completed catalog read on the same page navigation', () => {
      expect(isRecoveredStage3CanvasSkillCatalogAbort(aborted, [aborted, completed])).toBe(true);
      expect(isBenignStage3RequestAbort(aborted)).toBe(false);
    });

    it('requires a later catalog completion', () => {
      expect(isRecoveredStage3CanvasSkillCatalogAbort(aborted, [aborted])).toBe(false);
      expect(isRecoveredStage3CanvasSkillCatalogAbort(aborted, [completed, aborted])).toBe(false);
    });

    it.each([
      { status: 204 },
      { status: 503 },
      { status: undefined, text: 'NS_BINDING_ABORTED' },
      { method: 'POST' },
      { url: 'http://127.0.0.1:5000/api/skills?surface=workflow' },
      { url: 'http://localhost:5000/api/skills?surface=canvas' },
      { canvasCatalogNavigation: 2 },
      { canvasCatalogNavigation: undefined },
    ])('rejects a replacement with %j', change => {
      expect(isRecoveredStage3CanvasSkillCatalogAbort(aborted, [aborted, { ...completed, ...change }])).toBe(false);
    });

    it.each([
      { text: 'NS_ERROR_NET_TIMEOUT' },
      { text: 'NS_BINDING_ABORTED with an unrelated error' },
      { status: 503 },
      { method: 'POST' },
      { url: 'http://127.0.0.1:5000/api/skills?surface=workflow' },
      { canvasCatalogNavigation: undefined },
    ])('still fails the original request with %j', change => {
      const failure = { ...aborted, ...change };
      const matchingCompletion = { ...completed, method: failure.method, url: failure.url };
      expect(isRecoveredStage3CanvasSkillCatalogAbort(failure, [failure, matchingCompletion])).toBe(false);
    });
  });

  describe('owner status recheck during a Stage 3 project reload', () => {
    const beforeReload = {
      method: 'GET',
      url: 'http://127.0.0.1:5000/api/collaboration/document-enable?projectId=stage3-project',
      status: 200,
      ownerStatusNavigation: 1,
      legacyOwnerStatus: true as const,
    };
    const interrupted = {
      method: 'GET',
      url: beforeReload.url,
      text: 'net::ERR_ABORTED',
      ownerStatusNavigation: 1,
      ownerStatusInterruptedByReload: true as const,
    };
    const afterReload = { ...beforeReload, ownerStatusNavigation: 2 };

    it('accepts a reload cancellation between confirmed legacy reads in consecutive documents', () => {
      expect(isRecoveredStage3OwnerStatusReloadAbort(interrupted, [beforeReload, interrupted, afterReload])).toBe(true);
      expect(isBenignStage3RequestAbort(interrupted)).toBe(false);
    });

    it('requires completed legacy reads both before and after the cancellation', () => {
      expect(isRecoveredStage3OwnerStatusReloadAbort(interrupted, [interrupted, afterReload])).toBe(false);
      expect(isRecoveredStage3OwnerStatusReloadAbort(interrupted, [beforeReload, interrupted])).toBe(false);
      expect(isRecoveredStage3OwnerStatusReloadAbort(interrupted, [beforeReload, afterReload, interrupted])).toBe(false);
    });

    it.each([
      { text: 'net::ERR_CONNECTION_CLOSED' },
      { status: 503 },
      { method: 'POST' },
      { ownerStatusInterruptedByReload: undefined },
    ])('keeps a failed request with %j', change => {
      const failure = { ...interrupted, ...change };
      expect(isRecoveredStage3OwnerStatusReloadAbort(failure, [beforeReload, failure, afterReload])).toBe(false);
    });

    it.each([
      { status: 503 },
      { legacyOwnerStatus: undefined },
      { ownerStatusNavigation: 1 },
      { ownerStatusNavigation: 3 },
      { url: beforeReload.url.replace('stage3-project', 'different-project') },
      { url: beforeReload.url.replace('127.0.0.1', 'localhost') },
    ])('does not recover from a replacement with %j', change => {
      expect(isRecoveredStage3OwnerStatusReloadAbort(interrupted, [beforeReload, interrupted, { ...afterReload, ...change }])).toBe(false);
    });
  });

  it('accepts a project revision conflict only when a later project sync succeeds', () => {
    const conflict = {
      method: 'POST',
      status: 409,
      url: 'http://127.0.0.1:5000/api/user-data/sync',
      occurredAt: 10,
    };
    expect(isRecoveredStage3SyncConflict(conflict, [conflict])).toBe(false);
    expect(isRecoveredStage3SyncConflict(conflict, [conflict, {
      method: 'POST',
      status: 200,
      url: conflict.url,
      occurredAt: 20,
    }])).toBe(true);
    expect(isRecoveredStage3SyncConflict(conflict, [conflict, {
      method: 'POST',
      status: 200,
      url: conflict.url,
      occurredAt: 5,
    }])).toBe(false);
  });

  it('accepts an interrupted duplicate only when the same durable snapshot has succeeded', () => {
    const first = JSON.stringify({
      key: 'projects',
      projectRevision: 2,
      value: [{ id: 'project-a', updatedAt: 100, canvasImages: [{ id: 'node-a', x: 40 }] }],
    });
    const recovered = JSON.stringify({
      key: 'projects',
      projectRevision: 3,
      value: [{ id: 'project-a', updatedAt: 200, canvasImages: [{ id: 'node-a', x: 40 }] }],
    });
    const changed = JSON.stringify({
      key: 'projects',
      projectRevision: 3,
      value: [{ id: 'project-a', updatedAt: 200, canvasImages: [{ id: 'node-a', x: 41 }] }],
    });
    const failedEntry = {
      method: 'POST',
      url: 'http://127.0.0.1:5000/api/user-data/sync',
      text: 'Load request cancelled',
      requestDigest: stage3RequestFingerprint(first),
      occurredAt: 10,
    };

    expect(isRecoveredStage3RequestAbort(failedEntry, [{
      method: 'POST',
      status: 200,
      url: failedEntry.url,
      requestDigest: stage3RequestFingerprint(recovered),
      occurredAt: 20,
    }])).toBe(true);
    expect(isRecoveredStage3RequestAbort(failedEntry, [{
      method: 'POST',
      status: 200,
      url: failedEntry.url,
      requestDigest: stage3RequestFingerprint(changed),
      occurredAt: 20,
    }])).toBe(false);
    expect(isRecoveredStage3RequestAbort(failedEntry, [{
      method: 'POST',
      status: 200,
      url: failedEntry.url,
      requestDigest: stage3RequestFingerprint(recovered),
      occurredAt: 5,
    }])).toBe(true);
  });
});
