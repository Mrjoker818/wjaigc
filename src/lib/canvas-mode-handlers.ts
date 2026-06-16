/**
 * Canvas interaction mode handlers - Strategy pattern for dispatching events
 * 
 * Instead of deep if/else chains in the main event handlers, each interaction
 * mode provides its own handlers. The main handler just dispatches to the
 * current mode based on priority:
 * 
 * 1. editMode (erase/mask/crop/expand/upscale/img2img) — highest priority
 * 2. annotationMode (chat canvas brush/pin/region)
 * 3. langEditMode (selecting image for language edit)
 * 4. normalMode (select/pan/drag/box-select/resize) — default
 */

export interface CanvasEventContext {
  // Screen ↔ Canvas coordinate conversion
  screenToCanvas: (clientX: number, clientY: number) => { x: number; y: number };
  // Current viewport state
  zoom: number;
  viewOffset: { x: number; y: number };
  // Canvas container ref
  canvasRef: React.RefObject<HTMLDivElement | null>;
}

export interface ModeHandlerResult {
  /** Whether the event was fully handled (stops further processing) */
  handled: boolean;
}

export interface ModeHandler {
  /** Mouse down handler. Return { handled: true } to stop propagation */
  onMouseDown?: (e: React.MouseEvent, ctx: CanvasEventContext) => ModeHandlerResult | void;
  /** Mouse move handler */
  onMouseMove?: (e: React.MouseEvent, ctx: CanvasEventContext) => ModeHandlerResult | void;
  /** Mouse up handler */
  onMouseUp?: (e: React.MouseEvent, ctx: CanvasEventContext) => ModeHandlerResult | void;
  /** Key down handler */
  onKeyDown?: (e: React.KeyboardEvent, ctx: CanvasEventContext) => ModeHandlerResult | void;
  /** Cursor CSS for this mode */
  cursor?: string;
}

/**
 * Resolves the current interaction mode based on state.
 * Returns a string key for logging/debugging and the handler to dispatch to.
 */
export function resolveInteractionMode(state: {
  editMode: string;
  annotationMode: boolean;
  langEditMode: string;
  isSpacePressed: boolean;
  isPanning: boolean;
  activeTool: string;
}): 'edit' | 'annotation' | 'langEdit' | 'pan' | 'normal' {
  if (state.editMode !== 'none') return 'edit';
  if (state.annotationMode) return 'annotation';
  if (state.langEditMode !== 'none') return 'langEdit';
  if (state.isPanning || state.isSpacePressed) return 'pan';
  return 'normal';
}

/**
 * Context passed to mode handlers, providing access to canvas state and helpers.
 * This is an interface that the infinite-canvas component fills in at runtime.
 */
export interface CanvasContext {
  editMode: string;
  annotationMode: boolean;
  langEditMode: string;
  isPanning: boolean;
  isSpacePressed: boolean;
  zoom: number;
  viewOffsetX: number;
  viewOffsetY: number;
  containerWidth: number;
  containerHeight: number;
  selectedIds: Set<string>;
  images: Array<{ id: string; x: number; y: number; width: number; height: number }>;
  hitTestImage: (canvasX: number, canvasY: number) => string | null;
  screenToCanvas: (screenX: number, screenY: number) => { x: number; y: number };
  setEditMode: (mode: string) => void;
  setSelectedIds: (ids: Set<string>) => void;
}

/** Registry of edit mode handlers */
const editModeHandler: Record<string, ModeHandler> = {};

/**
 * Register a handler for a specific edit mode.
 */
export function registerModeHandler(mode: string, handler: ModeHandler): void {
  editModeHandler[mode] = handler;
}

/**
 * Get the handler for the current interaction mode.
 * Returns undefined if no handler is registered for the current mode.
 */
export function getModeHandler(mode: string): ModeHandler | undefined {
  return editModeHandler[mode];
}

/**
 * Check if an edit mode should intercept the normal mouse event flow.
 * Returns true if the current edit mode has a registered handler that
 * wants to handle the event instead of the normal flow.
 */
export function shouldEditModeIntercept(editMode: string): boolean {
  return editMode !== 'none' && editMode in editModeHandler;
}
