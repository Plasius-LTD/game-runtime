import { describe, expect, it, vi } from "vitest";
import { createGameRuntime, type GameRules, type RuntimePorts } from "../src/runtime.js";
import type { GameInput } from "../src/contracts.js";

const command = (tick: number, sequence = tick - 1, playerId = "one"): GameInput => ({
  type: "gameInput", version: "1.0.0", tick, sequence, playerId, axes: { x: 1, y: 0, z: 0 }, buttons: 0,
});
const rules: GameRules<number> = {
  gameId: "test", rulesVersion: "1.0.0", contentVersion: "1.0.0", initialState: () => 0,
  parseState(value) { if (typeof value !== "number") throw new Error(); return value; },
  step: (state, { inputs }) => state + inputs.reduce((sum, input) => sum + input.axes.x, 0),
};
const make = (ports: RuntimePorts<number>, players = ["one"]) => createGameRuntime(rules, { seed: 1, players, ports });

describe("sample input on actual fixed ticks", () => {
  it("samples every catch-up tick, never a presentation-only frame or discarded tick", () => {
    const sampleInput = vi.fn(({ tick, players }) => players.map(({ playerId, sequence }: { playerId: string; sequence: number }) => command(tick, sequence + 1, playerId)));
    const runtime = make({ sampleInput });
    runtime.advance(2); expect(sampleInput).not.toHaveBeenCalled();
    expect(runtime.advance(1000).steps).toBe(5);
    expect(sampleInput.mock.calls.map(([context]) => context.tick)).toEqual([1, 2, 3, 4, 5]);
    expect(runtime.snapshot()).toEqual({ tick: 5, state: 5 });
    expect(runtime.checkpoint().players).toEqual([{ playerId: "one", sequence: 4 }]);
    expect(runtime.checkpoint().pending).toEqual([]);
  });

  it("keeps omitted slots neutral and gives queued replay precedence", () => {
    const sampleInput = vi.fn(({ tick, players }) => players.filter(({ playerId }: { playerId: string }) => playerId === "one").map(() => command(tick)));
    const runtime = make({ sampleInput }, ["two", "one"]);
    runtime.enqueue({ ...command(1, 8), axes: { x: -1, y: 0, z: 0 } });
    runtime.advance(17);
    expect(sampleInput.mock.calls[0]![0].players).toEqual([{ playerId: "two", sequence: -1 }]);
    expect(runtime.snapshot().state).toBe(-1);
    sampleInput.mockImplementation(() => []);
    runtime.advance(17); expect(runtime.snapshot().state).toBe(-1);
  });

  it("restores sequence watermarks and detaches callback context and commands", () => {
    let saved: unknown;
    const runtime = make({ sampleInput({ tick, players }) {
      saved = command(tick, players[0]!.sequence + 1);
      (players as { playerId: string; sequence: number }[])[0]!.sequence = 999;
      return [saved];
    } });
    runtime.advance(34);
    (saved as GameInput).axes.x = -1;
    const checkpoint = runtime.checkpoint();
    runtime.advance(17); runtime.restore(checkpoint); runtime.advance(17);
    expect(runtime.snapshot()).toEqual({ tick: 3, state: 3 });
    expect(runtime.checkpoint().players[0]!.sequence).toBe(2);
  });

  it.each([
    () => null,
    () => Promise.resolve([]),
    () => Array.from({ length: 5 }, () => command(1)),
    () => [command(1), command(1, 1)],
    () => [command(1, 0, "foreign")],
    () => [command(2)],
    () => [{ ...command(1), score: 100 }],
    () => [{ ...command(1), axes: { x: NaN, y: 0, z: 0 } }],
    () => { throw new Error("private provider detail"); },
  ])("faults atomically for an invalid/async/throwing batch", (sampleInput) => {
    const runtime = make({ sampleInput: sampleInput as RuntimePorts<number>["sampleInput"] });
    expect(() => runtime.advance(17)).toThrow("input-sampling-failed");
    expect(runtime.status()).toBe("faulted");
    expect(runtime.snapshot()).toEqual({ tick: 0, state: 0 });
  });

  it("does not override queued input or violate future ordering/queue bounds", () => {
    for (const pending of [command(1), command(2, 0)]) {
      const runtime = make({ sampleInput: () => [command(1)] });
      runtime.enqueue(pending);
      expect(() => runtime.advance(17)).toThrow("input-sampling-failed");
      expect(runtime.snapshot().tick).toBe(0);
    }
    const runtime = createGameRuntime(rules, { seed: 1, players: ["one"], maxQueuedInputs: 1, ports: { sampleInput: () => [command(1)] } });
    runtime.enqueue(command(2, 2));
    expect(() => runtime.advance(17)).toThrow("input-sampling-failed");
  });

  it.each(["pause", "dispose", "pause-resume"])("interrupts on sampler %s without committing a tick", (action) => {
    const runtime = make({ sampleInput() {
      expect(runtime.enqueue(command(1))).toBe("inactive");
      expect(() => runtime.advance(1)).toThrow("runtime-busy");
      if (action === "dispose") runtime.dispose();
      else { runtime.pause(); if (action === "pause-resume") runtime.resume(); }
      return [command(1)];
    } });
    expect(runtime.advance(17).steps).toBe(0);
    expect(runtime.snapshot()).toEqual({ tick: 0, state: 0 });
  });

  it("does not commit sampled input when rules fail", () => {
    const runtime = createGameRuntime({ ...rules, step() { throw new Error(); } }, { seed: 1, players: ["one"], ports: { sampleInput: () => [command(1)] } });
    expect(() => runtime.advance(17)).toThrow("rule-failed");
    expect(runtime.snapshot()).toEqual({ tick: 0, state: 0 });
  });
});
