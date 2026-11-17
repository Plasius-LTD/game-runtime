import { describe, expect, it, vi } from "vitest";
import { createBrowserGameLoop } from "../src/browser.js";
import { createGameRuntime, type RuntimePorts } from "../src/runtime.js";
import { BrowserDocument, dispatch } from "./browser-fixtures.js";
function make(ports: RuntimePorts<number> = {}, extra: Record<string, unknown> = {}) {
  const doc = new BrowserDocument(); const win = doc.defaultView;
  const runtime = createGameRuntime({ gameId: "test", rulesVersion: "1.0.0", contentVersion: "1.0.0", initialState: () => 0, parseState: (value) => Number(value), step: (state) => state + 1 }, { seed: 1, players: ["one"], ports });
  const onSuspend = vi.fn(); const onError = vi.fn();
  const loop = createBrowserGameLoop(runtime, { window: win as unknown as Window, document: doc as unknown as Document, onSuspend, onError, ...extra });
  return { runtime, loop, doc, win, onSuspend, onError };
}
describe("single owned browser frame loop", () => {
  it("starts explicitly, samples high-refresh time and delegates bounded catch-up", () => {
    const { runtime, loop, win } = make(); expect(win.frames.size).toBe(0);
    loop.start(); loop.start(); expect(win.frames.size).toBe(1);
    win.fire(100); win.fire(108); expect(runtime.snapshot().tick).toBe(0);
    win.fire(117); expect(runtime.snapshot().tick).toBe(1);
    win.fire(1117); expect(runtime.snapshot().tick).toBe(6); expect(win.frames.size).toBe(1);
    loop.dispose(); expect(win.frames.size).toBe(0);
  });
  it.each(["hidden", "blur", "pagehide", "stop"])("pauses on %s and never counts hidden time or resumes automatically", (reason) => {
    const { runtime, loop, doc, win, onSuspend } = make(); loop.start(); win.fire(0); win.fire(17);
    const old = [...win.frames.values()][0]!;
    if (reason === "hidden") { doc.hidden = true; dispatch(doc, "visibilitychange"); }
    else if (reason === "stop") loop.stop(); else dispatch(win, reason);
    expect(runtime.status()).toBe("paused"); expect(win.frames.size).toBe(0); expect(onSuspend).toHaveBeenCalledTimes(1);
    old(99999); expect(runtime.snapshot().tick).toBe(1); expect(win.frames.size).toBe(0);
    doc.hidden = false; dispatch(doc, "visibilitychange"); expect(win.frames.size).toBe(0);
    loop.start(); win.fire(99999); expect(runtime.snapshot().tick).toBe(1); win.fire(100016); expect(runtime.snapshot().tick).toBe(2);
  });
  it("cannot restart a disposed/aborted loop and removes listeners", () => {
    const controller = new AbortController(); const { loop, win, runtime } = make({}, { signal: controller.signal });
    loop.start(); controller.abort(); expect(win.frames.size).toBe(0); expect(runtime.status()).toBe("paused");
    loop.dispose(); expect(() => loop.start()).toThrow("disposed-loop");
    const pre = new AbortController(); pre.abort(); const second = make({}, { signal: pre.signal });
    expect(() => second.loop.start()).toThrow("disposed-loop");
  });
  it("rejects a hidden start, resets its time after stop and preserves external runtime ownership", () => {
    const { loop, doc, runtime, win } = make(); doc.hidden = true; expect(() => loop.start()).toThrow("hidden-document");
    doc.hidden = false; loop.start(); loop.stop(); loop.start(); win.fire(1000); expect(runtime.snapshot().tick).toBe(0);
    loop.dispose(); expect(runtime.status()).toBe("paused");
    runtime.resume(); expect(runtime.status()).toBe("running");
  });
  it.each([NaN, -1, Infinity, 86400011])("stops on invalid/backward/oversized frame time %s", (time) => {
    const { loop, win, onError, runtime } = make(); loop.start(); win.fire(10); win.fire(time);
    expect(win.frames.size).toBe(0); expect(runtime.snapshot().tick).toBe(0); expect(onError).toHaveBeenCalledWith("invalid-frame-time");
  });
  it("stops on runtime and scheduling failures without exposing error details or retrying", () => {
    const broken = make({ sampleInput() { throw new Error("private"); } }); broken.loop.start(); broken.win.fire(0); broken.win.fire(17);
    expect(broken.win.frames.size).toBe(0); expect(broken.onError).toHaveBeenCalledWith("runtime-failed");
    const schedule = make(); vi.spyOn(schedule.win, "requestAnimationFrame").mockImplementation(() => { throw new Error("private"); });
    schedule.loop.start(); expect(schedule.onError).toHaveBeenCalledWith("frame-request-failed"); expect(schedule.runtime.status()).toBe("paused");
  });
  it("does not reschedule after a render hook stops/restarts the loop", () => {
    let restarted = false;
    const fixture = make({ render(snapshot) { if (snapshot.tick > 0 && !restarted) { restarted = true; fixture.loop.stop(); fixture.loop.start(); } } });
    fixture.loop.start(); fixture.win.fire(0); fixture.win.fire(17);
    expect(fixture.win.frames.size).toBe(1); fixture.win.fire(10000); expect(fixture.runtime.snapshot().tick).toBe(1);
  });
  it("stops when another owner pauses or disposes the runtime", () => {
    for (const operation of ["pause", "dispose"] as const) {
      const { loop, runtime, win } = make(); loop.start(); win.fire(0); runtime[operation](); win.fire(17); expect(win.frames.size).toBe(0);
    }
  });
  it("bounds notification reentry and recursive starts from lifecycle callbacks", () => {
    const fixture = make({ lifecycle(status) { if (status === "running") fixture.loop.start(); } }, {
      onSuspend: () => fixture.loop.start(), onError: () => fixture.loop.start(),
    });
    fixture.runtime.pause(); fixture.loop.start(); expect(fixture.win.frames.size).toBe(1);
    fixture.win.fire(NaN); expect(fixture.win.frames.size).toBe(0); expect(fixture.runtime.status()).toBe("paused");
  });
  it("cleans every listener and leaves failed starts inactive", () => {
    const fixture = make();
    const removeDoc = vi.spyOn(fixture.doc, "removeEventListener"); const removeWin = vi.spyOn(fixture.win, "removeEventListener");
    fixture.runtime.dispose(); expect(() => fixture.loop.start()).toThrow("inactive-runtime"); expect(fixture.win.frames.size).toBe(0);
    fixture.loop.dispose(); expect(removeDoc).toHaveBeenCalledTimes(1); expect(removeWin).toHaveBeenCalledTimes(2);
  });
});
