import type { AdvanceResult, RuntimeStatus } from "./runtime.js";

/** Local simulation port; no room authority or network connection is paused. */
export interface BrowserRuntimePort {
  status(): RuntimeStatus;
  advance(elapsedMs: number): AdvanceResult;
  pause(): void;
  resume(): void;
}
export type BrowserSuspendReason = "hidden" | "blur" | "pagehide" | "stop" | "inactive" | "error" | "dispose";
export type BrowserLoopError = "invalid-frame-time" | "runtime-failed" | "frame-request-failed";
export interface BrowserLoopOptions {
  window: Pick<Window, "requestAnimationFrame" | "cancelAnimationFrame" | "addEventListener" | "removeEventListener">;
  document: Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;
  signal?: AbortSignal;
  /** Clear controls and offer explicit local resume or online reconnect. */
  onSuspend?(reason: BrowserSuspendReason): void;
  /** Bounded code only; provider details are never forwarded. No automatic retry. */
  onError?(code: BrowserLoopError): void;
}

/** Own a single frame request around the existing fixed-step runtime. Start/resume are explicit. */
export function createBrowserGameLoop(runtime: BrowserRuntimePort, options: BrowserLoopOptions) {
  const { window: win, document: doc, signal } = options;
  let disposed = false;
  let running = false;
  let generation = 0;
  let pending: number | null = null;
  let previous: number | null = null;
  let notifying = false;
  const notify = (fn: () => void) => {
    const before = notifying; notifying = true;
    try { fn(); } catch { /* Host notification cannot revive a loop. */ }
    finally { notifying = before; }
  };
  const stop = (reason: BrowserSuspendReason) => {
    const wasRunning = running;
    running = false; generation++; previous = null;
    if (pending !== null) { const id = pending; pending = null; notify(() => win.cancelAnimationFrame(id)); }
    notify(() => runtime.pause());
    if (wasRunning) notify(() => options.onSuspend?.(reason));
  };
  const fail = (code: BrowserLoopError) => { stop("error"); notify(() => options.onError?.(code)); };
  const schedule = (epoch: number) => {
    if (!running || disposed || generation !== epoch) return;
    try { pending = win.requestAnimationFrame((time) => frame(time, epoch)); }
    catch { fail("frame-request-failed"); }
  };
  const frame = (time: number, epoch: number) => {
    if (!running || disposed || generation !== epoch) return;
    pending = null;
    if (doc.hidden) { stop("hidden"); return; }
    if (runtime.status() !== "running") { stop("inactive"); return; }
    if (!Number.isFinite(time) || time < 0 || (previous !== null && (time < previous || time - previous > 86400000))) {
      fail("invalid-frame-time"); return;
    }
    const elapsed = previous === null ? 0 : time - previous;
    previous = time;
    try { runtime.advance(elapsed); } catch { fail("runtime-failed"); return; }
    if (runtime.status() !== "running") { if (generation === epoch) stop("inactive"); return; }
    schedule(epoch);
  };
  const hidden = () => { if (doc.hidden) stop("hidden"); };
  const blur = () => stop("blur");
  const pagehide = () => stop("pagehide");
  const dispose = () => {
    if (disposed) return;
    disposed = true; stop("dispose");
    doc.removeEventListener("visibilitychange", hidden);
    win.removeEventListener("blur", blur);
    win.removeEventListener("pagehide", pagehide);
    signal?.removeEventListener("abort", dispose);
  };
  doc.addEventListener("visibilitychange", hidden);
  win.addEventListener("blur", blur);
  win.addEventListener("pagehide", pagehide);
  signal?.addEventListener("abort", dispose);
  if (signal?.aborted) dispose();
  return {
    start() {
      if (disposed) throw new Error("disposed-loop");
      if (notifying) throw new Error("loop-busy");
      if (doc.hidden) throw new Error("hidden-document");
      if (running) return;
      running = true; previous = null;
      const epoch = ++generation;
      try { runtime.resume(); }
      catch (error) { running = false; generation++; throw error; }
      schedule(epoch);
    },
    stop: () => stop("stop"),
    dispose,
  };
}
