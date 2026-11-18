export class BrowserWindow extends EventTarget {
  nextId = 0;
  frames = new Map<number, FrameRequestCallback>();
  requestAnimationFrame = (fn: FrameRequestCallback) => { const id = this.nextId++; this.frames.set(id, fn); return id; };
  cancelAnimationFrame = (id: number) => { this.frames.delete(id); };
  fire(time: number) { const entries = [...this.frames]; this.frames.clear(); for (const [, fn] of entries) fn(time); }
}
export class BrowserDocument extends EventTarget {
  hidden = false;
  activeElement: unknown = null;
  defaultView = new BrowserWindow();
}
export class Surface extends EventTarget {
  ownerDocument = new BrowserDocument();
  captured = new Set<number>();
  rect = { left: 10, top: 20, width: 200, height: 100 };
  getBoundingClientRect() { return this.rect; }
  setPointerCapture(id: number) { this.captured.add(id); }
  hasPointerCapture(id: number) { return this.captured.has(id); }
  releasePointerCapture(id: number) { this.captured.delete(id); }
  focus() { this.ownerDocument.activeElement = this; }
}
export function dispatch(target: EventTarget, type: string, fields: Record<string, unknown> = {}) {
  const event = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries(fields)) Object.defineProperty(event, key, { value });
  target.dispatchEvent(event); return event;
}
export const pointer = (id = 1, x = 60, y = 45) => ({ pointerId: id, clientX: x, clientY: y, button: 0, isPrimary: true });
