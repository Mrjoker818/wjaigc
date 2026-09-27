'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';

import {
  applyCanvasImagePatch, createCanvasDocument, readCanvasDocument,
  tombstoneCanvasAnnotation, tombstoneCanvasGroup,
  type CanvasDocumentProjection, type CanvasImagePatch, type CanvasPlacement,
} from './canvas-document';
import {
  projectCanvasDocumentMetadata, projectDocumentPlacementsOntoImages,
  toCanvasDocumentAnnotationRecords, toCanvasDocumentGroupRecords,
} from './canvas-document-image-bridge';
import type { CanvasImage, ImageGroupData } from '@/lib/user-types';
import type { CanvasAnnotationV2 } from '@/features/annotations/annotation-types';

export type CanvasDocumentStatus = 'connecting' | 'saved' | 'pending' | 'unavailable' | 'rejected' | 'recovery';

export interface PendingDocumentUpdateStore {
  load(): Array<{ id: string; frame: Uint8Array; rejected?: boolean; intent?: Record<string, unknown> }>;
  append(frame: Uint8Array, intent?: Record<string, unknown>): string;
  remove(id: string): void;
  markRejected?(id: string): void;
}

export interface CanvasDocumentSession {
  readonly images: Record<string, CanvasPlacement>;
  readonly projection: CanvasDocumentProjection;
  readonly status: CanvasDocumentStatus;
  applyLocalChange(patch: CanvasImagePatch | CanvasImagePatch[]): void;
  applyLocalGroups(groups: Record<string, ImageGroupData>, baseline?: Record<string, ImageGroupData>): void;
  applyLocalAnnotations(annotations: Record<string, CanvasAnnotationV2>, baseline?: Record<string, CanvasAnnotationV2>): void;
  undoLocal(): void;
  redoLocal(): void;
  retryRecovered(): void;
  exportRecoveryCopy(): {
    projection: CanvasDocumentProjection;
    pendingFrames: Array<{ frameBase64: string; rejected: boolean; intent?: Record<string, unknown> }>;
  };
  replaceSocket(socket: WebSocket): void;
  disconnect(): void;
}

export interface CollaborativeCanvasState {
  projectId: string | null;
  authority: 'unknown' | 'legacy' | 'document';
  status: CanvasDocumentStatus | 'checking' | 'disabled' | 'read-only';
  images: Record<string, CanvasPlacement>;
  canvasImages: CanvasImage[];
  groups: ImageGroupData[];
  annotations: CanvasAnnotationV2[];
}

export interface CollaborativeCanvas extends CollaborativeCanvasState {
  recoveryRetryReady: boolean;
  applyLocalChange(patch: CanvasImagePatch | CanvasImagePatch[]): void;
  applyLocalGroups(groups: ImageGroupData[], renderedBaseline?: ImageGroupData[]): void;
  applyLocalAnnotations(annotations: CanvasAnnotationV2[], renderedBaseline?: CanvasAnnotationV2[]): void;
  undoLocal(): void;
  redoLocal(): void;
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
  const [state, setState] = useState<CollaborativeCanvasState>(INITIAL_STATE);
  const sessionRef = useRef<CanvasDocumentSession | null>(null);
  const recoveryRef = useRef<ReturnType<CanvasDocumentSession['exportRecoveryCopy']> | null>(null);
  const canvasMediaRef = useRef<CanvasImage[]>([]);
  const mediaCompleteRef = useRef(false);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
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
    sessionRef.current = null;
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
            const projected = projectDocumentPlacementsOntoImages(canvasMediaRef.current, images);
            mediaCompleteRef.current = projected.unresolvedPlacementIds.length === 0;
            let metadata = { groups: [] as ImageGroupData[], annotations: [] as CanvasAnnotationV2[] };
            try {
              metadata = projectCanvasDocumentMetadata(projection, canvasMediaRef.current);
            } catch {
              mediaCompleteRef.current = false;
            }
            setState({
              projectId, authority: 'document',
              status: mediaCompleteRef.current || status === 'rejected' || status === 'recovery'
                ? status : 'unavailable',
              images, canvasImages: projected.images, ...metadata,
            });
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
      if (!legacyAuthority || !active || stopped) return;
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
        const response = await fetch(
          `/api/collaboration/document-project?projectId=${encodeURIComponent(projectId)}`,
          { credentials: 'include', cache: 'no-store', signal: controller.signal },
        );
        const payload = asRecord(await response.json());
        if (!active || controller.signal.aborted) return;
        if (response.status === 409 && payload?.code === 'DOCUMENT_PROJECT_NOT_ENABLED') {
          legacyAuthority = true;
          setState({ ...INITIAL_STATE, projectId, authority: 'legacy', status: 'disabled' });
          return;
        }
        legacyAuthority = false;
        if (response.status === 403 && payload?.code === 'DOCUMENT_FORBIDDEN') {
          setState({ ...INITIAL_STATE, projectId, status: 'unavailable' });
          scheduleInspectionRetry();
          return;
        }
        if (!response.ok || payload?.success !== true || payload.projectId !== projectId) {
          setState({ ...INITIAL_STATE, projectId, status: 'unavailable' });
          return;
        }
        const projection = asRecord(payload.projection);
        const images = asRecord(projection?.placements) as Record<string, CanvasPlacement> | null;
        if (!images || !Array.isArray(payload.canvasImages)) {
          setState({ ...INITIAL_STATE, projectId, status: 'unavailable' });
          return;
        }
        canvasMediaRef.current = payload.canvasImages as CanvasImage[];
        const projected = projectDocumentPlacementsOntoImages(canvasMediaRef.current, images);
        mediaCompleteRef.current = projected.unresolvedPlacementIds.length === 0;
        const metadata = projectCanvasDocumentMetadata(
          projection as unknown as CanvasDocumentProjection, canvasMediaRef.current,
        );
        if (projected.unresolvedPlacementIds.length > 0) {
          setState({ projectId, authority: 'document', status: 'unavailable',
            images, canvasImages: projected.images, ...metadata });
          return;
        }
        if (payload.readOnly === true) {
          setState({ projectId, authority: 'document', status: 'read-only',
            images, canvasImages: projected.images, ...metadata });
          return;
        }
        setState({ projectId, authority: 'document', status: 'connecting',
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
  }, [projectId, actorId]);

