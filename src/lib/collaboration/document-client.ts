'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type * as YTypes from 'yjs';
// 服务端与原生协作入口统一加载 CJS；浏览器由构建配置统一解析。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Y: typeof YTypes = require('yjs');
import { CanvasDocumentMediaSync, CanvasDocumentMediaSyncError, readDocumentMediaResponse } from './document-media-sync';

import {
  applyCanvasImagePatch, createCanvasDocument, readCanvasDocument,
  tombstoneCanvasAnnotation, tombstoneCanvasGroup, validateCanvasDocumentProjection,
  type CanvasDocumentProjection, type CanvasImagePatch, type CanvasPlacement,
} from './canvas-document';
import {
  projectCanvasDocumentMetadata, projectDocumentPlacementsOntoImages,
  restoreCanvasDocumentAnnotationIdentity,
  toCanvasDocumentAnnotationRecords, toCanvasDocumentGroupRecords,
} from './canvas-document-image-bridge';
import type { CanvasImage, ImageGroupData } from '@/lib/user-types';
import type { CanvasAnnotationV2 } from '@/features/annotations/annotation-types';
import { parseDocumentPlacementRemovalSnapshot, type DocumentPlacementRemovalSnapshot } from './canvas-asset-command';

export type CanvasDocumentStatus = 'connecting' | 'saved' | 'pending' | 'unavailable' | 'rejected' | 'recovery';

export interface PendingDocumentUpdateStore {
  load(): Array<{ id: string; frame: Uint8Array; rejected?: boolean; intent?: Record<string, unknown> }>;
  append(frame: Uint8Array, intent?: Record<string, unknown>): string;
  remove(id: string): void;
  markRejected?(id: string): void;
}

export interface CanvasDocumentMediaHistoryEntry {
  undo(): void | Promise<void>;
  redo(): void | Promise<void>;
}

export interface CanvasPlacementHistoryMetadataRestore {
  previousPlacementId: string;
  nextPlacementId: string;
  assetVersionId: string;
  /** Fresh-page recovery only: refuse any previously written target metadata
   * atomically against the live session before constructing a durable frame. */
  requirePristine?: true;
  /** Frozen from an authorized remove receipt by the durable history consumer.
   * This is restoration data, not authorization or server confirmation. */
  removal?: {
    projectId: string;
    snapshot: DocumentPlacementRemovalSnapshot;
    annotationIds: Record<string, string>;
  };
}

export interface CanvasDocumentSession {
  readonly appliedServerSequence: number;
  readonly images: Record<string, CanvasPlacement>;
  readonly projection: CanvasDocumentProjection;
  readonly status: CanvasDocumentStatus;
  waitForPendingUpdates(): Promise<number>;
  applyLocalChange(patch: CanvasImagePatch | CanvasImagePatch[]): void;
  applyLocalGroups(groups: Record<string, ImageGroupData>, baseline?: Record<string, ImageGroupData>): void;
  applyLocalAnnotations(annotations: Record<string, CanvasAnnotationV2>, baseline?: Record<string, CanvasAnnotationV2>): void;
  recordMediaHistory(entry: CanvasDocumentMediaHistoryEntry): void;
  restorePlacementHistoryMetadata(input: CanvasPlacementHistoryMetadataRestore): void;
  rebindPlacementHistory(input: { previousPlacementId: string; nextPlacementId: string; assetVersionId: string }): void;
  undoLocal(): void | Promise<void>;
  redoLocal(): void | Promise<void>;
  retryRecovered(): void;
  exportRecoveryCopy(): {
    projection: CanvasDocumentProjection;
    pendingFrames: Array<{ frameBase64: string; rejected: boolean; intent?: Record<string, unknown> }>;
  };
  replaceSocket(socket: WebSocket): void;
  disconnect(): void;
}

export interface CollaborativeCanvasState {
  appliedServerSequence: number;
  projectId: string | null;
  authority: 'unknown' | 'legacy' | 'document';
  status: CanvasDocumentStatus | 'checking' | 'disabled' | 'read-only';
  images: Record<string, CanvasPlacement>;
  canvasImages: CanvasImage[];
  groups: ImageGroupData[];
  annotations: CanvasAnnotationV2[];
}

export interface CollaborativeCanvas extends CollaborativeCanvasState {
  /** Live session readiness; rendered status can lag an HTTP media confirmation. */
  isWritable(): boolean;
  /** Read-only waiting readiness, never permission to submit a document write. */
  isSessionActive?(): boolean;
  waitForPendingUpdates(): Promise<number>;
  refreshMedia(input: { projectId: string; documentSequence: number; requireDirectorySequence?: boolean }): Promise<CanvasImage[]>;
  recoveryRetryReady: boolean;
  applyLocalChange(patch: CanvasImagePatch | CanvasImagePatch[]): void;
  applyLocalGroups(groups: ImageGroupData[], renderedBaseline?: ImageGroupData[]): void;
  applyLocalAnnotations(annotations: CanvasAnnotationV2[], renderedBaseline?: CanvasAnnotationV2[]): void;
  recordMediaHistory(entry: CanvasDocumentMediaHistoryEntry): void;
  restorePlacementHistoryMetadata(input: CanvasPlacementHistoryMetadataRestore): void;
  rebindPlacementHistory(input: { previousPlacementId: string; nextPlacementId: string; assetVersionId: string }): void;
  undoLocal(): void | Promise<void>;
  redoLocal(): void | Promise<void>;
  retryRecovered(): void;
  exportRecoveryCopy(): string;
  disconnect(): void;
}

const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MAX_PENDING_UPDATES = 256;
const MAX_PENDING_FRAME_BYTES = 1_048_576 + 1;
const MAX_AUTOMATIC_REPLAYS = 3;
const PENDING_STORAGE_PREFIX = 'wujie-canvas-document-pending-v1:';
const INITIAL_STATE: CollaborativeCanvasState = {
  appliedServerSequence: -1,
  projectId: null, authority: 'unknown', status: 'checking', images: {}, canvasImages: [],
  groups: [], annotations: [],
};

function frameToBase64(frame: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < frame.length; index += 8192) {
    binary += String.fromCharCode(...frame.subarray(index, index + 8192));
  }
  return btoa(binary);
}

function frameFromBase64(value: string): {
  frame: Uint8Array; rejected: boolean; intent?: Record<string, unknown>;
} {
  let encodedFrame = value;
  let intent: Record<string, unknown> | undefined;
  if (value.startsWith('v2:')) {
    const separator = value.indexOf(':', 3);
    if (separator < 0) throw new Error('本地协作文档恢复记录无效');
    encodedFrame = value.slice(3, separator);
    const encodedIntent = atob(value.slice(separator + 1));
    const intentBytes = Uint8Array.from(encodedIntent, character => character.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(intentBytes));
    intent = asRecord(parsed) ?? undefined;
    if (!intent) throw new Error('本地协作文档恢复意图无效');
  }
  const binary = atob(encodedFrame);
  if (binary.length < 2 || binary.length > MAX_PENDING_FRAME_BYTES) {
    throw new Error('本地协作文档待同步记录无效');
  }
  const frame = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) frame[index] = binary.charCodeAt(index);
  const rejected = frame[0] === 0x03;
  if (frame[0] !== 0x02 && !rejected) throw new Error('本地协作文档待同步记录类型无效');
  frame[0] = 0x02;
  return { frame, rejected, ...(intent ? { intent } : {}) };
}

function encodePendingFrame(frame: Uint8Array, intent?: Record<string, unknown>): string {
  if (!intent) return frameToBase64(frame);
  return `v2:${frameToBase64(frame)}:${frameToBase64(new TextEncoder().encode(JSON.stringify(intent)))}`;
}

function documentRecoveryIntent(
  before: CanvasDocumentProjection, after: CanvasDocumentProjection,
): Record<string, unknown> {
  const intent: Record<string, unknown> = {};
  for (const kind of [
    'placements', 'groupDefinitions', 'annotationRecords',
    'groupTombstones', 'annotationTombstones',
  ] as const) {
    const previous = before[kind] ?? {};
    const current = after[kind] ?? {};
    const changed = Object.fromEntries(Object.entries(current).filter(([id, value]) => (
      JSON.stringify(previous[id]) !== JSON.stringify(value)
    )));
    if (Object.keys(changed).length > 0) intent[kind] = changed;
  }
  return intent;
}

interface YjsRedoneLink {
  id: YTypes.ID;
  length: number;
  redone: YTypes.ID;
}

type PlacementHistoryField = 'transforms' | 'groups' | 'annotations';
interface PlacementHistoryChange {
  placementId: string;
  assetVersionId: string;
  before: CanvasPlacement;
  after: CanvasPlacement;
  fields: PlacementHistoryField[];
}
interface AnnotationHistoryChange {
  annotationId: string;
  before?: CanvasAnnotationV2;
  after: CanvasAnnotationV2;
  retired?: true;
}
function annotationHistoryValue(value: CanvasAnnotationV2 | undefined): string {
  return JSON.stringify(value, (_key: string, nested: unknown): unknown => {
    if (typeof nested !== 'object' || nested === null || Array.isArray(nested)) return nested;
    return Object.fromEntries(Object.entries(nested).sort(([left], [right]) => left.localeCompare(right)));
  }) ?? '';
}
function annotationHistoryChanges(before: CanvasDocumentProjection, after: CanvasDocumentProjection): AnnotationHistoryChange[] {
  return Object.entries(after.annotationRecords ?? {}).flatMap(([annotationId, record]) => {
    const prior = before.annotationRecords?.[annotationId];
    if (before.annotationTombstones?.[annotationId] || after.annotationTombstones?.[annotationId]
        || annotationHistoryValue(prior) === annotationHistoryValue(record)) return [];
    // Identity/source changes cannot be adopted as edits of a restored record.
    if (prior && (prior.projectId !== record.projectId || prior.sourceImageId !== record.sourceImageId
        || prior.sourceVersionId !== record.sourceVersionId)) return [];
    return [{ annotationId, before: prior, after: record }];
  });
}
const HISTORY_TRANSFORM_FIELDS = ['x', 'y', 'width', 'height', 'rotation', 'zIndex'] as const;

