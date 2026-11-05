import { describe, expect, it, vi } from "vitest";
import { createGameRuntime, createRandom, parseInput, parseCheckpoint, serializeState, type GameInput, type GameRules } from "../src/index.js";

const identity = { gameId: "test-volume", rulesVersion: "1.0.0", contentVersion: "1.0.0" };
const input = (tick = 1, sequence = tick, playerId = "p1", x = 1): GameInput => ({
  type: "gameInput", version: "1.0.0", tick, sequence, playerId, axes: { x, y: 0, z: 0 }, buttons: 0,
});
const rules: GameRules<{ x: number; random: number }> = {
  ...identity,
  initialState: () => ({ x: 0, random: 0 }),
  parseState(value) {
    if (!value || typeof value !== "object" || !("x" in value) || !("random" in value)
      || Object.keys(value).length !== 2 || !Number.isFinite(value.x) || !Number.isFinite(value.random)) throw new Error("invalid-state");
    return value as { x: number; random: number };
  },
  step(state, context) {
    return { x: state.x + context.inputs.reduce((sum, command) => sum + command.axes.x, 0), random: context.random.next() };
  },
};
const make = (options: Partial<Parameters<typeof createGameRuntime<{ x: number; random: number }>>[1]> = {}) =>
  createGameRuntime(rules, { seed: 42, players: ["p1", "p2"], ...options });

describe("seeded gameplay randomness", () => {
  it("repeats the same stream and resumes from the captured uint32 state", () => {
    const a = createRandom(0); const b = createRandom(0);
    for (let i = 0; i < 100; i++) { const value = a.next(); expect(value).toBe(b.next()); expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThan(1); }
    const resumed = createRandom(a.state()); expect(resumed.next()).toBe(a.next());
    expect(createRandom(1).next()).not.toBe(createRandom(2).next());
  });
  it.each([-1, 0.5, Infinity, NaN, 2 ** 32])("rejects invalid seed %s", (seed) => expect(() => createRandom(seed)).toThrow());
});

describe("input trust boundary", () => {
  it("preserves complete spatial intentions and detaches nested values", () => {
    const command = input(); command.axes.z = -1;
    const parsed = parseInput(command); command.axes.z = 1;
    expect(parsed.axes.z).toBe(-1);
  });
  it.each([
    null, [], { ...input(), score: 9000 }, { ...input(), tick: -1 }, { ...input(), tick: 1.5 },
    { ...input(), sequence: Number.MAX_SAFE_INTEGER + 1 }, { ...input(), playerId: "../../user" },
    { ...input(), axes: { x: NaN, y: 0, z: 0 } }, { ...input(), axes: { x: 0, y: 0, z: Infinity } },
    { ...input(), axes: { x: 0, y: 0, z: 0, speed: 99 } }, { ...input(), buttons: 65536 },
    { ...input(), type: "score" }, { ...input(), version: "9.0.0" },
  ])("rejects invalid, nonfinite or undeclared input fields", (value) => expect(() => parseInput(value)).toThrow());
  it("requires explicit envelope identity instead of guessing a version", () => {
    const { type: _type, version: _version, ...unversioned } = input();
    expect(() => parseInput(unversioned)).toThrow();
    const { type: _checkpointType, version: _checkpointVersion, ...save } = make().checkpoint();
    expect(() => parseCheckpoint(save)).toThrow();
  });
});