  const applyLocalChange = useCallback((patch: CanvasImagePatch | CanvasImagePatch[]): void => {
    if (!mediaCompleteRef.current) throw new Error('协作媒体投影不完整，不能写入');
    if (!sessionRef.current) throw new Error('协作文档不可写');
    sessionRef.current.applyLocalChange(patch);
  }, []);
  const applyLocalGroups = useCallback((
    groups: ImageGroupData[], renderedBaseline?: ImageGroupData[],
  ): void => {
    if (!mediaCompleteRef.current || !sessionRef.current) throw new Error('协作文档不可写');
    sessionRef.current.applyLocalGroups(
      toCanvasDocumentGroupRecords(groups, canvasMediaRef.current),
      renderedBaseline
        ? toCanvasDocumentGroupRecords(renderedBaseline, canvasMediaRef.current) : undefined,
    );
  }, []);
  const applyLocalAnnotations = useCallback((
    annotations: CanvasAnnotationV2[], renderedBaseline?: CanvasAnnotationV2[],
  ): void => {
    if (!mediaCompleteRef.current || !sessionRef.current) throw new Error('协作文档不可写');
    sessionRef.current.applyLocalAnnotations(
      toCanvasDocumentAnnotationRecords(annotations, canvasMediaRef.current),
      renderedBaseline
        ? toCanvasDocumentAnnotationRecords(renderedBaseline, canvasMediaRef.current) : undefined,
    );
  }, []);
  const undoLocal = useCallback((): void => {
    if (!mediaCompleteRef.current) throw new Error('协作媒体投影不完整，不能撤销');
    if (!sessionRef.current) throw new Error('协作文档不可撤销');
    sessionRef.current.undoLocal();
  }, []);
  const redoLocal = useCallback((): void => {
    if (!mediaCompleteRef.current) throw new Error('协作媒体投影不完整，不能重做');
    if (!sessionRef.current) throw new Error('协作文档不可重做');
    sessionRef.current.redoLocal();
  }, []);
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
    undoLocal, redoLocal, retryRecovered, exportRecoveryCopy, disconnect };
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
  const createUndoManager = (target: Y.Doc): Y.UndoManager => new Y.UndoManager([
    target.getMap('assetVersions'), target.getMap('transforms'),
    target.getMap('groups'), target.getMap('annotations'), target.getMap('tombstones'),
    target.getMap('groupDefinitions'), target.getMap('annotationRecords'),
    target.getMap('groupTombstones'), target.getMap('annotationTombstones'),
  ], { trackedOrigins: new Set([localOrigin]), captureTimeout: 0 });
  const undo = createUndoManager(doc);
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
    onStateChange?.(status, projection.placements, projection);
  };
  const onUpdate = (update: Uint8Array, origin: unknown): void => {
    if (disconnected || !initialized) return;
    if (origin === localOrigin || origin === metadataTombstoneOrigin || origin === undo) {
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
    }
    publish();
  };
  doc.on('update', onUpdate);

  const applyDurableLocalUpdate = (
    write: (candidate: Y.Doc) => void,
    origin: unknown,
    beforeApply?: () => void,
    afterApply?: () => void,
    resolveOrigin?: () => unknown,
  ): boolean => {
    const stateVector = Y.encodeStateVector(doc);
    const before = readCanvasDocument(doc);
    // Undo stacks reference deleted structs; the replay clone must retain them.
    const candidate = new Y.Doc({ gc: false });
    let update: Uint8Array;
    let intent: Record<string, unknown>;
    try {
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(doc), 'local-candidate');
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
    try {
      beforeApply?.();
      Y.applyUpdate(doc, update, resolveOrigin?.() ?? origin);
      if (stagedLocalUpdate) {
        stagedLocalUpdate = null;
        if (id) pendingStore?.remove(id);
      }
    } catch (error) {
      stagedLocalUpdate = null;
      status = 'unavailable';
      publish();
      throw error;
    } finally {
      afterApply?.();
    }
    return true;
  };

  const applyDurableHistory = (direction: 'undo' | 'redo'): void => {
    let nextUndoStack = undo.undoStack;
    let nextRedoStack = undo.redoStack;
    let convertedMetadataCreation = false;
    const applied = applyDurableLocalUpdate(candidate => {
      // Preview the history operation in a separate doc. An undo of a newly
      // created metadata record removes its Y.Map key, which the server forbids;
      // the durable update must instead tombstone that record in the original.
      const preview = new Y.Doc({ gc: false });
      Y.applyUpdate(preview, Y.encodeStateAsUpdate(candidate), 'history-preview');
      const candidateUndo = createUndoManager(preview);
      try {
        candidateUndo.undoStack = [...undo.undoStack];
        candidateUndo.redoStack = [...undo.redoStack];
        if (direction === 'undo') candidateUndo.undo();
        else candidateUndo.redo();
        nextUndoStack = candidateUndo.undoStack;
        nextRedoStack = candidateUndo.redoStack;
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
          Y.applyUpdate(candidate, Y.encodeStateAsUpdate(preview, Y.encodeStateVector(candidate)), undo);
        }
      } finally {
        candidateUndo.destroy();
        preview.destroy();
      }
    }, undo, () => {
      if (convertedMetadataCreation) {
        undo.undoStack = nextUndoStack;
        undo.redoStack = nextRedoStack;
      } else if (direction === 'undo') {
        undo.undoStack = nextUndoStack;
        undo.undoing = true;
      } else {
        undo.redoStack = nextRedoStack;
        undo.redoing = true;
      }
    }, () => {
      undo.undoing = false;
      undo.redoing = false;
    }, () => convertedMetadataCreation ? metadataTombstoneOrigin : undo);
    if (!applied) {
      undo.undoStack = nextUndoStack;
      undo.redoStack = nextRedoStack;
    }
  };

  const applyMetadata = (
    kind: 'groupDefinitions' | 'annotationRecords',
    desired: Record<string, ImageGroupData> | Record<string, CanvasAnnotationV2>,
    renderedBaseline?: Record<string, ImageGroupData> | Record<string, CanvasAnnotationV2>,
  ): void => {
    if (disconnected || !initialized ||
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
    const write = (target: Y.Doc): void => {
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
    };
    applyDurableLocalUpdate(write, origin);
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
        && sequence >= lastAckSequence && pendingUpdates.length > 0) {
      lastAckSequence = sequence;
      const acknowledged = pendingUpdates.shift();
      if (acknowledged?.id) {
        try { pendingStore?.remove(acknowledged.id); } catch {
          // A confirmed server update is safe to replay if local cleanup fails.
        }
      }
      status = pendingUpdates.length > 0 ? 'pending' : 'saved';
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
    get images() { return initialized ? readCanvasDocument(doc).placements : {}; },
    get projection() { return initialized ? readCanvasDocument(doc) : { placements: {} }; },
    get status() { return status; },
    applyLocalGroups(groups, baseline): void { applyMetadata('groupDefinitions', groups, baseline); },
    applyLocalAnnotations(annotations, baseline): void { applyMetadata('annotationRecords', annotations, baseline); },
    applyLocalChange(patch): void {
      if (disconnected || !initialized ||
          (status !== 'saved' && status !== 'pending') || socket.readyState !== WebSocket.OPEN) {
        throw new Error('协作文档尚未连接，不能写入');
      }
      const patches = Array.isArray(patch) ? patch : [patch];
      if (patches.length === 0) return;
      applyDurableLocalUpdate(candidate => {
        candidate.transact(() => {
          for (const item of patches) applyCanvasImagePatch(candidate, item, localOrigin);
        }, localOrigin);
      }, localOrigin);
    },
    undoLocal(): void {
      if (disconnected || !initialized ||
          (status !== 'saved' && status !== 'pending') || socket.readyState !== WebSocket.OPEN) {
        throw new Error('协作文档尚未连接，不能撤销');
      }
      applyDurableHistory('undo');
    },
    redoLocal(): void {
      if (disconnected || !initialized ||
          (status !== 'saved' && status !== 'pending') || socket.readyState !== WebSocket.OPEN) {
        throw new Error('协作文档尚未连接，不能重做');
      }
      applyDurableHistory('redo');
    },
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
      lastSequence = -1;
      lastAckSequence = -1;
      replayPendingAfterConnect = true;
      status = 'connecting';
      attachSocket(nextSocket);
      publish();
    },
    disconnect,
  };
}
