import { describe, expect, it, vi } from "vitest";
import { createGameRuntime } from "../src/runtime.js";
import { createSaveSession, type RecoveryKey, type RecoveryStore, type CloudSaveStore } from "../src/saves.js";
import type { GameCheckpoint } from "../src/contracts.js";

const identity = { gameId: "prism-breaker", rulesVersion: "1.0.0", contentVersion: "1.0.0" };
const checkpoint = (tick = 1): GameCheckpoint => ({ ...identity, type: "gameCheckpoint", version: "1.0.0", tick,
  randomState: 42, stateJson: JSON.stringify({ score: tick }), players: [{ playerId: "p1", sequence: -1 }], pending: [] });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function fixture() {
  const records = new Map<string, { revision: number; value: unknown }>();
  const keyOf = (key: RecoveryKey) => `${key.scope}/${key.gameId}`;
  const local: RecoveryStore = {
    read: vi.fn(async key => structuredClone(records.get(keyOf(key)) ?? null)),
    write: vi.fn(async (key, revision, value) => {
      const previous = records.get(keyOf(key));
      if ((previous?.revision ?? null) !== revision) return { status: "conflict" as const };
      const next = { revision: (revision ?? 0) + 1, value: structuredClone(value) };
      records.set(keyOf(key), next); return { status: "written" as const, revision: next.revision };
    }),
  };
  const cloud: CloudSaveStore = { read: vi.fn(async () => null), write: vi.fn(async () => ({ status: "saved" as const, revision: "r1" })) };
  let id = 0;
  const options = { scope: "account-a", identity, local, cloud, operationId: () => `op-${++id}`, timeoutMs: 25 };
  return { records, local, cloud, options, make: (scope = "account-a") => createSaveSession({ ...options, scope }) };
}