function placementHistoryValue(placement: CanvasPlacement, field: PlacementHistoryField): string {
  if (field === 'transforms') return JSON.stringify(HISTORY_TRANSFORM_FIELDS.map(key => placement[key]));
  if (field === 'groups') return JSON.stringify(placement.groupId ?? null);
  return JSON.stringify(placement.annotation ?? '');
}

function placementHistoryChanges(
  before: CanvasDocumentProjection, after: CanvasDocumentProjection,
): PlacementHistoryChange[] | undefined {
  const changes: PlacementHistoryChange[] = [];
  for (const [placementId, next] of Object.entries(after.placements)) {
    const prior = before.placements[placementId];
    if (JSON.stringify(prior) === JSON.stringify(next)) continue;
    // Media identity/version changes are not reversible placement patches.
    if (!prior || prior.deleted || next.deleted || prior.assetVersionId !== next.assetVersionId) return undefined;
    const fields = (['transforms', 'groups', 'annotations'] as const).filter(field => (
      placementHistoryValue(prior, field) !== placementHistoryValue(next, field)
    ));
    if (fields.length) changes.push({ placementId, assetVersionId: next.assetVersionId, before: prior, after: next, fields });
  }
  return changes;
}

function readYjsRedoneLinks(doc: YTypes.Doc): YjsRedoneLink[] {
  const links: YjsRedoneLink[] = [];
  for (const structs of doc.store.clients.values()) {
    for (const struct of structs) {
      if (struct instanceof Y.Item && struct.redone !== null) {
        links.push({ id: struct.id, length: struct.length, redone: struct.redone });
      }
    }
  }
  return links;
}

function restoreYjsRedoneLinks(doc: YTypes.Doc, links: YjsRedoneLink[]): void {
  // Yjs updates encode content, not the local Item.redone associations used by
  // UndoManager. Carry those associations through our write-before-apply preview.
  // Encoded structs can merge: split by clock range, not by array position.
  doc.transact(transaction => {
    for (const link of links) {
      const end = link.id.clock + link.length;
      for (let clock = link.id.clock; clock < end;) {
        const item = Y.getItemCleanStart(transaction, Y.createID(link.id.client, clock));
        if (item.id.clock + item.length > end) {
          Y.getItemCleanEnd(transaction, doc.store, Y.createID(link.id.client, end - 1));
        }
        if (item instanceof Y.Item) {
          item.redone = Y.createID(link.redone.client, link.redone.clock + clock - link.id.clock);
        }
        clock += item.length;
      }
    }
  }, 'history-redone-links');
}

