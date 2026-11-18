/** Generic intentions; each game maps these to its own tick input and axes. */
export interface BrowserControlSample {
  pointer: { x: number; y: number } | null;
  direction: { x: number; y: number };
  buttons: number;
}
const clamp = (value: number) => Math.max(-1, Math.min(1, value));
const keys = new Set(["ArrowLeft", "KeyA", "ArrowRight", "KeyD", "ArrowUp", "KeyW", "ArrowDown", "KeyS", "Space"]);

/** Bind one focusable aiming surface. Hosts supply labelled semantic buttons and touch-action. */
export function createBrowserGameControls(surface: HTMLElement) {
  const doc = surface.ownerDocument;
  const win = doc.defaultView;
  if (!win) throw new Error("browser-unavailable");
  let disposed = false;
  let pointerId: number | null = null;
  let position: BrowserControlSample["pointer"] = null;
  let pulses = 0;
  let nudge = { x: 0, y: 0 };
  const held = new Set<string>();
  const listeners: (() => void)[] = [];
  const on = (target: EventTarget, name: string, listener: EventListener) => {
    target.addEventListener(name, listener);
    listeners.push(() => target.removeEventListener(name, listener));
  };
  const release = () => {
    const id = pointerId; pointerId = null; position = null;
    if (id !== null) {
      // Capture may already be gone after cancellation or element removal.
      try { if (surface.hasPointerCapture(id)) surface.releasePointerCapture(id); } catch { /* cleared locally */ }
    }
  };
  const clear = () => { release(); held.clear(); pulses = 0; nudge = { x: 0, y: 0 }; };
  const readPosition = (event: PointerEvent): BrowserControlSample["pointer"] => {
    const rect = surface.getBoundingClientRect();
    if (![event.clientX, event.clientY, rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)
      || rect.width <= 0 || rect.height <= 0) return null;
    return { x: clamp((event.clientX - rect.left) / rect.width * 2 - 1), y: clamp(1 - (event.clientY - rect.top) / rect.height * 2) };
  };
  on(surface, "pointerdown", (raw) => {
    const event = raw as PointerEvent;
    if (disposed || doc.hidden || event.defaultPrevented || event.target !== surface || pointerId !== null
      || event.button !== 0 || !event.isPrimary || !Number.isSafeInteger(event.pointerId)) return;
    const next = readPosition(event);
    if (!next) return;
    try { surface.setPointerCapture(event.pointerId); } catch { return; }
    pointerId = event.pointerId; position = next;
    surface.focus({ preventScroll: true }); event.preventDefault();
  });
  on(surface, "pointermove", (raw) => {
    const event = raw as PointerEvent;
    if (event.pointerId !== pointerId) return;
    const next = readPosition(event);
    if (!next || doc.hidden) { release(); return; }
    position = next; event.preventDefault();
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
    on(surface, name, (raw) => { if ((raw as PointerEvent).pointerId === pointerId) release(); });
  }
  on(surface, "keydown", (raw) => {
    const event = raw as KeyboardEvent;
    if (disposed || doc.hidden || event.target !== surface || doc.activeElement !== surface || event.defaultPrevented
      || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || !keys.has(event.code)) return;
    if (event.code === "Space" && !event.repeat && !held.has(event.code)) pulses |= 1;
    held.add(event.code); event.preventDefault();
  });
  on(win, "keyup", (raw) => { held.delete((raw as KeyboardEvent).code); });
  on(surface, "focusout", clear);
  on(win, "blur", clear);
  on(doc, "visibilitychange", () => { if (doc.hidden) clear(); });
  const down = (first: string, second: string) => Number(held.has(first) || held.has(second));
  return {
    /** Consume coalesced semantic activations once per simulation tick; held input remains sampled. */
    sample(): BrowserControlSample {
      if (doc.hidden) clear();
      const sample = { pointer: position ? { ...position } : null,
        direction: { x: clamp(down("ArrowRight", "KeyD") - down("ArrowLeft", "KeyA") + nudge.x),
          y: clamp(down("ArrowUp", "KeyW") - down("ArrowDown", "KeyS") + nudge.y) },
        buttons: Number(held.has("Space")) | pulses };
      pulses = 0; nudge = { x: 0, y: 0 };
      return sample;
    },
    /** Semantic button click, including keyboard/switch activation. No unbounded event queue. */
    pulse(buttons: number) {
      if (!Number.isSafeInteger(buttons) || buttons < 1 || buttons > 65535) throw new RangeError("invalid-buttons");
      if (!disposed && !doc.hidden) pulses |= buttons;
    },
    /** One-tick alternative to dragging; each axis is -1, 0 or 1. */
    nudge(x: number, y: number) {
      if (![x, y].every((value) => Number.isInteger(value) && Math.abs(value) <= 1)) throw new RangeError("invalid-direction");
      if (!disposed && !doc.hidden) nudge = { x, y };
    },
    clear,
    dispose() {
      if (disposed) return;
      disposed = true; clear();
      for (const remove of listeners) remove();
      listeners.length = 0;
    },
  };
}