describe("durable account save sessions", () => {
  it("persists before uploading, binds every call to the account/game and acknowledges only the matching attempt", async () => {
    const f = fixture(); const session = f.make();
    expect(await session.load()).toEqual({ status: "ready", checkpoint: null });
    expect(await session.stage(checkpoint())).toEqual({ status: "stored" });
    expect(f.cloud.write).not.toHaveBeenCalled();
    vi.mocked(f.cloud.write).mockImplementation(async (key, attempt) => {
      expect(key).toEqual({ scope: "account-a", gameId: identity.gameId });
      expect((f.records.get("account-a/prism-breaker")?.value as any).attempt.id).toBe(attempt.id);
      expect(attempt.expectedRevision).toBeNull();
      return { status: "saved", revision: "r1" };
    });
    expect(await session.flush()).toEqual({ status: "saved" });
    expect(await session.flush()).toEqual({ status: "idle" });
    const reopened = f.make();
    vi.mocked(f.cloud.read).mockRejectedValue(new Error("offline"));
    expect(await reopened.load()).toEqual({ status: "offline", checkpoint: checkpoint() });
    expect(session.status()).toEqual({ state: "ready", staged: false, inFlight: false });
  });

  it("coalesces staged writes without unbounded waiters and reports superseded requests", async () => {
    const f = fixture(); const session = f.make(); await session.load();
    const release = deferred<void>(); const entered = deferred<void>(); const write = f.local.write;
    let once = true;
    f.local.write = vi.fn(async (...args: Parameters<RecoveryStore["write"]>) => { if (once) { once = false; entered.resolve(); await release.promise; } return write(...args); });
    const first = session.stage(checkpoint(1)); await entered.promise;
    const second = session.stage(checkpoint(2)); const third = session.stage(checkpoint(3));
    expect(await second).toEqual({ status: "superseded" });
    release.resolve(); expect(await first).toEqual({ status: "stored" }); expect(await third).toEqual({ status: "stored" });
    await session.flush();
    expect(vi.mocked(f.cloud.write).mock.calls[0]?.[1].checkpoint.tick).toBe(3);
    expect(f.local.write).toHaveBeenCalledTimes(4); // first, latest, durable attempt, acknowledgement
  });

  it("retains an uncertain idempotent attempt across restart while keeping a newer staged save", async () => {
    const f = fixture(); const session = f.make(); await session.load(); await session.stage(checkpoint(1));
    vi.mocked(f.cloud.write).mockRejectedValueOnce(new Error("response lost after server committed"));
    expect(await session.flush()).toEqual({ status: "unavailable" });
    const first = structuredClone(vi.mocked(f.cloud.write).mock.calls[0]?.[1]);
    await session.stage(checkpoint(2)); session.dispose();
    const reopened = f.make(); expect((await reopened.load()).checkpoint?.tick).toBe(2);
    expect(await reopened.flush()).toEqual({ status: "saved" });
    expect(vi.mocked(f.cloud.write).mock.calls[1]?.[1]).toEqual(first);
    expect(await reopened.flush()).toEqual({ status: "saved" });
    const second = vi.mocked(f.cloud.write).mock.calls[2]?.[1];
    expect(second?.expectedRevision).toBe("r1"); expect(second?.checkpoint.tick).toBe(2); expect(second?.id).not.toBe(first?.id);
  });

  it("does not discard a checkpoint staged while a cloud acknowledgement is pending", async () => {
    const f = fixture(); const session = f.make(); await session.load(); await session.stage(checkpoint(1));
    const response = deferred<{ status: "saved"; revision: string }>(); const entered = deferred<void>();
    vi.mocked(f.cloud.write).mockImplementationOnce(async () => { entered.resolve(); return response.promise; });
    const flush = session.flush(); await entered.promise;
    await session.stage(checkpoint(2)); response.resolve({ status: "saved", revision: "r1" });
    expect(await flush).toEqual({ status: "saved" });
    expect(session.status().staged).toBe(true);
    await session.flush(); expect(vi.mocked(f.cloud.write).mock.calls[1]?.[1].checkpoint.tick).toBe(2);
  });

  it("preserves local and cloud conflicts rather than selecting a winner", async () => {
    const f = fixture(); const session = f.make(); await session.load(); await session.stage(checkpoint());
    vi.mocked(f.cloud.write).mockResolvedValue({ status: "conflict" });
    expect(await session.flush()).toEqual({ status: "conflict" });
    const evidence = session.exportRecovery();
    expect(await session.stage(checkpoint(2))).toEqual({ status: "not-ready" });
    expect(session.exportRecovery()).toEqual(evidence);
    const other = f.make(); await other.load();
    const key = { scope: "account-a", gameId: identity.gameId };
    const current = await f.local.read(key, new AbortController().signal);
    await f.local.write(key, current!.revision, current!.value, new AbortController().signal);
    expect(await other.stage(checkpoint(3))).toEqual({ status: "conflict" });
    expect(other.status().state).toBe("conflict");
  });

  it.each(["2.0.0", "invalid"])("never overwrites an unknown or malformed local journal (%s)", async version => {
    const f = fixture(); const raw = { type: "gameRecoveryJournal", version, future: "preserve" };
    f.records.set("account-a/prism-breaker", { revision: 1, value: raw });
    const session = f.make();
    expect((await session.load()).status).toBe(version === "2.0.0" ? "incompatible" : "invalid-data");
    expect(await session.stage(checkpoint())).toEqual({ status: "not-ready" });
    expect(await session.flush()).toEqual({ status: "not-ready" });
    expect(session.exportRecovery()).toEqual(raw);
    expect(f.local.write).not.toHaveBeenCalled(); expect(f.cloud.read).not.toHaveBeenCalled();
  });

  it("requires an explicit known migration and reuses game runtime restoration", async () => {
    const f = fixture(); vi.mocked(f.cloud.read).mockResolvedValue({ revision: "old", checkpoint: { ...checkpoint(), rulesVersion: "0.9.0" } });
    const migrated = vi.fn((old: GameCheckpoint) => {
      const runtime = createGameRuntime({ ...identity, initialState: () => ({ score: 0 }), parseState: value => value as { score: number }, step: state => ({ ...state }) },
        { seed: 42, players: ["p1"], migrations: { "0.9.0/1.0.0": state => state } });
      runtime.restore(old); return runtime.checkpoint();
    });
    const session = createSaveSession({ ...f.options, migrations: { "0.9.0/1.0.0": migrated } });
    expect((await session.load()).status).toBe("incompatible"); expect(migrated).not.toHaveBeenCalled();
    expect(await session.migrate()).toEqual({ status: "stored" }); expect(migrated).toHaveBeenCalledOnce();
    await session.flush(); expect(vi.mocked(f.cloud.write).mock.calls[0]?.[1].checkpoint.rulesVersion).toBe("1.0.0");
  });

  it("retains unsupported future game content and failed migrations", async () => {
    const f = fixture(); vi.mocked(f.cloud.read).mockResolvedValue({ revision: "future", checkpoint: { ...checkpoint(), contentVersion: "9.0.0" } });
    const session = f.make(); expect((await session.load()).status).toBe("incompatible");
    const before = session.exportRecovery(); expect(await session.migrate()).toEqual({ status: "not-ready" });
    expect(session.exportRecovery()).toEqual(before);
    const broken = createSaveSession({ ...f.options, migrations: { "1.0.0/9.0.0": () => { throw new Error("secret diagnostic"); } } });
    await broken.load(); expect(await broken.migrate()).toEqual({ status: "invalid" }); expect(broken.exportRecovery()).toEqual(before);
  });

  it("bounds data, detaches callers and rejects invalid input before storage", async () => {
    const f = fixture(); const session = f.make(); await session.load();
    const count = vi.mocked(f.local.write).mock.calls.length;
    for (const value of [null, { ...checkpoint(), gameId: "other" }, { ...checkpoint(), stateJson: "x".repeat(262145) }]) {
      expect(await session.stage(value)).toEqual({ status: "invalid" });
    }
    expect(f.local.write).toHaveBeenCalledTimes(count);
    const input = checkpoint(); const saving = session.stage(input); input.tick = 99; await saving;
    const copy = session.exportRecovery() as any; copy.staged.checkpointJson = "broken";
    await session.flush(); expect(vi.mocked(f.cloud.write).mock.calls[0]?.[1].checkpoint.tick).toBe(1);
  });

  it("isolates account changes and ignores late provider responses after disposal", async () => {
    const f = fixture(); const a = f.make(); await a.load(); await a.stage(checkpoint());
    const response = deferred<{ status: "saved"; revision: string }>(); const entered = deferred<void>();
    vi.mocked(f.cloud.write).mockImplementationOnce(async () => { entered.resolve(); return response.promise; });
    const pending = a.flush(); await entered.promise; a.dispose();
    expect(await pending).toEqual({ status: "disposed" });
    const b = f.make("account-b"); await b.load(); await b.stage(checkpoint(9));
    response.resolve({ status: "saved", revision: "old-account" }); await Promise.resolve();
    await b.flush();
    expect(vi.mocked(f.cloud.write).mock.calls.map(([key]) => key.scope)).toEqual(["account-a", "account-b"]);
    expect(a.status().state).toBe("disposed"); expect(await a.stage(checkpoint())).toEqual({ status: "disposed" });
  });

  it("times out a hung provider without clearing the uncertain attempt or leaking errors", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(); const session = f.make(); await session.load(); await session.stage(checkpoint());
      vi.mocked(f.cloud.write).mockImplementation(() => new Promise(() => {}));
      const flushing = session.flush(); await vi.advanceTimersByTimeAsync(26);
      expect(await flushing).toEqual({ status: "unavailable" });
      expect((session.exportRecovery() as any).attempt).toBeDefined();
      expect(vi.mocked(f.cloud.write).mock.calls[0]?.[2].aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("rejects invalid session configuration and unready operations", async () => {
    const f = fixture();
    for (const scope of ["", "a/b", "x".repeat(129)]) expect(() => f.make(scope)).toThrow("invalid-recovery-key");
    for (const timeoutMs of [0, NaN, 30_001]) expect(() => createSaveSession({ ...f.options, timeoutMs })).toThrow("invalid-recovery-timeout");
    const session = f.make(); expect(await session.stage(checkpoint())).toEqual({ status: "not-ready" });
    expect(await session.flush()).toEqual({ status: "not-ready" }); session.dispose();
    expect(await session.load()).toEqual({ status: "disposed", checkpoint: null });
  });

  it("does not report idle while a stage is still being persisted", async () => {
    const f = fixture(); const session = f.make(); await session.load();
    const release = deferred<void>(); const entered = deferred<void>(); const write = f.local.write;
    f.local.write = vi.fn(async (...args: Parameters<RecoveryStore["write"]>) => { entered.resolve(); await release.promise; return write(...args); });
    const saving = session.stage(checkpoint()); await entered.promise;
    expect(await session.flush()).toEqual({ status: "not-ready" });
    release.resolve(); await saving; expect(await session.flush()).toEqual({ status: "saved" });
  });

  it("preserves malformed cloud evidence, reports unavailable local commits and blocks unsafe writes", async () => {
    const f = fixture(); const raw = { revision: "r1", checkpoint: { future: true } };
    vi.mocked(f.cloud.read).mockResolvedValue(raw);
    const invalid = f.make(); expect((await invalid.load()).status).toBe("invalid-data");
    expect(invalid.exportRecovery()).toEqual(raw); expect(await invalid.stage(checkpoint())).toEqual({ status: "not-ready" });
    vi.mocked(f.cloud.read).mockResolvedValue({ revision: "r1", checkpoint: checkpoint() });
    vi.mocked(f.local.write).mockRejectedValue(new Error("disk unavailable"));
    const failed = f.make(); expect((await failed.load()).status).toBe("unavailable");
    expect(await failed.stage(checkpoint())).toEqual({ status: "not-ready" });
  });

  it("deduplicates concurrent flush/load calls and cancels pending stages on disposal", async () => {
    const f = fixture(); const session = f.make();
    const loading = session.load(); expect(session.load()).toBe(loading); await loading;
    await session.stage(checkpoint());
    const gate = deferred<void>(); const entered = deferred<void>();
    vi.mocked(f.cloud.write).mockImplementation(async () => { entered.resolve(); await gate.promise; return { status: "saved", revision: "r1" }; });
    const flushing = session.flush(); expect(session.flush()).toBe(flushing); await entered.promise;
    session.dispose(); expect(await flushing).toEqual({ status: "disposed" });
    expect(session.exportRecovery()).toBeNull(); gate.resolve();
    expect(await session.flush()).toEqual({ status: "disposed" }); expect(await session.migrate()).toEqual({ status: "disposed" });

    const other = f.make(); await other.load();
    const pendingWrite = deferred<void>(); const localEntered = deferred<void>();
    f.local.write = vi.fn(async () => { localEntered.resolve(); await pendingWrite.promise; return { status: "written" as const, revision: 9 }; });
    const one = other.stage(checkpoint(2)); await localEntered.promise;
    const two = other.stage(checkpoint(3)); other.dispose();
    expect(await one).toEqual({ status: "disposed" }); expect(await two).toEqual({ status: "disposed" }); pendingWrite.resolve();
  });

  it("preserves cloud changes, deletion and corrupt revision responses without uploading", async () => {
    const f = fixture(); const original = f.make(); await original.load(); await original.stage(checkpoint()); await original.flush();
    for (const remote of [null, { revision: "r1", checkpoint: checkpoint(2) }]) {
      vi.mocked(f.cloud.read).mockResolvedValue(remote);
      const session = f.make(); expect((await session.load()).status).toBe("conflict");
      expect(await session.flush()).toEqual({ status: "not-ready" });
    }
    vi.mocked(f.cloud.read).mockResolvedValue({ revision: "r2", checkpoint: checkpoint(2) });
    const changed = f.make(); expect(await changed.load()).toEqual({ status: "ready", checkpoint: checkpoint(2) });
    await changed.stage(checkpoint(3));
    vi.mocked(f.cloud.read).mockResolvedValue({ revision: "r3", checkpoint: checkpoint(4) });
    expect((await f.make().load()).status).toBe("conflict");
    vi.mocked(f.cloud.read).mockResolvedValue({ revision: "\n", checkpoint: checkpoint() });
    expect((await f.make().load()).status).toBe("invalid-data");
    expect(f.cloud.write).toHaveBeenCalledOnce();
  });

  it("retains the same attempt after failed acknowledgement persistence", async () => {
    const f = fixture(); const session = f.make(); await session.load(); await session.stage(checkpoint());
    const write = f.local.write; let calls = 0;
    f.local.write = vi.fn(async (...args: Parameters<RecoveryStore["write"]>) => {
      if (++calls === 2) throw new Error("ack lost"); return write(...args);
    });
    expect(await session.flush()).toEqual({ status: "unavailable" });
    expect(await session.flush()).toEqual({ status: "saved" });
    expect(vi.mocked(f.cloud.write).mock.calls[1]?.[1]).toEqual(vi.mocked(f.cloud.write).mock.calls[0]?.[1]);
  });

  it("rejects duplicate active operation IDs and bounds reentrant host callbacks", async () => {
    const f = fixture(); let session: ReturnType<typeof createSaveSession>;
    let nested: Promise<unknown> | undefined;
    session = createSaveSession({ ...f.options, operationId: () => {
      nested = session.stage(checkpoint(9)); return "same-id";
    } });
    await session.load();
    expect(await session.stage(checkpoint())).toEqual({ status: "stored" });
    expect(await nested).toEqual({ status: "not-ready" });
    expect(await session.stage(checkpoint(2))).toEqual({ status: "invalid" });
  });

  it("retains incompatible in-flight attempts without attempting a migration", async () => {
    const f = fixture(); const first = f.make(); await first.load(); await first.stage(checkpoint());
    vi.mocked(f.cloud.write).mockRejectedValue(new Error("offline")); await first.flush();
    const original = f.records.get("account-a/prism-breaker")!; const data = original.value as any;
    data.attempt.checkpointJson = JSON.stringify({ ...checkpoint(), rulesVersion: "0.9.0" });
    const migrate = vi.fn(() => checkpoint());
    const session = createSaveSession({ ...f.options, migrations: { "0.9.0/1.0.0": migrate } });
    expect((await session.load()).status).toBe("incompatible"); expect(await session.migrate()).toEqual({ status: "not-ready" });
    expect(migrate).not.toHaveBeenCalled(); expect(session.exportRecovery()).toEqual(data);
  });

  it("blocks malformed local envelopes and invalid provider results without losing stored evidence", async () => {
    for (const change of [
      (journal: any) => { journal.scope = "another"; },
      (journal: any) => { journal.staged.checkpointJson = JSON.stringify({ ...checkpoint(), gameId: "other" }); },
      (journal: any) => { journal.cloudRevision = "without-checkpoint"; },
      (journal: any) => { journal.attempt = { ...journal.staged }; },
    ]) {
      const f = fixture(); const first = f.make(); await first.load(); await first.stage(checkpoint());
      const record = f.records.get("account-a/prism-breaker")!; change(record.value);
      const session = f.make(); expect((await session.load()).status).toBe("invalid-data");
      expect(session.exportRecovery()).toEqual(record.value);
    }
    const f = fixture(); vi.mocked(f.local.read).mockRejectedValue(new Error("private error"));
    const failed = f.make(); expect(await failed.load()).toEqual({ status: "unavailable", checkpoint: null });
    expect(await failed.stage(checkpoint())).toEqual({ status: "not-ready" });
    vi.mocked(f.local.read).mockResolvedValue({ revision: -1, value: { kept: true } });
    expect((await f.make().load()).status).toBe("invalid-data");
    vi.mocked(f.local.read).mockResolvedValue(null);
    const invalid = f.make(); await invalid.load();
    vi.mocked(f.local.write).mockResolvedValue({ status: "written", revision: 0 });
    expect(await invalid.stage(checkpoint())).toEqual({ status: "unavailable" }); expect(invalid.status().state).toBe("invalid-data");
  });

  it("bounds non-cooperative cloud retries while local recovery remains available", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(); const session = f.make(); await session.load(); await session.stage(checkpoint());
      vi.mocked(f.cloud.write).mockImplementation(() => new Promise(() => {}));
      for (let attempt = 0; attempt < 4; attempt++) {
        const flushing = session.flush(); await vi.advanceTimersByTimeAsync(26);
        expect(await flushing).toEqual({ status: "unavailable" });
      }
      const rejected = session.flush(); await vi.advanceTimersByTimeAsync(26);
      expect(await rejected).toEqual({ status: "unavailable" });
      expect(f.cloud.write).toHaveBeenCalledTimes(4);
      expect(await session.stage(checkpoint(2))).toEqual({ status: "stored" });
      expect((session.exportRecovery() as any).staged).toBeDefined(); session.dispose();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