export function createBrowserPendingUpdateStore(
  projectId: string, actorId: string,
): PendingDocumentUpdateStore {
  const prefix = `${PENDING_STORAGE_PREFIX}${encodeURIComponent(actorId)}:${encodeURIComponent(projectId)}:`;
  const rejectionPrefix = `wujie-canvas-document-rejected-v1:${encodeURIComponent(actorId)}:${encodeURIComponent(projectId)}:`;
  let ordinal = 0;
  const keys = (): string[] => {
    const result: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix)) result.push(key);
    }
    if (result.length > MAX_PENDING_UPDATES) throw new Error('本地协作文档待同步队列已满');
    return result.sort();
  };
  return {
    load: () => keys().map(key => {
      const { frame, rejected, intent } = frameFromBase64(localStorage.getItem(key) ?? '');
      const id = key.slice(prefix.length);
      let sessionRejected = false;
      try { sessionRejected = sessionStorage.getItem(`${rejectionPrefix}${id}`) === '1'; } catch {
        // The durable local marker remains authoritative when session storage is unavailable.
      }
      let durableRejected = false;
      try { durableRejected = localStorage.getItem(`${rejectionPrefix}${id}`) === '1'; } catch {
        // The original record may still carry its in-place marker.
      }
      return { id, frame, ...(rejected || sessionRejected || durableRejected ? { rejected: true } : {}),
        ...(intent ? { intent } : {}) };
    }),
    append: (frame, intent) => {
      if (frame.length < 2 || frame.length > MAX_PENDING_FRAME_BYTES || frame[0] !== 0x02) {
        throw new Error('协作文档更新超出本地安全边界');
      }
      if (keys().length >= MAX_PENDING_UPDATES) throw new Error('本地协作文档待同步队列已满');
      const random = new Uint8Array(12);
      globalThis.crypto.getRandomValues(random);
      const nonce = [...random].map(byte => byte.toString(16).padStart(2, '0')).join('');
      const id = `${Date.now().toString().padStart(13, '0')}-${(ordinal++).toString().padStart(6, '0')}-${nonce}`;
      localStorage.setItem(`${prefix}${id}`, encodePendingFrame(frame, intent));
      return id;
    },
    remove: id => {
      localStorage.removeItem(`${prefix}${id}`);
      localStorage.removeItem(`${rejectionPrefix}${id}`);
      try { sessionStorage.removeItem(`${rejectionPrefix}${id}`); } catch { /* optional fallback */ }
    },
    markRejected: id => {
      const key = `${prefix}${id}`;
      const stored = localStorage.getItem(key);
      if (!stored) throw new Error('本地协作文档待同步记录不存在');
      const { frame, intent } = frameFromBase64(stored);
      frame[0] = 0x03; // Local quarantine marker; never sent as a wire frame.
      try {
        localStorage.setItem(key, encodePendingFrame(frame, intent));
      } catch {
        try {
          // Independent durable key also protects a newly opened tab when the
          // existing record cannot be rewritten in place.
          localStorage.setItem(`${rejectionPrefix}${id}`, '1');
        } catch {
          // A new session treats every unconfirmed frame as uncertain and does
          // not automatically replay it, even if this marker cannot be stored.
          try { sessionStorage.setItem(`${rejectionPrefix}${id}`, '1'); } catch {
            // The original durable frame and readable intent remain untouched.
          }
        }
      }
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function useCollaborativeCanvas(
  projectId: string | null,
  actorId: string | null,
): CollaborativeCanvas {
  const generation = useMemo(() => ({ projectId, actorId }), [projectId, actorId]);
  const generationRef = useRef<typeof generation | null>(null);
  const [state, setState] = useState<CollaborativeCanvasState>(INITIAL_STATE);
  const sessionRef = useRef<CanvasDocumentSession | null>(null);
  const recoveryRef = useRef<ReturnType<CanvasDocumentSession['exportRecoveryCopy']> | null>(null);
  const canvasMediaRef = useRef<CanvasImage[]>([]);
  const mediaCompleteRef = useRef(false);
  const stopRef = useRef<(() => void) | null>(null);
  const mediaSyncRef = useRef<CanvasDocumentMediaSync | null>(null);

  // Commit-time cleanup invalidates old callbacks before any consumer layout
  // effect can launch another operation. Do not activate the new generation
  // here: its session is only installed by the passive connection lifecycle.
  useLayoutEffect(() => (): void => {
    if (generationRef.current === generation) generationRef.current = null;
  }, [generation]);

  useEffect(() => {
    generationRef.current = generation;
    let active = true;
    let connecting = false;
    let stopped = false;
    let attempts = 0;
    let inspectAttempts = 0;
    let inspecting = false;
    let legacyAuthority = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let legacyRecheck: ReturnType<typeof setTimeout> | null = null;
    let request: AbortController | null = null;
    let onFocus = (): void => {};
    let mediaSync: CanvasDocumentMediaSync | null = null;
    sessionRef.current = null;
    mediaSyncRef.current = null;
    recoveryRef.current = null;
    canvasMediaRef.current = [];
    mediaCompleteRef.current = false;
    const stop = (): void => {
      active = false;
      stopped = true;
      mediaCompleteRef.current = false;
      if (retry) clearTimeout(retry);
      retry = null;
      if (legacyRecheck) clearTimeout(legacyRecheck);
      legacyRecheck = null;
      window.removeEventListener('focus', onFocus);
      request?.abort();
      mediaSync?.stop();
      if (generationRef.current === generation) generationRef.current = null;
      if (mediaSyncRef.current === mediaSync) mediaSyncRef.current = null;
      const session = sessionRef.current;
      session?.disconnect();
      if (session) {
        try { recoveryRef.current = session.exportRecoveryCopy(); } catch {
          // No unconfirmed changes to retain. Durable storage is never removed here.
        }
      }
      sessionRef.current = null;
      if (stopRef.current === stop) stopRef.current = null;
    };
    stopRef.current = stop;
    if (!projectId || !actorId) {
      setState({ ...INITIAL_STATE, projectId: null, status: 'disabled' });
      return stop;
    }
    setState({ ...INITIAL_STATE, projectId });

    const stopForAccessLoss = (): void => {
      stop();
      setState(previous => ({ ...previous, authority: 'document',
        status: recoveryRef.current ? 'recovery' : 'unavailable' }));
    };

    const publishMedia = (status: CanvasDocumentStatus, images: Record<string, CanvasPlacement>,
      projection: CanvasDocumentProjection): void => {
      if (!active) return;
      mediaSync?.setDocument(projection, sessionRef.current?.appliedServerSequence ?? -1);
      const view = mediaSync!.view;
      const currentMedia = view.images;
      canvasMediaRef.current = currentMedia;
      mediaCompleteRef.current = view.complete;
      setState({ projectId, authority: 'document', appliedServerSequence: sessionRef.current?.appliedServerSequence ?? -1,
        status: (mediaCompleteRef.current && !mediaSync?.lastError) || status === 'rejected' || status === 'recovery'
          ? status : 'unavailable', images, canvasImages: view.images,
        groups: view.groups, annotations: view.annotations });
    };
    mediaSync = new CanvasDocumentMediaSync(projectId, () => {
      if (!active) return;
      const session = sessionRef.current;
      if (session) publishMedia(session.status, session.images, session.projection);
    }, stopForAccessLoss);

    const scheduleRetry = (): void => {
      if (!active || stopped || retry) return;
      const delay = Math.min(10_000, 500 * 2 ** Math.min(attempts++, 5));
      retry = setTimeout(() => {
        retry = null;
        void connect();
      }, delay);
    };

    const connect = async (): Promise<void> => {
      if (!active || stopped || connecting) return;
      connecting = true;
      const controller = new AbortController();
      request = controller;
      try {
        const response = await fetch('/api/collaboration/document-ticket', {
          method: 'POST', credentials: 'include', cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId }), signal: controller.signal,
        });
        if (!active || stopped || controller.signal.aborted) return;
        // HTTP authorization remains terminal even when an error body is not JSON.
        if (response.status === 401 || response.status === 403) {
          stopForAccessLoss();
          return;
        }
        const payload = asRecord(await response.json());
        if (!active || stopped || controller.signal.aborted) return;
        if (payload?.code === 'DOCUMENT_DISABLED' || payload?.code === 'DOCUMENT_PROJECT_NOT_ENABLED') {
          stopForAccessLoss();
          return;
        }
        if (!response.ok || typeof payload?.ticket !== 'string'
            || !TICKET_PATTERN.test(payload.ticket)) {
          setState(previous => ({ ...previous, authority: 'document', status: 'unavailable' }));
          scheduleRetry();
          return;
        }
        const url = new URL('/api/collaboration/document', window.location.href);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        const pendingStore = createBrowserPendingUpdateStore(projectId, actorId);
        pendingStore.load();
        const socket = new WebSocket(url.href, [
          'wujie-document-v1', `wujie-document-ticket.${payload.ticket}`,
        ]);
        if (sessionRef.current) {
          sessionRef.current.replaceSocket(socket);
        } else {
          sessionRef.current = createCanvasDocumentSession(socket, (status, images, projection) => {
            if (!active) return;
            publishMedia(status, images, projection);
            mediaSync?.autoRefresh();
            if (status === 'unavailable') scheduleRetry();
            if (status === 'saved') attempts = 0;
          }, pendingStore, stopForAccessLoss);
        }
        setState(previous => ({ ...previous, authority: 'document', status: 'connecting' }));
      } catch {
        if (active && !stopped && !controller.signal.aborted) {
          setState(previous => ({ ...previous, authority: 'document', status: 'unavailable' }));
          scheduleRetry();
        }
      } finally {
        if (request === controller) request = null;
        connecting = false;
      }
    };

    const scheduleInspectionRetry = (): void => {
      if (!active || stopped || retry || inspectAttempts >= 10) return;
      const delay = Math.min(10_000, 500 * 2 ** Math.min(inspectAttempts++, 5));
      retry = setTimeout(() => {
        retry = null;
        void inspect();
      }, delay);
    };

    const scheduleLegacyRecheck = (): void => {
      if (!active || stopped || !legacyAuthority || legacyRecheck) return;
      legacyRecheck = setTimeout(() => {
        legacyRecheck = null;
        void inspect();
      }, 5_000);
    };

    onFocus = (): void => {
      if (!active || stopped) return;
      const session = sessionRef.current;
      if (session && session.appliedServerSequence >= 0) {
        mediaSync?.autoRefresh(true);
        return;
      }
      if (!legacyAuthority) return;
      if (legacyRecheck) clearTimeout(legacyRecheck);
      legacyRecheck = null;
      void inspect();
    };

    const inspect = async (): Promise<void> => {
      if (!active || stopped || inspecting) return;
      inspecting = true;
      const controller = new AbortController();
      request = controller;
      try {
        const response = await readDocumentMediaResponse(projectId, controller.signal);
        const payload = asRecord(response.payload);
        if (!active || controller.signal.aborted) return;
        if (response.status === 409 && payload?.code === 'DOCUMENT_PROJECT_NOT_ENABLED') {
          legacyAuthority = true;
          setState({ ...INITIAL_STATE, projectId, authority: 'legacy', status: 'disabled' });
          return;
        }
        legacyAuthority = false;
        if (response.status === 403) {
          setState({ ...INITIAL_STATE, projectId, status: 'unavailable' });
          scheduleInspectionRetry();
          return;
        }
        if (!response.ok || payload?.success !== true || payload.projectId !== projectId) {
          setState({ ...INITIAL_STATE, projectId, status: 'unavailable' });
          return;
        }
        const directory = mediaSync!.acceptDirectory(payload);
        const projection = directory.projection;
        const images = projection.placements;
        canvasMediaRef.current = directory.canvasImages;
        const projected = projectDocumentPlacementsOntoImages(canvasMediaRef.current, images);
        mediaCompleteRef.current = projected.unresolvedPlacementIds.length === 0;
        const metadata = projectCanvasDocumentMetadata(
          projection, canvasMediaRef.current,
        );
        if (projected.unresolvedPlacementIds.length > 0) {
          setState({ projectId, authority: 'document', status: 'unavailable', appliedServerSequence: -1,
            images, canvasImages: projected.images, ...metadata });
          return;
        }
        if (payload.readOnly === true) {
          setState({ projectId, authority: 'document', status: 'read-only', appliedServerSequence: -1,
            images, canvasImages: projected.images, ...metadata });
          return;
        }
        mediaSyncRef.current = mediaSync;
        setState({ projectId, authority: 'document', status: 'connecting', appliedServerSequence: -1,
          images, canvasImages: projected.images, ...metadata });
        await connect();
      } catch {
        if (active && !controller.signal.aborted) {
          setState({ ...INITIAL_STATE, projectId, status: 'unavailable' });
        }
      } finally {
        if (request === controller) request = null;
        inspecting = false;
        scheduleLegacyRecheck();
      }
    };
    window.addEventListener('focus', onFocus);
    void inspect();
    return stop;
  }, [projectId, actorId, generation]);

  const isWritable = useCallback((): boolean => {
    const session = sessionRef.current;
    return generationRef.current === generation && session !== null
      && mediaCompleteRef.current && mediaSyncRef.current !== null && !mediaSyncRef.current.lastError
      && (session.status === 'saved' || session.status === 'pending');
  }, [generation]);
  const isSessionActive = useCallback((): boolean => {
    const session = sessionRef.current;
    return generationRef.current === generation && session !== null && mediaSyncRef.current !== null
      && (session.status === 'saved' || session.status === 'pending');
  }, [generation]);
  const refreshMedia = useCallback((input: { projectId: string; documentSequence: number; requireDirectorySequence?: boolean }): Promise<CanvasImage[]> => {
    if (input.projectId !== projectId || !Number.isSafeInteger(input.documentSequence) || input.documentSequence < 0) {
      return Promise.reject(new CanvasDocumentMediaSyncError('INVALID'));
    }
    if (generationRef.current !== generation) {
      return Promise.reject(new CanvasDocumentMediaSyncError('CANCELLED'));
    }
    if (!sessionRef.current || sessionRef.current.appliedServerSequence < 0 || !mediaSyncRef.current) {
      return Promise.reject(new CanvasDocumentMediaSyncError('UNAVAILABLE'));
    }
    return mediaSyncRef.current.refresh(input);
  }, [projectId, generation]);
  const requireCurrentSession = useCallback((): CanvasDocumentSession => {
    if (generationRef.current !== generation) throw new Error('协作文档作用域已改变');
    if (!mediaCompleteRef.current) throw new Error('协作媒体投影不完整，不能操作');
    if (!sessionRef.current) throw new Error('协作文档不可写');
    return sessionRef.current;
  }, [generation]);
  const waitForPendingUpdates = useCallback(async (): Promise<number> => {
    const session = requireCurrentSession();
    const sequence = await session.waitForPendingUpdates();
    if (requireCurrentSession() !== session) throw new Error('协作文档会话已改变');
    return sequence;
  }, [requireCurrentSession]);
  const applyLocalChange = useCallback((patch: CanvasImagePatch | CanvasImagePatch[]): void => {
    requireCurrentSession().applyLocalChange(patch);
  }, [requireCurrentSession]);
  const applyLocalGroups = useCallback((
    groups: ImageGroupData[], renderedBaseline?: ImageGroupData[],
  ): void => {
    requireCurrentSession().applyLocalGroups(
      toCanvasDocumentGroupRecords(groups, canvasMediaRef.current),
      renderedBaseline
        ? toCanvasDocumentGroupRecords(renderedBaseline, canvasMediaRef.current) : undefined,
    );
  }, [requireCurrentSession]);
  const applyLocalAnnotations = useCallback((
    annotations: CanvasAnnotationV2[], renderedBaseline?: CanvasAnnotationV2[],
  ): void => {
    requireCurrentSession().applyLocalAnnotations(
      toCanvasDocumentAnnotationRecords(annotations, canvasMediaRef.current),
      renderedBaseline
        ? toCanvasDocumentAnnotationRecords(renderedBaseline, canvasMediaRef.current) : undefined,
    );
  }, [requireCurrentSession]);
  const recordMediaHistory = useCallback((entry: CanvasDocumentMediaHistoryEntry): void => {
    requireCurrentSession().recordMediaHistory(entry);
  }, [requireCurrentSession]);
  const restorePlacementHistoryMetadata = useCallback((input: Parameters<CanvasDocumentSession['restorePlacementHistoryMetadata']>[0]): void => {
    const session = requireCurrentSession();
    if (input.removal && input.removal.projectId !== projectId) throw new Error('恢复前像不属于当前协作项目');
    session.restorePlacementHistoryMetadata(input);
  }, [requireCurrentSession, projectId]);
  const rebindPlacementHistory = useCallback((input: Parameters<CanvasDocumentSession['rebindPlacementHistory']>[0]): void => {
    requireCurrentSession().rebindPlacementHistory(input);
  }, [requireCurrentSession]);
  const undoLocal = useCallback((): void | Promise<void> => {
    return requireCurrentSession().undoLocal();
  }, [requireCurrentSession]);
  const redoLocal = useCallback((): void | Promise<void> => {
    return requireCurrentSession().redoLocal();
  }, [requireCurrentSession]);
  const retryRecovered = useCallback((): void => {
    if (!mediaCompleteRef.current) throw new Error('协作媒体投影不完整，不能重试');
    if (!sessionRef.current) throw new Error('协作文档不可重试');
    sessionRef.current.retryRecovered();
  }, []);
  const disconnect = useCallback((): void => {
    stopRef.current?.();
    setState(previous => ({ ...previous, status: recoveryRef.current ? 'recovery' : 'unavailable' }));
  }, []);
  const exportRecoveryCopy = useCallback((): string => {
    if (!projectId || !actorId || (state.status !== 'rejected' && state.status !== 'recovery') ||
        (!sessionRef.current && !recoveryRef.current)) {
      throw new Error('当前没有可导出的协作冲突副本');
    }
    const copy = recoveryRef.current ?? sessionRef.current!.exportRecoveryCopy();
    return JSON.stringify({
      schemaVersion: 1, projectId, actorId, capturedAt: new Date().toISOString(),
      projection: copy.projection, canvasImages: state.canvasImages,
      groups: state.groups, annotations: state.annotations,
      pendingFrames: copy.pendingFrames,
    }, null, 2);
  }, [projectId, actorId, state]);
  return { ...state, recoveryRetryReady: state.status === 'recovery' && mediaCompleteRef.current,
    applyLocalChange, applyLocalGroups, applyLocalAnnotations,
    recordMediaHistory, restorePlacementHistoryMetadata, rebindPlacementHistory,
    undoLocal, redoLocal, retryRecovered, exportRecoveryCopy, disconnect, refreshMedia, waitForPendingUpdates, isWritable, isSessionActive };
}

