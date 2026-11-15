import { parseCheckpoint, parseIdentity, parseInput, serializeState, type GameCheckpoint, type GameIdentity, type GameInput } from "./contracts.js";
import { createRandom, type RandomStream } from "./random.js";

export const GAME_TICK_RATE = 60;
const STEP_MS = 1000 / GAME_TICK_RATE;
export type RuntimeStatus = "running" | "paused" | "faulted" | "disposed";
export type InputDecision = "accepted" | "invalid" | "unknown-player" | "stale" | "too-far-ahead" | "replayed" | "order-conflict" | "queue-full" | "inactive";
export interface GameSnapshot<S> { tick: number; state: S }
export interface StepContext {
  readonly tick: number;
  readonly deltaSeconds: number;
  readonly inputs: readonly GameInput[];
  readonly random: RandomStream;
}
/** Implement pure rules; parseState must validate the complete game-owned state. */
export interface GameRules<S> extends GameIdentity {
  initialState(): S;
  parseState(value: unknown): S;
  step(state: Readonly<S>, context: StepContext): S;
}
/**
 * Hooks are synchronous handoffs. Pause/resume/dispose end outstanding work;
 * nested advance/restore/checkpoint calls reject with runtime-busy. Hosts own I/O.
 */
export interface RuntimePorts<S> {
  render?(snapshot: GameSnapshot<S>, alpha: number): void;
  audio?(previous: GameSnapshot<S>, current: GameSnapshot<S>): void;
  checkpoint?(checkpoint: GameCheckpoint): void;
  lifecycle?(status: RuntimeStatus): void;
  dispose?(): void;
}
export interface RuntimeOptions<S> {
  seed: number;
  players: readonly string[];
  maxCatchUpTicks?: number;
  maxQueuedInputs?: number;
  maxFutureTicks?: number;
  ports?: RuntimePorts<S>;
  /** Explicit source rules/content pair to the current pair. No implicit downgrade. */
  migrations?: Readonly<Record<string, (state: unknown) => unknown>>;
}
/** Completed ticks and discarded overload/interruption time, including interrupted fractions. */
export interface AdvanceResult { steps: number; discardedMs: number; alpha: number; presentationFailed: boolean }

function bound(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError("invalid-limit");
  return value;
}
const compare = (a: GameInput, b: GameInput) => a.tick - b.tick || (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : a.sequence - b.sequence);

