import { describe, expect, it, vi } from "vitest";
import { createBrowserGameControls } from "../src/browser.js";
import { dispatch, pointer, Surface } from "./browser-fixtures.js";
const make = () => { const surface = new Surface(); surface.focus(); const controls = createBrowserGameControls(surface as unknown as HTMLElement); return { surface, controls, doc: surface.ownerDocument, win: surface.ownerDocument.defaultView }; };
const neutral = { pointer: null, direction: { x: 0, y: 0 }, buttons: 0 };

describe("touch-first controls", () => {
  it.each(["touch", "mouse", "pen"])("maps %s into the same bounded target plane", (pointerType) => {
    const { surface, controls } = make();
    expect(dispatch(surface, "pointerdown", { ...pointer(), pointerType }).defaultPrevented).toBe(true);
    expect(surface.captured.has(1)).toBe(true);
    expect(controls.sample().pointer).toEqual({ x: -0.5, y: 0.5 });
    dispatch(surface, "pointermove", pointer(1, 900, -5));
    expect(controls.sample().pointer).toEqual({ x: 1, y: 1 });
    controls.dispose(); expect(surface.captured.size).toBe(0);
  });
  it.each(["pointerup", "pointercancel", "lostpointercapture"])("clears ownership on %s and ignores a second pointer", (reason) => {
    const { surface, controls } = make();
    dispatch(surface, "pointerdown", pointer());
    dispatch(surface, "pointerdown", pointer(2, 210, 120));
    dispatch(surface, "pointermove", pointer(2, 210, 120));
    dispatch(surface, reason, pointer(2));
    expect(controls.sample().pointer).toEqual({ x: -0.5, y: 0.5 });
    dispatch(surface, reason, pointer());
    expect(controls.sample()).toEqual(neutral);
    dispatch(surface, "pointermove", pointer()); expect(controls.sample()).toEqual(neutral);
  });
  it("rejects secondary/child/invalid events and fails closed on capture failure", () => {
    const { surface, controls } = make();
    for (const extra of [{ button: 2 }, { isPrimary: false }, { target: {} }, { clientX: NaN }, { pointerId: NaN }]) {
      expect(dispatch(surface, "pointerdown", { ...pointer(), ...extra }).defaultPrevented).toBe(false);
      expect(controls.sample()).toEqual(neutral);
    }
    surface.rect.width = 0; dispatch(surface, "pointerdown", pointer()); expect(controls.sample()).toEqual(neutral);
    surface.rect.width = 200;
    vi.spyOn(surface, "setPointerCapture").mockImplementation(() => { throw new Error(); });
    dispatch(surface, "pointerdown", pointer()); expect(controls.sample()).toEqual(neutral);
  });
  it("maps focused arrow/WASD keys, releases aliases independently and ignores repeats", () => {
    const { surface, controls, win } = make();
    dispatch(surface, "keydown", { code: "KeyD" }); dispatch(surface, "keydown", { code: "ArrowRight" });
    dispatch(surface, "keydown", { code: "KeyD", repeat: true }); dispatch(surface, "keydown", { code: "KeyW" });
    dispatch(surface, "keydown", { code: "Space" });
    expect(controls.sample()).toEqual({ pointer: null, direction: { x: 1, y: 1 }, buttons: 1 });
    dispatch(win, "keyup", { code: "KeyD" }); expect(controls.sample().direction.x).toBe(1);
    dispatch(surface, "keydown", { code: "KeyA" }); expect(controls.sample().direction.x).toBe(0);
    dispatch(win, "keyup", { code: "ArrowRight" }); expect(controls.sample().direction.x).toBe(-1);
    dispatch(surface, "keydown", { code: "ArrowDown" }); expect(controls.sample().direction.y).toBe(0);
    dispatch(win, "keyup", { code: "Space" }); expect(controls.sample().buttons).toBe(0);
  });
  it("leaves shortcuts, composition, other keys and child/editable focus to the browser", () => {
    const { surface, controls, doc } = make();
    for (const fields of [{ code: "Escape" }, { code: "KeyW", ctrlKey: true }, { code: "KeyW", altKey: true }, { code: "KeyW", metaKey: true }, { code: "KeyW", isComposing: true }, { code: "KeyW", target: {} }]) {
      expect(dispatch(surface, "keydown", fields).defaultPrevented).toBe(false);
    }
    doc.activeElement = {}; expect(dispatch(surface, "keydown", { code: "Space" }).defaultPrevented).toBe(false);
    expect(controls.sample()).toEqual(neutral);
  });
  it("coalesces semantic activations for one tick with detached snapshots and validated bounds", () => {
    const { controls } = make();
    controls.pulse(2); controls.pulse(2); controls.pulse(4); controls.nudge(-1, 1);
    const sample = controls.sample(); expect(sample).toEqual({ pointer: null, direction: { x: -1, y: 1 }, buttons: 6 });
    sample.direction.x = 99; expect(controls.sample()).toEqual(neutral);
    for (const bad of [-1, 0, 65536, NaN, 1.1]) expect(() => controls.pulse(bad)).toThrow("invalid-buttons");
    for (const bad of [2, NaN, 0.5]) expect(() => controls.nudge(bad, 0)).toThrow("invalid-direction");
  });
  it("preserves a quick keyboard action between ticks without creating repeat presses", () => {
    const { surface, controls, win } = make();
    dispatch(surface, "keydown", { code: "Space" }); dispatch(win, "keyup", { code: "Space" });
    expect(controls.sample().buttons).toBe(1); expect(controls.sample().buttons).toBe(0);
    dispatch(surface, "keydown", { code: "Space", repeat: true });
    expect(controls.sample().buttons).toBe(1); dispatch(win, "keyup", { code: "Space" });
    expect(controls.sample().buttons).toBe(0);
  });
  it.each(["blur", "hidden", "focusout", "clear", "dispose"])("clears all held/queued intentions on %s", (reason) => {
    const { surface, controls, win, doc } = make();
    dispatch(surface, "pointerdown", pointer()); dispatch(surface, "keydown", { code: "Space" }); controls.pulse(2); controls.nudge(1, 1);
    if (reason === "blur") dispatch(win, "blur");
    if (reason === "hidden") { doc.hidden = true; dispatch(doc, "visibilitychange"); }
    if (reason === "focusout") dispatch(surface, "focusout");
    if (reason === "clear") controls.clear();
    if (reason === "dispose") { controls.dispose(); controls.dispose(); }
    expect(controls.sample()).toEqual(neutral); expect(surface.captured.size).toBe(0);
    if (reason === "dispose") {
      dispatch(surface, "pointerdown", pointer()); dispatch(surface, "keydown", { code: "Space" }); controls.pulse(1); controls.nudge(1, 0);
      expect(controls.sample()).toEqual(neutral);
    }
  });
  it("removes every owned listener and ignores hidden-document input", () => {
    const surface = new Surface(); const targets = [surface, surface.ownerDocument, surface.ownerDocument.defaultView];
    const spies = targets.map((target) => [vi.spyOn(target, "addEventListener"), vi.spyOn(target, "removeEventListener")]);
    const controls = createBrowserGameControls(surface as unknown as HTMLElement);
    surface.ownerDocument.hidden = true; dispatch(surface, "pointerdown", pointer()); controls.pulse(1); controls.nudge(1, 0);
    expect(controls.sample()).toEqual(neutral); controls.dispose();
    for (const [add, remove] of spies) expect(remove!.mock.calls).toEqual(add!.mock.calls);
  });
});