describe("fixed-step lifecycle", () => {
  it("replays identically across frame groupings and arrival order", () => {
    const a = make(); const b = make();
    for (const tick of [3, 1, 2]) { expect(a.enqueue(input(tick))).toBe("accepted"); }
    for (const tick of [1, 2, 3]) { expect(b.enqueue(input(tick))).toBe("accepted"); }
    a.advance(50); for (let i = 0; i < 3; i++) b.advance(1000 / 60);
    expect(a.snapshot()).toEqual(b.snapshot()); expect(a.snapshot().state.x).toBe(3);
    a.advance(1000 / 60); expect(a.snapshot().state.x).toBe(3);
  });
  it("orders simultaneous players consistently and rejects inconsistent sequence ordering", () => {
    const seen: string[][] = [];
    const runtime = createGameRuntime({ ...rules, step(state, { inputs }) { seen.push(inputs.map((entry) => entry.playerId)); return state; } }, { seed: 1, players: ["p2", "p1"] });
    expect(runtime.enqueue(input(2, 2))).toBe("accepted");
    expect(runtime.enqueue(input(1, 3))).toBe("order-conflict");
    expect(runtime.enqueue(input(1, 1, "p2"))).toBe("accepted");
    expect(runtime.enqueue(input(1, 1))).toBe("accepted");
    runtime.advance(1000 / 60); expect(seen).toEqual([["p1", "p2"]]);
    expect(runtime.enqueue(input(2, 1))).toBe("replayed");
  });
  it("bounds queues, future windows and replay without replacing valid intentions", () => {
    const runtime = make({ maxQueuedInputs: 2, maxFutureTicks: 3 });
    expect(runtime.enqueue(null)).toBe("invalid");
    expect(runtime.enqueue(input(0))).toBe("stale");
    expect(runtime.enqueue(input(4))).toBe("too-far-ahead");
    expect(runtime.enqueue(input(1, 1, "other"))).toBe("unknown-player");
    expect(runtime.enqueue(input())).toBe("accepted");
    expect(runtime.enqueue(input())).toBe("replayed");
    expect(runtime.enqueue(input(1, 2))).toBe("order-conflict");
    expect(runtime.enqueue(input(2, 2))).toBe("accepted");
    expect(runtime.enqueue(input(3, 3))).toBe("queue-full");
    runtime.advance(1000 / 60); expect(runtime.enqueue(input(3, 3))).toBe("accepted");
  });
  it("discards excess whole ticks with bounded work and preserves the fractional remainder", () => {
    const runtime = make({ maxCatchUpTicks: 2 });
    const result = runtime.advance(1005);
    expect(result.steps).toBe(2); expect(result.discardedMs).toBeCloseTo(1000 - 2000 / 60);
    expect(result.alpha).toBeCloseTo(0.3); expect(runtime.snapshot().tick).toBe(2);
    expect(() => runtime.advance(Infinity)).toThrow(); expect(() => runtime.advance(-1)).toThrow();
  });
  it("pauses explicitly, clears pending input and cannot catch up background time", () => {
    const runtime = make(); runtime.enqueue(input()); runtime.advance(1); runtime.pause();
    expect(runtime.enqueue(input())).toBe("inactive"); expect(runtime.advance(5000).steps).toBe(0);
    runtime.resume(); runtime.advance(1000 / 60); expect(runtime.snapshot().state.x).toBe(0);
    expect(runtime.status()).toBe("running");
  });
  it("detaches enqueue, snapshots and presentation hooks from simulation state", () => {
    const render = vi.fn((snapshot: { state: { x: number } }) => { snapshot.state.x = 999; });
    const runtime = make({ ports: { render } }); const command = input(); runtime.enqueue(command); command.axes.x = -1;
    runtime.advance(1000 / 60); const snapshot = runtime.snapshot(); snapshot.state.x = 100;
    expect(runtime.snapshot().state.x).toBe(1); expect(render).toHaveBeenCalledTimes(1);
  });
  it("isolates failing host hooks and disposes exactly once", () => {
    const dispose = vi.fn(); const lifecycle = vi.fn(() => { throw new Error("host-private-details"); });
    const runtime = make({ ports: { render() { throw new Error("private"); }, lifecycle, dispose } });
    expect(runtime.advance(1000 / 60).presentationFailed).toBe(true); expect(runtime.snapshot().tick).toBe(1);
    runtime.pause(); runtime.resume(); runtime.dispose(); runtime.dispose();
    expect(dispose).toHaveBeenCalledTimes(1); expect(runtime.status()).toBe("disposed");
    expect(runtime.enqueue(input(2))).toBe("inactive"); expect(runtime.advance(1).steps).toBe(0);
    expect(() => runtime.resume()).toThrow(); expect(() => runtime.checkpoint()).toThrow();
  });
  it("faults on invalid rule output and stops work without publishing private errors", () => {
    const runtime = createGameRuntime({ ...rules, step() { throw new Error("private"); } }, { seed: 1, players: ["p1"] });
    expect(() => runtime.advance(1000 / 60)).toThrow("rule-failed");
    expect(runtime.status()).toBe("faulted"); expect(runtime.advance(10).steps).toBe(0);
    expect(runtime.enqueue(input())).toBe("inactive"); expect(() => runtime.resume()).toThrow();
    runtime.dispose();
  });
  it("delivers detached audio transitions and reports an explicit save handoff failure", () => {
    const audio = vi.fn((previous: { state: { x: number } }, current: { state: { x: number } }) => {
      previous.state.x = 99; current.state.x = 99; throw new Error("audio-unavailable");
    });
    const runtime = make({ ports: { audio, checkpoint() { throw new Error("save-unavailable"); } } });
    runtime.enqueue(input()); expect(runtime.advance(1000 / 60).presentationFailed).toBe(true);
    expect(runtime.snapshot().state.x).toBe(1); expect(audio).toHaveBeenCalledTimes(1);
    expect(() => runtime.checkpoint()).toThrow("save-unavailable");
    expect(runtime.status()).toBe("running");
  });
  it.each([{ players: [] }, { players: ["p1", "p1"] }, { players: ["p1", "p2", "p3", "p4", "p5"] }, { maxQueuedInputs: 0 }, { maxFutureTicks: 0 }, { maxCatchUpTicks: 61 }])("rejects invalid configuration", (options) => expect(() => make(options)).toThrow());
});