/** Create a headless fixed-step host. No browser, storage or networking is opened. */
export function createGameRuntime<S>(rules: GameRules<S>, options: RuntimeOptions<S>) {
  const identity = parseIdentity({ gameId: rules.gameId, rulesVersion: rules.rulesVersion, contentVersion: rules.contentVersion });
  const players = [...options.players].sort();
  if (players.length < 1 || players.length > 4 || new Set(players).size !== players.length
    || players.some((id) => !/^[a-zA-Z0-9_-]{1,32}$/.test(id))) throw new TypeError("invalid-players");
  const maxCatchUp = bound(options.maxCatchUpTicks ?? 5, 1, 60);
  const maxQueue = bound(options.maxQueuedInputs ?? 256, 1, 4096);
  const maxFuture = bound(options.maxFutureTicks ?? 120, 1, 3600);
  const ports = options.ports ?? {};
  const migrations = { ...options.migrations };
  let state = structuredClone(rules.parseState(rules.initialState()));
  let random = createRandom(options.seed);
  let tick = 0;
  let accumulator = 0;
  let status: RuntimeStatus = "running";
  let busy = false;
  let notifyingLifecycle = false;
  let lifecycleEpoch = {};
  let queue: GameInput[] = [];
  let sequences = new Map(players.map((id) => [id, -1]));
  const snapshot = (): GameSnapshot<S> => ({ tick, state: structuredClone(state) });
  const attempt = (fn: () => void): boolean => {
    const wasBusy = busy;
    busy = true;
    try { fn(); return true; } catch { return false; }
    finally { busy = wasBusy; }
  };
  const isDisposed = () => status === "disposed";
  const setStatus = (next: RuntimeStatus) => {
    if (status === next) return;
    status = next; lifecycleEpoch = {};
    if (notifyingLifecycle) return;
    notifyingLifecycle = true;
    try { attempt(() => ports.lifecycle?.(next)); }
    finally { notifyingLifecycle = false; }
  };
  function exclusive<T>(operation: () => T): T {
    if (busy) throw new Error("runtime-busy");
    busy = true;
    try { return operation(); } finally { busy = false; }
  }

  function checkInput(command: GameInput, pending: readonly GameInput[], watermarks: ReadonlyMap<string, number>, currentTick: number): InputDecision {
    const watermark = watermarks.get(command.playerId);
    if (watermark === undefined) return "unknown-player";
    if (command.tick <= currentTick) return "stale";
    if (command.tick - currentTick > maxFuture) return "too-far-ahead";
    if (command.sequence <= watermark || pending.some((entry) => entry.playerId === command.playerId && entry.sequence === command.sequence)) return "replayed";
    if (pending.some((entry) => entry.playerId === command.playerId && (entry.tick === command.tick
      || (entry.tick < command.tick) !== (entry.sequence < command.sequence)))) return "order-conflict";
    if (pending.length >= maxQueue) return "queue-full";
    return "accepted";
  }

  return {
    status: (): RuntimeStatus => status,
    snapshot,
    enqueue(raw: unknown): InputDecision {
      if (busy || status !== "running") return "inactive";
      let command: GameInput;
      try { command = parseInput(raw); } catch { return "invalid"; }
      const decision = checkInput(command, queue, sequences, tick);
      if (decision === "accepted") { queue.push(command); queue.sort(compare); }
      return decision;
    },
    advance(elapsedMs: number): AdvanceResult {
      return exclusive(() => {
        if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > 86400000) throw new RangeError("invalid-elapsed-time");
        if (status !== "running") return { steps: 0, discardedMs: 0, alpha: 0, presentationFailed: false };
        const epoch = lifecycleEpoch;
        const continuing = () => status === "running" && lifecycleEpoch === epoch;
        const total = accumulator + elapsedMs;
        const available = Math.floor(total / STEP_MS + 1e-9);
        const budget = Math.min(available, maxCatchUp);
        accumulator = Math.max(0, total - available * STEP_MS);
        let steps = 0;
        let presentationFailed = false;
        while (steps < budget && continuing()) {
          const nextTick = tick + 1;
          if (!Number.isSafeInteger(nextTick)) { setStatus("faulted"); throw new RangeError("tick-overflow"); }
          const commands = queue.filter((entry) => entry.tick === nextTick);
          const previous = ports.audio ? snapshot() : undefined;
          const candidateRandom = createRandom(random.state());
          let candidateState: S;
          try {
            const candidate = rules.step(structuredClone(state), { tick: nextTick, deltaSeconds: 1 / GAME_TICK_RATE, inputs: structuredClone(commands), random: candidateRandom });
            if (!continuing()) break;
            candidateState = structuredClone(rules.parseState(candidate));
            if (!continuing()) break;
          } catch {
            queue = []; accumulator = 0;
            if (!isDisposed()) setStatus("faulted");
            throw new Error("rule-failed");
          }
          state = candidateState;
          random = createRandom(candidateRandom.state());
          tick = nextTick;
          steps++;
          queue = queue.filter((entry) => entry.tick > tick);
          for (const entry of commands) sequences.set(entry.playerId, entry.sequence);
          if (previous && !attempt(() => ports.audio?.(previous, snapshot()))) presentationFailed = true;
        }
        if (continuing() && !attempt(() => ports.render?.(snapshot(), accumulator / STEP_MS))) presentationFailed = true;
        if (!continuing()) accumulator = 0;
        return { steps, discardedMs: Math.max(0, total - steps * STEP_MS - accumulator), alpha: accumulator / STEP_MS, presentationFailed };
      });
    },
    pause() {
      if (status !== "running") return;
      queue = []; accumulator = 0; setStatus("paused");
    },
    resume() {
      if (status === "disposed" || status === "faulted") throw new Error("inactive-runtime");
      if (status === "paused") setStatus("running");
    },
    checkpoint(): GameCheckpoint {
      return exclusive(() => {
        if (status === "disposed" || status === "faulted") throw new Error("inactive-runtime");
        const result = parseCheckpoint({ ...identity, type: "gameCheckpoint", version: "1.0.0", tick,
          randomState: random.state(), stateJson: serializeState(state),
          players: players.map((playerId) => ({ playerId, sequence: sequences.get(playerId)! })), pending: queue,
        });
        // Explicit save handoff errors propagate; a caller must not report a failed save as persisted.
        ports.checkpoint?.(structuredClone(result));
        return result;
      });
    },
    restore(raw: unknown) {
      return exclusive(() => {
        if (status === "disposed" || status === "faulted") throw new Error("inactive-runtime");
        const epoch = lifecycleEpoch;
        const ensureUninterrupted = () => { if (lifecycleEpoch !== epoch) throw new Error("runtime-interrupted"); };
        const checkpoint = parseCheckpoint(raw);
        if (checkpoint.gameId !== identity.gameId) throw new Error("incompatible-checkpoint");
        if (checkpoint.players.length !== players.length || checkpoint.players.some((entry, index) => entry.playerId !== players[index])) throw new Error("incompatible-players");
        let candidate: unknown;
        try { candidate = JSON.parse(checkpoint.stateJson); } catch { throw new Error("invalid-state"); }
        if (checkpoint.rulesVersion !== identity.rulesVersion || checkpoint.contentVersion !== identity.contentVersion) {
          const migration = migrations[`${checkpoint.rulesVersion}/${checkpoint.contentVersion}`];
          if (!migration) throw new Error("unsupported-checkpoint-version");
          candidate = migration(candidate);
          ensureUninterrupted();
        }
        const restoredState = structuredClone(rules.parseState(candidate));
        ensureUninterrupted();
        serializeState(restoredState);
        const restoredRandom = createRandom(checkpoint.randomState);
        const restoredSequences = new Map(checkpoint.players.map(({ playerId, sequence }) => [playerId, sequence]));
        const restoredQueue: GameInput[] = [];
        for (const entry of checkpoint.pending) {
          const command = parseInput(entry);
          if (checkInput(command, restoredQueue, restoredSequences, checkpoint.tick) !== "accepted") throw new Error("invalid-checkpoint-queue");
          restoredQueue.push(command);
        }
        ensureUninterrupted();
        state = restoredState; random = restoredRandom; tick = checkpoint.tick;
        sequences = restoredSequences; queue = restoredQueue.sort(compare); accumulator = 0;
      });
    },
    dispose() {
      if (status === "disposed") return;
      queue = []; accumulator = 0; setStatus("disposed"); attempt(() => ports.dispose?.());
    },
  };
}
