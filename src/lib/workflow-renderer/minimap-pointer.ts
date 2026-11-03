export interface MinimapClientPoint { readonly clientX: number; readonly clientY: number }
interface MinimapPointerInput extends MinimapClientPoint {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;
  readonly button: number;
}
interface MinimapClickInput extends MinimapClientPoint {
  readonly pointerId?: number;
  readonly pointerType?: string;
  readonly button: number;
  readonly detail: number;
}
interface PointerOwner { readonly owner: EventTarget; readonly pointerId: number; readonly pointerType: string }
interface ReleasedPointer extends PointerOwner { readonly point: MinimapClientPoint }
export interface MinimapPointerTracker {
  begin(owner: EventTarget, input: MinimapPointerInput): void;
  end(owner: EventTarget, input: MinimapPointerInput): void;
  captureLost(): void;
  clear(): void;
  consume(owner: EventTarget, input: MinimapClickInput): MinimapClientPoint | null;
}
function finitePoint(input: MinimapClientPoint): boolean {
  return Number.isFinite(input.clientX) && Number.isFinite(input.clientY);
}
function primaryPointer(input: MinimapPointerInput): boolean {
  return input.isPrimary === true && input.button === 0 && Number.isInteger(input.pointerId)
    && input.pointerId >= 0 && ['mouse', 'touch', 'pen'].includes(input.pointerType) && finitePoint(input);
}

/** Preserve pointer fractions until the corresponding click, which may round them. */
export function createMinimapPointerTracker(): MinimapPointerTracker {
  let armed: PointerOwner | null = null;
  let released: ReleasedPointer | null = null;
  const clear = (): void => { armed = null; released = null; };
  return {
    clear,
    begin(owner, input): void {
      clear();
      if (primaryPointer(input)) armed = { owner, pointerId: input.pointerId, pointerType: input.pointerType };
    },
    end(owner, input): void {
      const previous = armed;
      clear();
      if (previous?.owner === owner && previous.pointerId === input.pointerId
        && previous.pointerType === input.pointerType && primaryPointer(input)) {
        released = { ...previous, point: { clientX: input.clientX, clientY: input.clientY } };
      }
    },
    captureLost(): void {
      // Implicit touch capture normally ends after pointerup, before click.
      // Only an unfinished gesture is interrupted by losing capture.
      if (armed) clear();
    },
    consume(owner, input): MinimapClientPoint | null {
      const previous = released;
      clear();
      if (!finitePoint(input)) return null;
      if (previous?.owner === owner && input.button === 0
        && previous.pointerId === input.pointerId && previous.pointerType === input.pointerType) return previous.point;
      // Preserve legacy/non-pointer click behavior; never reuse an old receipt.
      return { clientX: input.clientX, clientY: input.clientY };
    },
  };
}
