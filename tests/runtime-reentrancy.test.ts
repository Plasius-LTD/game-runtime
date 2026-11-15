import { describe, expect, it, vi } from "vitest";
import { createGameRuntime, createRandom, type GameRules, type RuntimeOptions } from "../src/index.js";

type State = { n: number };
type Runtime = ReturnType<typeof createGameRuntime<State>>;
const STEP = 1000 / 60;
const rules: GameRules<State> = {
  gameId: "lifecycle-volume", rulesVersion: "1.0.0", contentVersion: "1.0.0",
  initialState: () => ({ n: 0 }),
  parseState(value) {
    if (!value || typeof value !== "object" || !("n" in value) || !Number.isSafeInteger(value.n)) throw new Error("invalid-state");
    return value as State;
  },
  step(state, context) { context.random.next(); return { n: state.n + 1 }; },
};
const create = (options: Partial<RuntimeOptions<State>> = {}, overrides: Partial<GameRules<State>> = {}) =>
  createGameRuntime({ ...rules, ...overrides }, { seed: 7, players: ["p1"], ...options });
const input = { type: "gameInput", version: "1.0.0", tick: 2, sequence: 1, playerId: "p1", axes: { x: 0, y: 0, z: 0 }, buttons: 0 };

describe("synchronous lifecycle and operation ownership", () => {
  it.each(["pause", "dispose"] as const)("stops catch-up at the audio %s boundary and accounts for the remaining time", (action) => {
    let runtime: Runtime;
    const audio = vi.fn(() => runtime[action]());
    const render = vi.fn(), dispose = vi.fn();
    runtime = create({ ports: { audio, render, dispose } });
    runtime.enqueue(input);
    const result = runtime.advance(55);
    expect(runtime.snapshot()).toEqual({ tick: 1, state: { n: 1 } });
    expect(result.steps).toBe(1); expect(result.discardedMs).toBeCloseTo(55 - STEP); expect(result.alpha).toBe(0);
    expect(audio).toHaveBeenCalledTimes(1); expect(render).not.toHaveBeenCalled();
    expect(runtime.status()).toBe(action === "pause" ? "paused" : "disposed");
    if (action === "pause") {
      expect(runtime.checkpoint().pending).toEqual([]);
      runtime.resume(); expect(runtime.advance(STEP).steps).toBe(1);
    }
    runtime.dispose(); runtime.dispose(); expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("ends the current batch even when a hook immediately resumes", () => {
    let runtime: Runtime;
    const render = vi.fn();
    runtime = create({ ports: { audio() { runtime.pause(); runtime.resume(); }, render } });
    const result = runtime.advance(55);
    expect(runtime.status()).toBe("running"); expect(runtime.snapshot().tick).toBe(1);
    expect(result).toMatchObject({ steps: 1, alpha: 0, presentationFailed: false });
    expect(result.discardedMs).toBeCloseTo(55 - STEP); expect(render).not.toHaveBeenCalled();
    expect(runtime.advance(1).steps).toBe(0); expect(runtime.snapshot().tick).toBe(1);
  });

  it("accounts for an interruption inside the final render hook", () => {
    let runtime: Runtime;
    runtime = create({ ports: { render() { runtime.pause(); runtime.resume(); } } });
    const result = runtime.advance(STEP + 4);
    expect(result.steps).toBe(1); expect(result.discardedMs).toBeCloseTo(4); expect(result.alpha).toBe(0);
    expect(runtime.advance(1).steps).toBe(0);
  });

  it("rejects nested operations and inputs while permitting committed-state reads", () => {
    let runtime: Runtime;
    const saved = create().checkpoint();
    const audio = vi.fn(() => {
      expect(runtime.snapshot().tick).toBeGreaterThan(0);
      expect(() => runtime.advance(STEP)).toThrow("runtime-busy");
      expect(() => runtime.restore(saved)).toThrow("runtime-busy");
      expect(() => runtime.checkpoint()).toThrow("runtime-busy");
      expect(runtime.enqueue(input)).toBe("inactive");
    });
    runtime = create({ ports: { audio } });
    expect(runtime.advance(50)).toMatchObject({ steps: 3, presentationFailed: false });
    expect(audio).toHaveBeenCalledTimes(3); expect(runtime.checkpoint().pending).toEqual([]);
  });

  it("releases checkpoint ownership after a rejected recursive handoff", () => {
    let runtime: Runtime;
    const checkpoint = vi.fn(() => { runtime.checkpoint(); });
    runtime = create({ ports: { checkpoint } });
    expect(() => runtime.checkpoint()).toThrow("runtime-busy");
    expect(checkpoint).toHaveBeenCalledTimes(1);
    expect(runtime.advance(STEP).steps).toBe(1);
  });

  it("allows a save callback to dispose after handing off one detached checkpoint", () => {
    let runtime: Runtime;
    const dispose = vi.fn();
    runtime = create({ ports: { checkpoint(saved) { saved.tick = 99; runtime.dispose(); }, dispose } });
    expect(runtime.checkpoint().tick).toBe(0);
    expect(runtime.status()).toBe("disposed"); expect(dispose).toHaveBeenCalledTimes(1);
    expect(runtime.advance(50).steps).toBe(0);
  });

  it.each(["step", "parseState"] as const)("does not commit a tick interrupted in %s", (phase) => {
    let runtime: Runtime, armed = false;
    const render = vi.fn(), audio = vi.fn();
    runtime = create({ ports: { audio, render } }, {
      step(state, context) { context.random.next(); if (phase === "step") { runtime.pause(); runtime.resume(); } return { n: state.n + 1 }; },
      parseState(value) { if (armed && phase === "parseState") { runtime.pause(); runtime.resume(); } return rules.parseState(value); },
    });
    armed = true;
    const result = runtime.advance(55);
    expect(result).toMatchObject({ steps: 0, discardedMs: 55, alpha: 0 });
    expect(runtime.snapshot()).toEqual({ tick: 0, state: { n: 0 } });
    expect(runtime.checkpoint().randomState).toBe(7);
    expect(audio).not.toHaveBeenCalled(); expect(render).not.toHaveBeenCalled();
  });

  it("never resurrects a disposed host when rule evaluation throws", () => {
    let runtime: Runtime;
    const lifecycle = vi.fn(), dispose = vi.fn(), render = vi.fn();
    runtime = create({ ports: { lifecycle, dispose, render } }, { step() { runtime.dispose(); throw new Error("rule detail"); } });
    expect(() => runtime.advance(50)).toThrow("rule-failed");
    expect(runtime.status()).toBe("disposed"); expect(runtime.snapshot().tick).toBe(0);
    expect(lifecycle.mock.calls.map(([state]) => state)).toEqual(["disposed"]);
    runtime.dispose(); expect(dispose).toHaveBeenCalledTimes(1); expect(render).not.toHaveBeenCalled();
  });

  it("isolates rule-retained random streams from committed randomness", () => {
    let retained: ReturnType<typeof createRandom> | undefined;
    const runtime = create({}, { step(state, context) { retained = context.random; context.random.next(); return { n: state.n + 1 }; } });
    runtime.advance(STEP); const committed = runtime.checkpoint().randomState;
    retained!.next(); expect(runtime.checkpoint().randomState).toBe(committed);
    runtime.advance(STEP);
    const control = createRandom(7); control.next(); control.next();
    expect(runtime.checkpoint().randomState).toBe(control.state());
  });

  it("rejects interrupted migration without replacing the current checkpoint", () => {
    let runtime: Runtime;
    runtime = create({ migrations: { "0.5.0/1.0.0": (state) => { runtime.pause(); runtime.resume(); return state; } } });
    runtime.advance(STEP); const before = runtime.checkpoint();
    const source = { ...before, rulesVersion: "0.5.0", tick: 20, stateJson: '{"n":20}' };
    expect(() => runtime.restore(source)).toThrow("runtime-interrupted");
    expect(runtime.checkpoint()).toEqual(before); expect(source.tick).toBe(20);
    expect(runtime.advance(STEP).steps).toBe(1);
  });

  it("rejects nested advancement during restore and releases ownership afterward", () => {
    let runtime: Runtime;
    runtime = create({ migrations: { "0.5.0/1.0.0": (state) => {
      expect(() => runtime.advance(STEP)).toThrow("runtime-busy"); return state;
    } } });
    runtime.restore({ ...create().checkpoint(), rulesVersion: "0.5.0" });
    expect(runtime.advance(50).steps).toBe(3);
  });

  it("bounds lifecycle notification recursion while applying the final status", () => {
    let runtime: Runtime;
    const lifecycle = vi.fn((status) => { if (status === "paused") runtime.resume(); else if (status === "running") runtime.pause(); });
    runtime = create({ ports: { lifecycle } });
    runtime.pause();
    expect(runtime.status()).toBe("running"); expect(lifecycle).toHaveBeenCalledTimes(1);
    expect(runtime.advance(50).steps).toBe(3);
  });

  it("owns operations during a standalone lifecycle handoff", () => {
    let runtime: Runtime;
    const saved = create().checkpoint();
    const lifecycle = vi.fn(() => {
      runtime.resume();
      expect(runtime.status()).toBe("running");
      expect(runtime.snapshot().tick).toBe(0);
      expect(() => runtime.advance(STEP)).toThrow("runtime-busy");
      expect(() => runtime.restore(saved)).toThrow("runtime-busy");
      expect(() => runtime.checkpoint()).toThrow("runtime-busy");
      expect(runtime.enqueue(input)).toBe("inactive");
    });
    runtime = create({ ports: { lifecycle } });
    runtime.pause();
    expect(lifecycle).toHaveReturned();
    expect(runtime.snapshot().tick).toBe(0);
    expect(runtime.advance(STEP).steps).toBe(1);
    expect(runtime.checkpoint().pending).toEqual([]);
  });

  it("owns operations during standalone disposal and disposes only once", () => {
    let runtime: Runtime;
    const dispose = vi.fn(() => {
      runtime.dispose();
      expect(runtime.status()).toBe("disposed");
      expect(() => runtime.advance(STEP)).toThrow("runtime-busy");
    });
    runtime = create({ ports: { dispose } });
    runtime.dispose(); runtime.dispose();
    expect(dispose).toHaveReturned();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(runtime.advance(STEP).steps).toBe(0);
  });

  it("keeps ordinary catch-up and failure isolation deterministic", () => {
    const runtime = create({ ports: { audio() { throw new Error("audio failure"); } } });
    const result = runtime.advance(55);
    expect(result).toMatchObject({ steps: 3, discardedMs: 0, presentationFailed: true });
    expect(result.alpha).toBeCloseTo(0.3);
    expect(runtime.advance(STEP).steps).toBe(1);
  });
});