export function createCanvasDocumentSession(
  initialSocket: WebSocket,
  onStateChange?: (
    status: CanvasDocumentStatus,
    images: Record<string, CanvasPlacement>,
    projection: CanvasDocumentProjection,
  ) => void,
  pendingStore?: PendingDocumentUpdateStore,
  onAccessDenied?: () => void,
): CanvasDocumentSession {
  const doc = createCanvasDocument();
  const localOrigin = Symbol('canvas-document-local');
  const metadataTombstoneOrigin = Symbol('canvas-document-metadata-delete');
  const placementHistoryOrigin = Symbol('canvas-document-placement-history');
  const createUndoManager = (target: YTypes.Doc): YTypes.UndoManager => new Y.UndoManager([
    target.getMap('assetVersions'), target.getMap('transforms'),
    target.getMap('groups'), target.getMap('annotations'), target.getMap('tombstones'),
    target.getMap('groupDefinitions'), target.getMap('annotationRecords'),
    target.getMap('groupTombstones'), target.getMap('annotationTombstones'),
  ], { trackedOrigins: new Set([localOrigin]), captureTimeout: 0 });
  const undo = createUndoManager(doc);
  type YjsHistoryItem = YTypes.UndoManager['undoStack'][number];
  type HistoryEntry = { kind: 'yjs'; item: YjsHistoryItem; changes?: PlacementHistoryChange[]; annotationChanges?: AnnotationHistoryChange[] }
    | { kind: 'placement'; changes: PlacementHistoryChange[] }
    | { kind: 'annotation'; annotationChanges: AnnotationHistoryChange[] }
    | { kind: 'media'; operation: CanvasDocumentMediaHistoryEntry };
  const undoHistory: HistoryEntry[] = [];
  const redoHistory: HistoryEntry[] = [];
  const placementSuccessors = new Map<string, { placementId: string; assetVersionId: string }>();
  const placementPredecessors = new Map<string, string>();
  const ownedPlacementHeads = new Map<string, Partial<Record<PlacementHistoryField, string | null>>>();
  const annotationSuccessors = new Map<string, { annotationId: string; sourceImageId: string }>();
  const ownedAnnotationHeads = new Map<string, string | null>();
  const restoredPlacementHeads = new Map<string, {
    previousPlacementId: string;
    assetVersionId: string;
    heads: Partial<Record<'groups' | 'annotations', string | null>>;
    removalFingerprint?: string;
    annotationIds?: Record<string, string>;
    annotationHeads?: Record<string, string | null>;
  }>();
  let stagedPlacementHistory: PlacementHistoryChange[] | undefined;
  let stagedAnnotationHistory: AnnotationHistoryChange[] | undefined;
  let historyBusy = false;
  let mediaHistoryBusy = false;
  // A rejected media operation may have committed a prefix. Keep its cursor
  // retryable; a new edit must not clear redo or replace that prefix's identity.
  let mediaRecovery: { entry: HistoryEntry; direction: 'undo' | 'redo' } | null = null;
  undo.on('stack-item-added', event => {
    if (event.origin !== localOrigin) return;
    undoHistory.push({ kind: 'yjs', item: event.stackItem, changes: stagedPlacementHistory, annotationChanges: stagedAnnotationHistory });
    redoHistory.length = 0;
  });
  let status: CanvasDocumentStatus = 'connecting';
  let socket = initialSocket;
  let initialized = false;
  let disconnected = false;
  const pendingUpdates = pendingStore?.load() ?? [];
  let hasRejectedUpdates = pendingUpdates.some(update => update.rejected === true);
  let hasUncertainUpdates = pendingUpdates.length > 0 && !hasRejectedUpdates;
  let lastSequence = -1;
  let lastAckSequence = -1;
  let replayPendingAfterConnect = false;
  let automaticReplayCount = 0;
  let stagedLocalUpdate: { id: string; frame: Uint8Array; intent: Record<string, unknown> } | null = null;
  let recoveryCopy: ReturnType<CanvasDocumentSession['exportRecoveryCopy']> | null = null;
  const pendingWaiters = new Set<{
    timer: ReturnType<typeof setTimeout>;
    resolve(sequence: number): void;
    reject(error: Error): void;
  }>();
  const confirmationAvailable = (): boolean => !disconnected && initialized
    && (status === 'saved' || status === 'pending') && socket.readyState === WebSocket.OPEN;
  const settlePendingWaiters = (): void => {
    const available = confirmationAvailable();
    if (available && (status !== 'saved' || pendingUpdates.length > 0)) return;
    for (const waiter of pendingWaiters) {
      pendingWaiters.delete(waiter); clearTimeout(waiter.timer);
      if (!available) waiter.reject(new Error('DOCUMENT_PENDING_CONFIRMATION_UNAVAILABLE'));
      else waiter.resolve(Math.max(lastSequence, lastAckSequence));
    }
  };

  const captureRecoveryCopy = (): ReturnType<CanvasDocumentSession['exportRecoveryCopy']> => ({
    projection: readCanvasDocument(doc),
    pendingFrames: pendingUpdates.map(update => ({
      frameBase64: frameToBase64(update.frame),
      rejected: update.rejected === true,
      ...(update.intent ? { intent: update.intent } : {}),
    })),
  });

  const disconnect = (): void => {
    if (disconnected) return;
    if (pendingUpdates.length > 0) recoveryCopy = captureRecoveryCopy();
    disconnected = true;
    settlePendingWaiters();
    undoHistory.length = 0;
    redoHistory.length = 0;
    placementSuccessors.clear();
    placementPredecessors.clear();
    ownedPlacementHeads.clear();
    restoredPlacementHeads.clear();
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.close();
    doc.off('update', onUpdate);
    undo.destroy();
    doc.destroy();
    status = 'unavailable';
  };

  const publish = (): void => {
    if (disconnected) return;
    const projection = initialized ? readCanvasDocument(doc) : { placements: {} };
    try {
      onStateChange?.(status, projection.placements, projection);
    } catch {
      // An observer is not part of the Yjs transaction. Never let a UI callback
      // turn a committed update into a failed history step or interrupt cleanup.
      status = 'unavailable';
    }
    settlePendingWaiters();
  };
  const onUpdate = (update: Uint8Array, origin: unknown): void => {
    if (disconnected || !initialized) return;
    if (origin === 'remote') { retireOverwrittenPlacementFields(); retireOverwrittenAnnotations(); }
    if (origin === localOrigin || origin === metadataTombstoneOrigin || origin === placementHistoryOrigin || origin === undo) {
      const staged = stagedLocalUpdate;
      if (staged) {
        stagedLocalUpdate = null;
        pendingUpdates.push(staged);
        status = 'pending';
        try {
          if (socket.readyState !== WebSocket.OPEN) throw new Error('协作文档连接已断开');
          socket.send(staged.frame);
        } catch {
          status = 'unavailable';
        }
        publish();
        return;
      }
      if (socket.readyState !== WebSocket.OPEN) {
        status = 'unavailable';
        publish();
        return;
      }
      const frame = new Uint8Array(update.length + 1);
      frame[0] = 0x02;
      frame.set(update, 1);
      let persistedId = '';
      try {
        persistedId = pendingStore?.append(frame) ?? '';
      } catch {
        status = 'unavailable';
      }
      pendingUpdates.push({ id: persistedId, frame });
      if (status !== 'unavailable') status = 'pending';
      try {
        socket.send(frame);
      } catch {
        status = 'unavailable';
      }
      publish();
    }
    // Remote/recovery Yjs events are intermediate. The socket handler publishes
    // once the full canonical frame is validated and its sequence accepted.
  };
  doc.on('update', onUpdate);

  const applyDurableLocalUpdate = (
    write: (candidate: YTypes.Doc) => void,
    origin: unknown,
    beforeApply?: () => void,
    afterApply?: () => void,
    resolveOrigin?: () => unknown,
  ): boolean => {
    const stateVector = Y.encodeStateVector(doc);
    const beforeUpdate = Y.encodeStateAsUpdate(doc);
    const before = readCanvasDocument(doc);
    // Undo stacks reference deleted structs; the replay clone must retain them.
    const candidate = new Y.Doc({ gc: false });
    let update: Uint8Array;
    let intent: Record<string, unknown>;
    try {
      Y.applyUpdate(candidate, beforeUpdate, 'local-candidate');
      write(candidate);
      const after = readCanvasDocument(candidate);
      if (JSON.stringify(after) === JSON.stringify(before)) return false;
      intent = documentRecoveryIntent(before, after);
      update = Y.encodeStateAsUpdate(candidate, stateVector);
    } finally {
      candidate.destroy();
    }
    const frame = new Uint8Array(update.length + 1);
    frame[0] = 0x02;
    frame.set(update, 1);
    let id = '';
    try {
      id = pendingStore?.append(frame, intent) ?? '';
    } catch (error) {
      status = 'unavailable';
      publish();
      throw error;
    }
    stagedLocalUpdate = { id, frame, intent };
    let liveApplicationStarted = false;
    try {
      beforeApply?.();
      const appliedOrigin = resolveOrigin?.() ?? origin;
      liveApplicationStarted = true;
      Y.applyUpdate(doc, update, appliedOrigin);
      if (stagedLocalUpdate) {
        stagedLocalUpdate = null;
        if (id) pendingStore?.remove(id);
      }
    } catch (error) {
      const unapplied = stagedLocalUpdate;
      stagedLocalUpdate = null;
      status = 'unavailable';
      if (unapplied) {
        const currentUpdate = Y.encodeStateAsUpdate(doc);
        // A pre-apply guard can observe an unrelated remote update. Our own
        // frame is provably unapplied until Y.applyUpdate starts; don't confuse
        // that remote change with partial local application.
        const unchanged = !liveApplicationStarted || (currentUpdate.length === beforeUpdate.length &&
          currentUpdate.every((byte, index) => byte === beforeUpdate[index]));
        try {
          if (!unchanged) throw new Error('协作更新应用状态不确定');
          if (id) pendingStore?.remove(id);
        } catch {
          // Retain a fail-closed recovery record if partial application or failed
          // cleanup makes the durable update uncertain. Do not silently replay.
          pendingUpdates.push({ ...unapplied, rejected: true });
          hasRejectedUpdates = true;
          status = 'rejected';
          try { if (id) pendingStore?.markRejected?.(id); } catch { /* Preserve the in-memory rejection. */ }
        }
      }
      publish();
      throw error;
    } finally {
      afterApply?.();
    }
    return true;
  };

  const placementHead = (placementId: string, field: PlacementHistoryField): string | null => {
    const id = doc.getMap(field)._map.get(placementId)?.id;
    return id ? `${id.client}:${id.clock}` : null;
  };
  const initialPlacementHead = (placementId: string, field: PlacementHistoryField): string | null => {
    const map = doc.getMap(field);
    let item = map._map.get(placementId);
    // Canonical frames may coalesce attach and later overwrites. The retained
    // same-key chain identifies the first write even when its content was GC'd.
    while (item?.left?.parent === map && item.left.parentSub === placementId) item = item.left;
    return item ? `${item.id.client}:${item.id.clock}` : null;
  };
  const rememberPlacementHeads = (changes: PlacementHistoryChange[]): void => {
    for (const change of changes) {
      const heads = ownedPlacementHeads.get(change.placementId) ?? {};
      for (const field of change.fields) heads[field] = placementHead(change.placementId, field);
      ownedPlacementHeads.set(change.placementId, heads);
    }
  };
  const annotationHead = (annotationId: string): string | null => {
    const id = doc.getMap('annotationRecords')._map.get(annotationId)?.id;
    return id ? `${id.client}:${id.clock}` : null;
  };
  const resolveHistoryAnnotation = (annotationId: string): { annotationId: string; sourceImageId?: string } => {
    let resolved: { annotationId: string; sourceImageId?: string } = { annotationId };
    while (annotationSuccessors.has(resolved.annotationId)) resolved = annotationSuccessors.get(resolved.annotationId)!;
    return resolved;
  };
  const rememberAnnotationHeads = (changes: AnnotationHistoryChange[]): void => {
    for (const change of changes) {
      const id = resolveHistoryAnnotation(change.annotationId).annotationId;
      ownedAnnotationHeads.set(id, annotationHead(id));
    }
  };
  const retireOverwrittenAnnotations = (): void => {
    for (const history of [undoHistory, redoHistory]) for (const entry of history) {
      if (entry.kind === 'media' || entry.kind === 'placement') continue;
      for (const change of entry.annotationChanges ?? []) {
        const id = resolveHistoryAnnotation(change.annotationId).annotationId;
        if (ownedAnnotationHeads.get(id) !== annotationHead(id)) change.retired = true;
      }
    }
  };
  const convertPlacementHistory = (): void => {
    const removed = new Set<YjsHistoryItem>();
    for (const history of [undoHistory, redoHistory]) {
      for (let index = 0; index < history.length; index++) {
        const entry = history[index];
        if (entry.kind !== 'yjs') continue;
        if (entry.annotationChanges !== undefined && annotationSuccessors.size) {
          removed.add(entry.item);
          history[index] = { kind: 'annotation', annotationChanges: entry.annotationChanges };
          continue;
        }
        if (entry.changes === undefined) continue;
        removed.add(entry.item);
        history[index] = { kind: 'placement', changes: entry.changes };
      }
    }
    if (!removed.size) return;
    // All reversible placement items now carry explicit intents; release their
    // native retained structs without clearing metadata history or media redo.
    const keepUndo = undo.undoStack.filter(item => !removed.has(item));
    const keepRedo = undo.redoStack.filter(item => !removed.has(item));
    undo.undoStack = undo.undoStack.filter(item => removed.has(item));
    undo.redoStack = undo.redoStack.filter(item => removed.has(item));
    undo.clear();
    undo.undoStack = keepUndo;
    undo.redoStack = keepRedo;
  };
  const resolveHistoryPlacement = (change: PlacementHistoryChange): string | null => {
    let id = change.placementId;
    while (placementSuccessors.has(id)) {
      const successor = placementSuccessors.get(id)!;
      if (successor.assetVersionId !== change.assetVersionId) return null;
      id = successor.placementId;
    }
    return id;
  };
  const retireOverwrittenPlacementFields = (): void => {
    for (const history of [undoHistory, redoHistory]) {
      for (const entry of history) {
        if (entry.kind === 'media' || entry.kind === 'annotation' || !entry.changes) continue;
        for (const change of entry.changes) {
          const placementId = resolveHistoryPlacement(change);
          if (!placementId) { change.fields = []; continue; }
          change.fields = change.fields.filter(field => (
            ownedPlacementHeads.get(placementId)?.[field] === placementHead(placementId, field)
          ));
        }
      }
    }
  };
  const applyPlacementHistory = (
    direction: 'undo' | 'redo', changes: PlacementHistoryChange[],
  ): PlacementHistoryChange[] => {
    const appliedChanges: PlacementHistoryChange[] = [];
    applyDurableLocalUpdate(candidate => {
      const current = readCanvasDocument(candidate);
      candidate.transact(() => {
        for (const change of changes) {
          const placementId = resolveHistoryPlacement(change);
          if (!placementId) continue;
          const placement = current.placements[placementId];
          if (!placement || placement.deleted || placement.assetVersionId !== change.assetVersionId) continue;
          const expected = direction === 'undo' ? change.after : change.before;
          const desired = direction === 'undo' ? change.before : change.after;
          const fields = change.fields.filter(field => {
            if (placementHistoryValue(placement, field) !== placementHistoryValue(expected, field) ||
                ownedPlacementHeads.get(placementId)?.[field] !== placementHead(placementId, field)) return false;
            if (field === 'groups' && desired.groupId && current.groupTombstones?.[desired.groupId]) return false;
            return true;
          });
          if (!fields.length) continue;
          const patch: CanvasImagePatch = { placementId };
          for (const field of fields) {
            if (field === 'transforms') for (const key of HISTORY_TRANSFORM_FIELDS) patch[key] = desired[key];
            else if (field === 'groups') patch.groupId = desired.groupId ?? null;
            else patch.annotation = desired.annotation ?? '';
          }
          applyCanvasImagePatch(candidate, patch, placementHistoryOrigin);
          appliedChanges.push({ ...change, placementId, fields });
        }
      }, placementHistoryOrigin);
    }, placementHistoryOrigin);
    rememberPlacementHeads(appliedChanges);
    return appliedChanges;
  };
  const applyAnnotationHistory = (direction: 'undo' | 'redo', changes: AnnotationHistoryChange[]): {
    appliedChanges: AnnotationHistoryChange[]; tombstonedIds: Set<string>;
  } => {
    const appliedChanges: AnnotationHistoryChange[] = [];
    const tombstonedIds = new Set<string>();
    applyDurableLocalUpdate(candidate => {
      const projection = readCanvasDocument(candidate);
      candidate.transact(() => {
        for (const change of changes) {
          if (change.retired) continue;
          const resolved = resolveHistoryAnnotation(change.annotationId);
          const id = resolved.annotationId;
          const record = projection.annotationRecords?.[id];
          const remap = (value: CanvasAnnotationV2): CanvasAnnotationV2 => resolved.sourceImageId
            ? restoreCanvasDocumentAnnotationIdentity(value, id, resolved.sourceImageId) : value;
          const expected = direction === 'undo' ? change.after : change.before;
          const desired = direction === 'undo' ? change.before : change.after;
          if (!record || projection.annotationTombstones?.[id] || !expected
              || ownedAnnotationHeads.get(id) !== annotationHead(id)
              || annotationHistoryValue(record) !== annotationHistoryValue(remap(expected))) continue;
          if (!desired) {
            tombstoneCanvasAnnotation(candidate, id, placementHistoryOrigin);
            tombstonedIds.add(id);
          } else {
            const next = remap(desired);
            if (!projection.placements[next.sourceImageId] || projection.placements[next.sourceImageId].deleted) continue;
            candidate.getMap('annotationRecords').set(id, next);
            appliedChanges.push(change);
          }
        }
      }, placementHistoryOrigin);
    }, placementHistoryOrigin);
    rememberAnnotationHeads(appliedChanges);
    return { appliedChanges, tombstonedIds };
  };

  const applyDurableHistory = (direction: 'undo' | 'redo', item: YjsHistoryItem): boolean => {
    const before = readCanvasDocument(doc);
    let nextUndoStack = undo.undoStack;
    let nextRedoStack = undo.redoStack;
    let convertedMetadataCreation = false;
    let redoneLinks: YjsRedoneLink[] = [];
    const applied = applyDurableLocalUpdate(candidate => {
      // Preview the history operation in a separate doc. An undo of a newly
      // created metadata record removes its Y.Map key, which the server forbids;
      // the durable update must instead tombstone that record in the original.
      const preview = new Y.Doc({ gc: false });
      Y.applyUpdate(preview, Y.encodeStateAsUpdate(candidate), 'history-preview');
      restoreYjsRedoneLinks(preview, readYjsRedoneLinks(doc));
      const candidateUndo = createUndoManager(preview);
      try {
        // A remote overwrite can make a local item a no-op. Never let Yjs's
        // internal search skip across a media-command boundary to an older edit.
        candidateUndo.undoStack = direction === 'undo' ? [item] : [...undo.undoStack];
        candidateUndo.redoStack = direction === 'redo' ? [item] : [...undo.redoStack];
        if (direction === 'undo') candidateUndo.undo();
        else candidateUndo.redo();
        nextUndoStack = direction === 'undo'
          ? undo.undoStack.filter(existing => existing !== item) : candidateUndo.undoStack;
        nextRedoStack = direction === 'redo'
          ? undo.redoStack.filter(existing => existing !== item) : candidateUndo.redoStack;
        const before = readCanvasDocument(candidate);
        const after = readCanvasDocument(preview);
        const removedGroups = Object.keys(before.groupDefinitions ?? {}).filter(id => (
          !Object.hasOwn(after.groupDefinitions ?? {}, id)
        ));
        const removedAnnotations = Object.keys(before.annotationRecords ?? {}).filter(id => (
          !Object.hasOwn(after.annotationRecords ?? {}, id)
        ));
        if (direction === 'undo' && (removedGroups.length > 0 || removedAnnotations.length > 0)) {
          convertedMetadataCreation = true;
          // A tombstoned identity cannot be restored by Yjs redo. The user may
          // create a new record, but must not replay an inverse tombstone.
          nextRedoStack = [];
          candidate.transact(() => {
            for (const id of removedGroups) tombstoneCanvasGroup(candidate, id, metadataTombstoneOrigin);
            for (const id of removedAnnotations) tombstoneCanvasAnnotation(candidate, id, metadataTombstoneOrigin);
          }, metadataTombstoneOrigin);
        } else {
          redoneLinks = readYjsRedoneLinks(preview);
          Y.applyUpdate(candidate, Y.encodeStateAsUpdate(preview, Y.encodeStateVector(candidate)), undo);
        }
      } finally {
        candidateUndo.destroy();
        preview.destroy();
      }
    }, undo, () => {
      // Do not pop the live source stack until its update has actually applied.
      if (!convertedMetadataCreation) {
        if (direction === 'undo') undo.undoing = true;
        else undo.redoing = true;
      }
    }, () => {
      undo.undoing = false;
      undo.redoing = false;
    }, () => convertedMetadataCreation ? metadataTombstoneOrigin : undo);
    if (convertedMetadataCreation) {
      undo.clear(false, true);
      undo.undoStack = nextUndoStack;
    } else if (!applied) {
      undo.undoStack = nextUndoStack;
      undo.redoStack = nextRedoStack;
    } else {
      if (direction === 'undo') undo.undoStack = nextUndoStack;
      else undo.redoStack = nextRedoStack;
      // A rejected durable append must leave the live links and cursor intact.
      restoreYjsRedoneLinks(doc, redoneLinks);
    }
    if (applied) {
      const after = readCanvasDocument(doc);
      rememberPlacementHeads(placementHistoryChanges(before, after) ?? []);
      rememberAnnotationHeads(annotationHistoryChanges(before, after));
    }
    return convertedMetadataCreation;
  };

  const runHistory = (direction: 'undo' | 'redo'): void | Promise<void> => {
    if (disconnected || !initialized || historyBusy ||
        (status !== 'saved' && status !== 'pending') || socket.readyState !== WebSocket.OPEN) {
      throw new Error('协作文档尚未连接或历史操作未完成');
    }
    if (mediaRecovery && mediaRecovery.direction !== direction) {
      throw new Error(mediaRecovery.direction === 'undo' ? '请先重试完成上一次撤销' : '请先重试完成上一次重做');
    }
    const source = direction === 'undo' ? undoHistory : redoHistory;
    const destination = direction === 'undo' ? redoHistory : undoHistory;
    const entry = source.at(-1);
    if (mediaRecovery && mediaRecovery.entry !== entry) throw new Error('待重试媒体历史已不在当前游标');
    if (!entry) return;
    const inverse = direction === 'undo' ? undo.redoStack : undo.undoStack;
    const previousInverse = inverse.at(-1);
    let invalidatesRedo = false;
    let placementInverse: PlacementHistoryChange[] = [];
    let nativeInverse: PlacementHistoryChange[] | undefined;
    let annotationInverse: AnnotationHistoryChange[] = [];
    let annotationTombstonedIds = new Set<string>();
    let nativeAnnotationInverse: AnnotationHistoryChange[] | undefined;
    historyBusy = true;
    const complete = (): void => {
      if (disconnected) return;
      source.pop();
      if (entry.kind === 'media') { destination.push(entry); mediaRecovery = null; }
      else if (entry.kind === 'placement') {
        if (placementInverse.length) destination.push({ kind: 'placement', changes: placementInverse });
      }
      else if (entry.kind === 'annotation') {
        if (annotationInverse.length) destination.push({ kind: 'annotation', annotationChanges: annotationInverse });
        if (annotationTombstonedIds.size) {
          const legalRedo = redoHistory.filter(history => {
            if (history.kind !== 'annotation') return true;
            history.annotationChanges = history.annotationChanges.filter(change => (
              !annotationTombstonedIds.has(resolveHistoryAnnotation(change.annotationId).annotationId)
            ));
            return history.annotationChanges.length > 0;
          });
          redoHistory.splice(0, redoHistory.length, ...legalRedo);
        }
      }
      else {
        const generated = (direction === 'undo' ? undo.redoStack : undo.undoStack).at(-1);
        if (generated && generated !== previousInverse) destination.push({ kind: 'yjs', item: generated,
          changes: nativeInverse, annotationChanges: nativeAnnotationInverse });
        // Metadata creation undo intentionally has no legal redo. Reflect the
        // existing clear in the logical cursor as well as in Yjs's stack.
        if (invalidatesRedo) {
          // Only the Yjs inverse would revive a metadata tombstone. Independent
          // media commands can still redo legally, in their original order.
          const mediaRedo = redoHistory.filter(history => history.kind !== 'yjs');
          redoHistory.splice(0, redoHistory.length, ...mediaRedo);
        }
      }
    };
    try {
      let result: void | Promise<void> = undefined;
      if (entry.kind === 'media') { mediaHistoryBusy = true; result = entry.operation[direction](); }
      else if (entry.kind === 'placement') placementInverse = applyPlacementHistory(direction, entry.changes);
      else if (entry.kind === 'annotation') {
        const applied = applyAnnotationHistory(direction, entry.annotationChanges);
        annotationInverse = applied.appliedChanges; annotationTombstonedIds = applied.tombstonedIds;
      }
      else {
        const before = readCanvasDocument(doc);
        invalidatesRedo = applyDurableHistory(direction, entry.item);
        if (entry.changes !== undefined) {
          nativeInverse = (placementHistoryChanges(before, readCanvasDocument(doc)) ?? []).map(change => ({
            ...change,
            before: direction === 'undo' ? change.after : change.before,
            after: direction === 'undo' ? change.before : change.after,
            fields: change.fields.filter(field => entry.changes?.some(original => (
              original.placementId === change.placementId && original.assetVersionId === change.assetVersionId &&
              original.fields.includes(field)
            ))),
          }));
        }
        if (entry.annotationChanges !== undefined) {
          nativeAnnotationInverse = annotationHistoryChanges(before, readCanvasDocument(doc)).flatMap(change => {
            if (!entry.annotationChanges?.some(original => original.annotationId === change.annotationId)) return [];
            if (direction === 'undo') return change.before ? [{ ...change, before: change.after, after: change.before }] : [];
            return [change];
          });
        }
      }
      if (result !== undefined) {
        return Promise.resolve(result).then(complete).catch((error: unknown): never => {
          if (entry.kind === 'media' && !disconnected) mediaRecovery = { entry, direction };
          throw error;
        }).finally(() => { historyBusy = false; mediaHistoryBusy = false; });
      }
      complete();
      historyBusy = false;
      mediaHistoryBusy = false;
    } catch (error) {
      if (entry.kind === 'media' && !disconnected) mediaRecovery = { entry, direction };
      historyBusy = false;
      mediaHistoryBusy = false;
      throw error;
    }
  };

  const applyMetadata = (
    kind: 'groupDefinitions' | 'annotationRecords',
    desired: Record<string, ImageGroupData> | Record<string, CanvasAnnotationV2>,
    renderedBaseline?: Record<string, ImageGroupData> | Record<string, CanvasAnnotationV2>,
  ): void => {
    if (disconnected || !initialized || historyBusy || mediaRecovery !== null ||
        (status !== 'saved' && status !== 'pending') || socket.readyState !== WebSocket.OPEN) {
      throw new Error('协作文档尚未连接，不能写入');
    }
    const current = readCanvasDocument(doc);
    const existing = current[kind] ?? {};
    const baseline = renderedBaseline ?? existing;
    const tombstones = kind === 'groupDefinitions'
      ? current.groupTombstones ?? {} : current.annotationTombstones ?? {};
    const removed = Object.keys(baseline).some(id => (
      tombstones[id] !== true && !Object.hasOwn(desired, id)
    ));
    const origin = removed ? metadataTombstoneOrigin : localOrigin;
    let annotationChanges: AnnotationHistoryChange[] | undefined;
    const write = (target: YTypes.Doc): void => {
      const before = kind === 'annotationRecords' && !removed ? readCanvasDocument(target) : undefined;
      target.transact(() => {
        const records = target.getMap<ImageGroupData | CanvasAnnotationV2>(kind);
        for (const [id, record] of Object.entries(desired)) {
          if (JSON.stringify(baseline[id]) === JSON.stringify(record)) continue;
          if (Object.hasOwn(tombstones, id)) throw new Error('已删除的协作记录不能恢复');
          if (record.id !== id) throw new Error('协作记录身份不一致');
          if (JSON.stringify(records.get(id)) !== JSON.stringify(record)) records.set(id, record);
        }
        for (const id of Object.keys(baseline)) {
          if (Object.hasOwn(tombstones, id) || Object.hasOwn(desired, id)) continue;
          if (kind === 'groupDefinitions') tombstoneCanvasGroup(target, id, origin);
          else tombstoneCanvasAnnotation(target, id, origin);
        }
      }, origin);
      if (before) annotationChanges = annotationHistoryChanges(before, readCanvasDocument(target));
    };
    const applied = applyDurableLocalUpdate(write, origin, () => { stagedAnnotationHistory = annotationChanges; },
      () => { stagedAnnotationHistory = undefined; });
    if (applied && annotationChanges) rememberAnnotationHeads(annotationChanges);
    if (annotationSuccessors.size) convertPlacementHistory();
  };

  const attachSocket = (connected: WebSocket): void => {
    socket = connected;
    connected.binaryType = 'arraybuffer';
    connected.onmessage = event => {
    if (socket !== connected) return;
    if (disconnected || !(event.data instanceof ArrayBuffer) || event.data.byteLength < 9) {
      return;
    }
    const bytes = new Uint8Array(event.data);
    const sequenceValue = new DataView(event.data).getBigUint64(1);
    if (sequenceValue > BigInt(Number.MAX_SAFE_INTEGER)) {
      connected.close();
      status = 'unavailable';
      publish();
      return;
    }
    const sequence = Number(sequenceValue);
    if (bytes[0] === 0x11 && sequence >= lastSequence) {
      try {
        Y.applyUpdate(doc, bytes.subarray(9), 'remote');
        if (hasRejectedUpdates || hasUncertainUpdates) {
          // Keep a readable local fork for recovery, but never replay its
          // rejected frames to the server. Validate before touching the live doc.
          const fork = new Y.Doc({ gc: false });
          try {
            Y.applyUpdate(fork, Y.encodeStateAsUpdate(doc), 'recovery-base');
            for (const pending of pendingUpdates) {
              Y.applyUpdate(fork, pending.frame.subarray(1), 'recovery-fork');
            }
            readCanvasDocument(fork);
            Y.applyUpdate(doc, Y.encodeStateAsUpdate(fork, Y.encodeStateVector(doc)), 'recovery-fork');
          } catch {
            // Corrupt client bytes remain in the durable queue for export;
            // the authoritative server projection stays readable.
          } finally {
            fork.destroy();
          }
        } else {
          for (const pending of pendingUpdates) {
            Y.applyUpdate(doc, pending.frame.subarray(1), 'pending-recovery');
          }
        }
        readCanvasDocument(doc);
      } catch {
        connected.close();
        status = 'unavailable';
        publish();
        return;
      }
      const replayPending = !initialized || replayPendingAfterConnect;
      if (replayPendingAfterConnect && pendingUpdates.length > 0 &&
          automaticReplayCount >= MAX_AUTOMATIC_REPLAYS && !hasRejectedUpdates) {
        hasUncertainUpdates = true;
      }
      initialized = true;
      lastSequence = sequence;
      status = hasRejectedUpdates ? 'rejected' : hasUncertainUpdates ? 'recovery'
        : pendingUpdates.length > 0 ? 'pending' : 'saved';
      if (replayPending && pendingUpdates.length > 0 && !hasRejectedUpdates && !hasUncertainUpdates) {
        try {
          if (replayPendingAfterConnect) automaticReplayCount += 1;
          for (const update of pendingUpdates) connected.send(update.frame);
        } catch {
          status = 'unavailable';
        }
      }
      replayPendingAfterConnect = false;
      publish();
    } else if (bytes[0] === 0x12 && initialized && bytes.length === 9
        && sequence >= lastAckSequence && pendingUpdates.length > 0 && !pendingUpdates[0].rejected) {
      lastAckSequence = sequence;
      const acknowledged = pendingUpdates.shift();
      if (acknowledged?.id) {
        try { pendingStore?.remove(acknowledged.id); } catch {
          // A confirmed server update is safe to replay if local cleanup fails.
        }
      }
      // Earlier sent frames may still ACK after a later local failure. Confirm
      // those frames without unlocking rejected/uncertain recovery history.
      status = hasRejectedUpdates ? 'rejected' : hasUncertainUpdates ? 'recovery'
        : pendingUpdates.length > 0 ? 'pending' : 'saved';
      if (pendingUpdates.length === 0) automaticReplayCount = 0;
      publish();
    }
    };
    connected.onclose = event => {
    if (disconnected || socket !== connected) return;
    // Other 1008 reasons (queue/rate/buffer budgets) are transient. This pair
    // specifically identifies DocumentAccessError in the gateway protocol.
    if (event.code === 1008 && event.reason === 'document unavailable') {
      disconnect();
      onAccessDenied?.();
      return;
    }
    if (event.code === 4400) {
      hasRejectedUpdates = true;
      for (const update of pendingUpdates) {
        if (update.rejected) continue;
        try {
          if (update.id) pendingStore?.markRejected?.(update.id);
        } catch {
          // Keep this session fail-closed even if browser storage becomes unavailable.
        }
        update.rejected = true;
      }
      status = 'rejected';
    } else {
      status = hasRejectedUpdates ? 'rejected' : 'unavailable';
    }
    publish();
    };
    connected.onerror = () => {
      if (!disconnected && socket === connected) connected.close();
    };
  };
  attachSocket(initialSocket);

  return {
    waitForPendingUpdates(): Promise<number> {
      if (!confirmationAvailable()) return Promise.reject(new Error('DOCUMENT_PENDING_CONFIRMATION_UNAVAILABLE'));
      if (status === 'saved' && pendingUpdates.length === 0) return Promise.resolve(Math.max(lastSequence, lastAckSequence));
      return new Promise<number>((resolve, reject): void => {
        const waiter = { resolve, reject, timer: setTimeout((): void => {
          pendingWaiters.delete(waiter);
          reject(new Error('DOCUMENT_PENDING_CONFIRMATION_TIMEOUT'));
        }, 10_000) };
        pendingWaiters.add(waiter);
      });
    },
    get appliedServerSequence() { return lastSequence; },
    get images() { return initialized ? readCanvasDocument(doc).placements : {}; },
    get projection() { return initialized ? readCanvasDocument(doc) : { placements: {} }; },
    get status() { return status; },
    applyLocalGroups(groups, baseline): void { applyMetadata('groupDefinitions', groups, baseline); },
    applyLocalAnnotations(annotations, baseline): void { applyMetadata('annotationRecords', annotations, baseline); },
    restorePlacementHistoryMetadata({ previousPlacementId, nextPlacementId, assetVersionId, removal, requirePristine }): void {
      if (disconnected || !initialized || ((historyBusy || mediaRecovery !== null) && !mediaHistoryBusy) ||
          (status !== 'saved' && status !== 'pending') || socket.readyState !== WebSocket.OPEN) {
        throw new Error('协作文档不可恢复摆放字段');
      }
      const projection = readCanvasDocument(doc);
      const previous = Object.hasOwn(projection.placements, previousPlacementId) ? projection.placements[previousPlacementId] : undefined;
      const next = Object.hasOwn(projection.placements, nextPlacementId) ? projection.placements[nextPlacementId] : undefined;
      if (previousPlacementId === nextPlacementId || !previous?.deleted || !next || next.deleted ||
          previous.assetVersionId !== assetVersionId || next.assetVersionId !== assetVersionId) {
        throw new Error('摆放字段只能恢复已确认的同版本新身份');
      }
      let snapshot: DocumentPlacementRemovalSnapshot | undefined;
      let removalFingerprint: string | undefined;
      const annotations: Record<string, CanvasAnnotationV2> = Object.create(null) as Record<string, CanvasAnnotationV2>;
      if (removal !== undefined) {
        const envelope = asRecord(removal);
        const mapping = asRecord(envelope?.annotationIds);
        if (!envelope || !mapping || Object.keys(envelope).some(key => !['projectId', 'snapshot', 'annotationIds'].includes(key))) {
          throw new Error('删除恢复映射无效');
        }
        snapshot = parseDocumentPlacementRemovalSnapshot(envelope.snapshot);
        if (snapshot.projectId !== envelope.projectId || snapshot.placementId !== previousPlacementId ||
            snapshot.placement.assetVersionId !== assetVersionId) throw new Error('删除恢复前像来源不一致');
        const oldIds = Object.keys(snapshot.annotationRecords).sort();
        const targets = oldIds.map(id => mapping[id]);
        if (Object.keys(mapping).length !== oldIds.length || oldIds.some(id => !Object.hasOwn(mapping, id)) ||
            targets.some(id => typeof id !== 'string') || new Set(targets).size !== targets.length) {
          throw new Error('删除恢复标注映射不完整或重复');
        }
        for (const oldId of oldIds) {
          const id = mapping[oldId] as string;
          if (oldIds.includes(id)) throw new Error('删除恢复标注必须使用新身份');
          annotations[id] = restoreCanvasDocumentAnnotationIdentity(snapshot.annotationRecords[oldId], id, nextPlacementId);
        }
        // Reuse document validation for safe IDs, record budget and complete
        // geometry; never let a malformed mapping reach durable persistence.
        validateCanvasDocumentProjection({ placements: { [nextPlacementId]: next }, annotationRecords: annotations });
        removalFingerprint = JSON.stringify({ projectId: snapshot.projectId, snapshot,
          annotationIds: Object.fromEntries(oldIds.map(id => [id, mapping[id]])) });
      }
      const restored = restoredPlacementHeads.get(nextPlacementId);
      if (restored) {
        if (restored.previousPlacementId !== previousPlacementId || restored.assetVersionId !== assetVersionId ||
            restored.removalFingerprint !== removalFingerprint) {
          throw new Error('摆放字段已有其他恢复来源');
        }
        // Never recapture a remote overwrite on a repeated restoration call.
        return;
      }
      if (placementSuccessors.has(previousPlacementId) || placementPredecessors.has(nextPlacementId) || placementSuccessors.has(nextPlacementId)) {
        throw new Error('摆放字段必须在身份接续前恢复');
      }
      if (requirePristine) {
        // HTTP proof can become stale while awaiting catch-up/readback. The
        // last synchronous guard uses the actual Y.Doc, including retired heads,
        // and refuses the entire recovery rather than supplementing a conflict.
        if (!snapshot || doc.getMap('groups')._map.has(nextPlacementId) || doc.getMap('annotations')._map.has(nextPlacementId)
            || Object.keys(annotations).some(id => doc.getMap('annotationRecords')._map.has(id)
              || doc.getMap('annotationTombstones')._map.has(id))
            || Object.entries(snapshot.annotationRecords).some(([id, record]) => projection.annotationTombstones?.[id] !== true
              || annotationHistoryValue(projection.annotationRecords?.[id]) !== annotationHistoryValue(record))
            || snapshot.groupIds.some(id => !projection.groupTombstones?.[id] && (!projection.groupDefinitions?.[id]
              || projection.groupDefinitions[id].imageIds.includes(previousPlacementId)
              || projection.groupDefinitions[id].imageIds.includes(nextPlacementId)))) {
          throw new Error('DOCUMENT_HISTORY_METADATA_CONFLICT');
        }
      }
      if (snapshot) {
        for (const oldId of Object.keys(snapshot.annotationRecords)) {
          if (projection.annotationTombstones?.[oldId] !== true) throw new Error('旧标注删除尚未确认');
        }
        for (const id of Object.keys(annotations)) {
          // A deleted Y.Map key also has identity history. It cannot be
          // reclaimed merely because get/has no longer exposes a live value.
          if (doc.getMap('annotationRecords')._map.has(id) || doc.getMap('annotationTombstones')._map.has(id)) {
            throw new Error('恢复标注身份已被使用');
          }
        }
      }
      const source = snapshot?.placement ?? previous;
      const fields: Array<'groups' | 'annotations'> = [];
      const patch: CanvasImagePatch = { placementId: nextPlacementId };
      if (Object.hasOwn(source, 'groupId') && !doc.getMap('groups')._map.has(nextPlacementId) &&
          (!source.groupId || (Object.hasOwn(projection.groupDefinitions ?? {}, source.groupId) &&
            !projection.groupTombstones?.[source.groupId]))) {
        fields.push('groups');
        patch.groupId = source.groupId ?? null;
      }
      if (Object.hasOwn(source, 'annotation') && !doc.getMap('annotations')._map.has(nextPlacementId)) {
        fields.push('annotations');
        patch.annotation = source.annotation ?? '';
      }
      const groups: Record<string, ImageGroupData> = {};
      for (const id of snapshot?.groupIds ?? []) {
        const group = projection.groupDefinitions?.[id];
        if (group && !projection.groupTombstones?.[id] && !group.imageIds.includes(nextPlacementId)) {
          groups[id] = { ...group, imageIds: [...group.imageIds, nextPlacementId] };
        }
      }
      if (fields.length || Object.keys(groups).length || Object.keys(annotations).length) {
        const beforeUpdate = snapshot ? Y.encodeStateAsUpdate(doc) : undefined;
        applyDurableLocalUpdate(candidate => {
          candidate.transact(() => {
            if (fields.length) applyCanvasImagePatch(candidate, patch, placementHistoryOrigin);
            for (const [id, group] of Object.entries(groups)) candidate.getMap('groupDefinitions').set(id, group);
            for (const [id, annotation] of Object.entries(annotations)) candidate.getMap('annotationRecords').set(id, annotation);
          }, placementHistoryOrigin);
        }, placementHistoryOrigin, beforeUpdate ? () => {
          const current = Y.encodeStateAsUpdate(doc);
          if (current.length !== beforeUpdate.length || current.some((byte, index) => byte !== beforeUpdate[index])) {
            throw new Error('恢复写盘期间协作文档已改变，请复核后重试');
          }
        } : undefined);
      }
      // Only this successful local restoration can establish optional-field
      // ownership; attach itself does not write those fields. Empty/default
      // values also retain their concrete head rather than claiming absence.
      restoredPlacementHeads.set(nextPlacementId, { previousPlacementId, assetVersionId,
        heads: Object.fromEntries(fields.map(field => [field, placementHead(nextPlacementId, field)])),
        ...(removalFingerprint !== undefined ? { removalFingerprint } : {}),
        ...(snapshot ? { annotationIds: { ...removal!.annotationIds },
          annotationHeads: Object.fromEntries(Object.keys(annotations).map(id => [id, annotationHead(id)])) } : {}),
      });
    },
    rebindPlacementHistory({ previousPlacementId, nextPlacementId, assetVersionId }): void {
      if (disconnected || !initialized || ((historyBusy || mediaRecovery !== null) && !mediaHistoryBusy) ||
          (status !== 'saved' && status !== 'pending') || socket.readyState !== WebSocket.OPEN) {
        throw new Error('协作文档不可接续摆放历史');
      }
      const placements = readCanvasDocument(doc).placements;
      const previous = Object.hasOwn(placements, previousPlacementId) ? placements[previousPlacementId] : undefined;
      const next = Object.hasOwn(placements, nextPlacementId) ? placements[nextPlacementId] : undefined;
      if (previousPlacementId === nextPlacementId || !previous?.deleted || !next || next.deleted ||
          previous.assetVersionId !== assetVersionId || next.assetVersionId !== assetVersionId) {
        throw new Error('摆放历史必须接续已确认的同版本新身份');
      }
      const existing = placementSuccessors.get(previousPlacementId);
      if (existing) {
        if (existing.placementId !== nextPlacementId || existing.assetVersionId !== assetVersionId) {
          throw new Error('摆放历史已接续其他身份');
        }
        return;
      }
      if (placementPredecessors.has(nextPlacementId) || placementSuccessors.has(nextPlacementId)) {
        throw new Error('摆放历史后继身份不唯一');
      }
      const restored = restoredPlacementHeads.get(nextPlacementId);
      if (restored && (restored.previousPlacementId !== previousPlacementId || restored.assetVersionId !== assetVersionId)) {
        throw new Error('摆放历史与字段恢复来源不一致');
      }
      retireOverwrittenPlacementFields();
      retireOverwrittenAnnotations();
      placementSuccessors.set(previousPlacementId, { placementId: nextPlacementId, assetVersionId });
      placementPredecessors.set(nextPlacementId, previousPlacementId);
      ownedPlacementHeads.set(nextPlacementId, {
        transforms: initialPlacementHead(nextPlacementId, 'transforms'),
        ...(restored?.previousPlacementId === previousPlacementId && restored.assetVersionId === assetVersionId ? restored.heads : {}),
      });
      for (const [oldId, id] of Object.entries(restored?.annotationIds ?? {})) {
        annotationSuccessors.set(oldId, { annotationId: id, sourceImageId: nextPlacementId });
        ownedAnnotationHeads.set(id, restored!.annotationHeads![id]);
      }
      // Evaluate old intents against the installed successor baseline now, not
      // only against the old identity. A later local edit must never revive a
      // field that lacked restoration ownership or was already overwritten.
      retireOverwrittenPlacementFields();
      retireOverwrittenAnnotations();
      convertPlacementHistory();
    },
    recordMediaHistory(entry): void {
      if (disconnected || !initialized || historyBusy || mediaRecovery !== null ||
          (status !== 'saved' && status !== 'pending') || socket.readyState !== WebSocket.OPEN) {
        throw new Error('协作文档不可记录媒体历史');
      }
      if (!entry || typeof entry.undo !== 'function' || typeof entry.redo !== 'function') {
        throw new Error('媒体历史操作不完整');
      }
      undoHistory.push({ kind: 'media', operation: { undo: entry.undo.bind(entry), redo: entry.redo.bind(entry) } });
      redoHistory.length = 0;
      undo.clear(false, true);
    },
    applyLocalChange(patch): void {
      if (disconnected || !initialized || historyBusy || mediaRecovery !== null ||
          (status !== 'saved' && status !== 'pending') || socket.readyState !== WebSocket.OPEN) {
        throw new Error('协作文档尚未连接，不能写入');
      }
      const patches = Array.isArray(patch) ? patch : [patch];
      if (patches.length === 0) return;
      let changes: PlacementHistoryChange[] | undefined;
      const applied = applyDurableLocalUpdate(candidate => {
        const before = readCanvasDocument(candidate);
        candidate.transact(() => {
          for (const item of patches) applyCanvasImagePatch(candidate, item, localOrigin);
        }, localOrigin);
        changes = placementHistoryChanges(before, readCanvasDocument(candidate));
      }, localOrigin, () => { stagedPlacementHistory = changes; }, () => { stagedPlacementHistory = undefined; });
      if (applied) rememberPlacementHeads(changes ?? []);
      if (placementSuccessors.size) convertPlacementHistory();
    },
    undoLocal: (): void | Promise<void> => runHistory('undo'),
    redoLocal: (): void | Promise<void> => runHistory('redo'),
    retryRecovered(): void {
      if (disconnected || !initialized || status !== 'recovery' ||
          socket.readyState !== WebSocket.OPEN) {
        throw new Error('当前没有可重试的未确认协作更新');
      }
      hasUncertainUpdates = false;
      automaticReplayCount = 0;
      status = 'pending';
      try {
        for (const update of pendingUpdates) socket.send(update.frame);
      } catch {
        status = 'unavailable';
      }
      publish();
    },
    exportRecoveryCopy() {
      if (recoveryCopy) return recoveryCopy;
      if (status !== 'rejected' && status !== 'recovery') {
        throw new Error('当前没有可导出的协作冲突副本');
      }
      return captureRecoveryCopy();
    },
    replaceSocket(nextSocket): void {
      if (disconnected || status !== 'unavailable') {
        throw new Error('协作文档连接尚未断开');
      }
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
      lastAckSequence = -1;
      replayPendingAfterConnect = true;
      status = 'connecting';
      attachSocket(nextSocket);
      publish();
    },
    disconnect,
  };
}