describe("versioned checkpoint recovery", () => {
  it("round trips ticks, RNG, queued commands and sequence watermarks", () => {
    const original = make(); original.enqueue(input()); original.enqueue(input(3)); original.advance(1000 / 60);
    const saved = original.checkpoint(); const restored = make(); restored.restore(saved);
    expect(restored.enqueue(input(2, 1))).toBe("replayed");
    original.advance(1000 / 30); restored.advance(1000 / 30);
    expect(restored.snapshot()).toEqual(original.snapshot());
  });
  it("preserves the running state and source on invalid or incompatible saves", () => {
    const runtime = make(); runtime.advance(1000 / 60); const before = runtime.snapshot(); const saved = runtime.checkpoint();
    for (const changed of [
      { ...saved, type: "unknown" }, { ...saved, version: "9.0.0" }, { ...saved, gameId: "other" },
      { ...saved, rulesVersion: "2.0.0" }, { ...saved, contentVersion: "2.0.0" },
      { ...saved, stateJson: "{}" }, { ...saved, stateJson: "[" }, { ...saved, privateField: true },
      { ...saved, randomState: -1 }, { ...saved, pending: [input(0)] },
      { ...saved, pending: [input(3), input(3)] }, { ...saved, players: [{ playerId: "foreign", sequence: 0 }] },
    ]) { expect(() => runtime.restore(changed)).toThrow(); expect(runtime.snapshot()).toEqual(before); }
    expect(runtime.checkpoint()).toEqual(saved);
  });
  it("requires explicit version-pair migration and validates the migrated candidate atomically", () => {
    const runtime = make(); const saved = { ...runtime.checkpoint(), rulesVersion: "0.9.0", stateJson: '{"position":12}' };
    const migrated = make({ migrations: { "0.9.0/1.0.0": (state) => ({ x: (state as { position: number }).position, random: 0 }) } });
    migrated.restore(saved); expect(migrated.snapshot().state.x).toBe(12); expect(saved.stateJson).toBe('{"position":12}');
    const broken = make({ migrations: { "0.9.0/1.0.0": () => ({ bad: true }) } });
    expect(() => broken.restore(saved)).toThrow(); expect(broken.snapshot().tick).toBe(0);
  });
  it("bounds state and whole-envelope bytes before parsing", () => {
    const runtime = make(); const saved = runtime.checkpoint();
    expect(() => runtime.restore({ ...saved, stateJson: '"' + "x".repeat(262144) + '"' })).toThrow();
    expect(() => runtime.restore("x".repeat(1048577))).toThrow();
  });
  it("accepts serialized checkpoints and rejects malformed JSON or non-JSON state", () => {
    const runtime = make(); const saved = runtime.checkpoint();
    runtime.restore(JSON.stringify(saved)); expect(runtime.checkpoint()).toEqual(saved);
    expect(() => parseCheckpoint("{")).toThrow("invalid-checkpoint");
    const cyclic: { ref?: unknown } = {}; cyclic.ref = cyclic;
    for (const value of [undefined, NaN, 1n, () => 0, { value: Infinity }, { value: Symbol() }, cyclic]) {
      expect(() => serializeState(value)).toThrow("invalid-state");
    }
    expect(() => serializeState("a".repeat(262144))).toThrow("state-too-large");
    expect(serializeState({ valid: [1, true, null] })).toBe('{"valid":[1,true,null]}');
  });
  it("faults on tick overflow and never restores into a disposed host", () => {
    const runtime = make(); runtime.restore({ ...runtime.checkpoint(), tick: Number.MAX_SAFE_INTEGER });
    expect(() => runtime.advance(1000 / 60)).toThrow("tick-overflow");
    runtime.dispose(); runtime.pause();
    expect(() => runtime.restore(make().checkpoint())).toThrow("inactive-runtime");
  });
});
