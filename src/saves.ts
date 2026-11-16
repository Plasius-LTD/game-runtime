import { parseCheckpoint, parseIdentity, type GameCheckpoint, type GameIdentity } from "./contracts.js";
import { copyRecovery, isFutureJournal, latestCheckpoint, parseJournal, parseOperationId, parseRecoveryKey,
  validCloudRevision, validLocalRevision, type CloudSaveStore, type RecoveryJournal, type RecoveryStore, type StagedSave } from "./save-contracts.js";
import { createSaveOperations, parseRecoveryTimeout } from "./save-operations.js";
export type { RecoveryKey, RecoveryStore, CloudSaveStore } from "./save-contracts.js";
export { MAX_RECOVERY_BYTES } from "./save-contracts.js";

/** A blocked session preserves evidence and requires a new explicit host recovery decision. */
export type SaveState = "new" | "loading" | "ready" | "offline" | "incompatible" | "invalid-data" | "conflict" | "unavailable" | "disposed";
export type StageOutcome = { status: "stored" | "superseded" | "conflict" | "not-ready" | "invalid" | "unavailable" | "disposed" };
export type FlushOutcome = { status: "saved" | "idle" | "conflict" | "not-ready" | "unavailable" | "disposed" };
export interface SaveSessionOptions {
  scope: string;
  identity: GameIdentity;
  local: RecoveryStore;
  cloud: CloudSaveStore;
  /** Must produce a globally unique ID across tabs, devices and restarts. Defaults to crypto.randomUUID. */
  operationId?: () => string;
  /** Each port call has this deadline (10–30000 ms); no automatic retry. */
  timeoutMs?: number;
  /** Explicit source rules/content migrations; reuse the game's runtime.restore validation. */
  migrations?: Readonly<Record<string, (checkpoint: GameCheckpoint) => GameCheckpoint>>;
}

/** Bind one account and game for the entire lifetime; dispose on logout or account switch. */
export function createSaveSession(options: SaveSessionOptions) {
  const identity = parseIdentity(options.identity);
  const key = parseRecoveryKey({ scope: options.scope, gameId: identity.gameId });
  const timeoutMs = parseRecoveryTimeout(options.timeoutMs);
  const localOperations = createSaveOperations(timeoutMs);
  const cloudOperations = createSaveOperations(timeoutMs);
  const local = options.local;
  const cloud = options.cloud;
  const operationId = options.operationId ?? (() => globalThis.crypto.randomUUID());
  const migrations = { ...options.migrations };
  let state: SaveState = "new";
  let journal: RecoveryJournal = { type: "gameRecoveryJournal", version: "1.0.0", ...key };
  let revision: number | null = null;
  let evidence: unknown = null;
  let localTail = Promise.resolve();
  let loading: Promise<{ status: SaveState; checkpoint: GameCheckpoint | null }> | undefined;
  let flushing: Promise<FlushOutcome> | undefined;
  let staging = false;
  let creatingSave = false;
  let activeSaveId: string | undefined;
  let migrating = false;
  let pending: { save: StagedSave; resolve: (result: StageOutcome) => void } | undefined;
  const disposed = () => state === "disposed";
  const invalidData = () => state === "invalid-data";
  const writable = () => state === "ready" || state === "offline";
  const compatible = (checkpoint: GameCheckpoint | null) => !checkpoint ||
    (checkpoint.rulesVersion === identity.rulesVersion && checkpoint.contentVersion === identity.contentVersion);
  const failure = (): "disposed" | "conflict" | "unavailable" => disposed() ? "disposed" : state === "conflict" ? "conflict" : "unavailable";
  const current = () => latestCheckpoint(journal);
  const newSave = (raw: unknown): StagedSave => {
    creatingSave = true;
    try {
      const checkpoint = parseCheckpoint(raw);
      if (checkpoint.gameId !== key.gameId || !compatible(checkpoint)) throw new Error();
      const id = parseOperationId(operationId());
      if (id === journal.staged?.id || id === journal.attempt?.id || id === pending?.save.id || id === activeSaveId) throw new Error();
      return { id, checkpointJson: JSON.stringify(checkpoint) };
    } finally { creatingSave = false; }
  };
  // Only the active stage, one flush and one exclusive load/migration can enqueue here.
  const persist = (change: (value: RecoveryJournal) => RecoveryJournal) => {
    const work = localTail.then(async () => {
      if (disposed() || state === "conflict" || state === "invalid-data") throw new Error();
      const next = parseJournal(change(copyRecovery(journal) as RecoveryJournal), key);
      const result = await localOperations.run(signal => local.write(key, revision, copyRecovery(next), signal));
      if (disposed()) throw new Error();
      if (result?.status === "conflict") { state = "conflict"; throw new Error(); }
      if (result?.status !== "written" || !validLocalRevision(result.revision) || result.revision <= (revision ?? 0)) {
        state = "invalid-data"; throw new Error();
      }
      revision = result.revision; journal = next; evidence = copyRecovery(next);
    });
    localTail = work.catch(() => {});
    return work;
  };
  const storeStage = async (save: StagedSave): Promise<StageOutcome> => {
    try {
      await persist(value => ({ ...value, staged: save }));
      return { status: "stored" };
    } catch { return { status: failure() }; }
  };
  const drainStages = async (save: StagedSave): Promise<StageOutcome> => {
    staging = true;
    activeSaveId = save.id;
    const outcome = await storeStage(save);
    // Hand off at most one waiting stage; replacing it resolves the old caller immediately.
    const next = pending; pending = undefined;
    staging = false;
    activeSaveId = undefined;
    if (next) {
      if (disposed() || !writable()) next.resolve({ status: disposed() ? "disposed" : "not-ready" });
      else void drainStages(next.save).then(next.resolve);
    }
    return outcome;
  };
  const stage = (raw: unknown): Promise<StageOutcome> => {
    if (disposed()) return Promise.resolve({ status: "disposed" });
    if (!writable() || migrating || creatingSave) return Promise.resolve({ status: "not-ready" });
    let save: StagedSave;
    try { save = newSave(raw); } catch { return Promise.resolve({ status: "invalid" }); }
    if (!staging) return drainStages(save);
    pending?.resolve({ status: "superseded" });
    return new Promise(resolve => { pending = { save, resolve }; });
  };
  const loadOnce = async (): Promise<{ status: SaveState; checkpoint: GameCheckpoint | null }> => {
    state = "loading";
    try {
      const record = await localOperations.run(signal => local.read(key, signal));
      if (disposed()) return { status: "disposed", checkpoint: null };
      if (record !== null) {
        // Preserve the bounded original before interpreting its envelope.
        evidence = copyRecovery(record.value);
        if (!validLocalRevision(record.revision)) { state = "invalid-data"; return { status: state, checkpoint: null }; }
        revision = record.revision;
        if (isFutureJournal(evidence)) { state = "incompatible"; return { status: state, checkpoint: null }; }
        try { journal = parseJournal(evidence, key); }
        catch { state = "invalid-data"; return { status: state, checkpoint: null }; }
        if (!compatible(current()) || (journal.attempt && !compatible(parseCheckpoint(journal.attempt.checkpointJson)))) {
          state = "incompatible"; return { status: state, checkpoint: current() };
        }
      }
    } catch { if (!disposed()) state = "unavailable"; return { status: state, checkpoint: null }; }
    let remote: Awaited<ReturnType<CloudSaveStore["read"]>>;
    try { remote = await cloudOperations.run(signal => cloud.read(key, signal)); }
    catch { if (!disposed()) state = "offline"; return { status: state, checkpoint: disposed() ? null : current() }; }
    if (disposed()) return { status: "disposed", checkpoint: null };
    let remoteCheckpoint: GameCheckpoint | null;
    try {
      if (evidence === null && remote !== null) evidence = copyRecovery(remote);
      remoteCheckpoint = remote === null ? null : parseCheckpoint(remote.checkpoint);
      if (remote !== null && (!validCloudRevision(remote.revision) || remoteCheckpoint!.gameId !== key.gameId)) throw new Error();
    } catch { state = "invalid-data"; return { status: state, checkpoint: current() }; }
    try {
      if (journal.attempt) {
        // An uncertain server commit may already have changed the remote revision.
        // Replay the exact ID before interpreting a newer read as a conflict.
        state = "ready";
      } else if ((journal.staged || remote === null) && (remote?.revision !== journal.cloudRevision)) {
        state = "conflict";
      } else if (remote !== null) {
        if (journal.cloudRevision === remote.revision && journal.lastCheckpointJson !== JSON.stringify(remoteCheckpoint)) {
          state = "conflict";
        } else {
          if (journal.cloudRevision !== remote.revision) {
            await persist(value => ({ ...value, cloudRevision: remote!.revision, lastCheckpointJson: JSON.stringify(remoteCheckpoint) }));
          }
          state = compatible(current()) ? "ready" : "incompatible";
        }
      } else state = "ready";
    } catch { if (!disposed() && state !== "conflict" && !invalidData()) state = "unavailable"; }
    return { status: state, checkpoint: disposed() ? null : current() };
  };
  const load = () => {
    if (disposed()) return Promise.resolve({ status: "disposed" as const, checkpoint: null });
    if (loading) return loading;
    if (state !== "new") return Promise.resolve({ status: state, checkpoint: current() });
    loading = loadOnce().finally(() => { loading = undefined; });
    return loading;
  };
  const flushOnce = async (): Promise<FlushOutcome> => {
    try {
      if (!journal.attempt) {
        if (!journal.staged) return { status: "idle" };
        await persist(value => {
          const attempt = { ...value.staged!, ...(value.cloudRevision === undefined ? {} : { expectedRevision: value.cloudRevision }) };
          delete value.staged;
          return { ...value, attempt };
        });
      }
      const attempt = journal.attempt!;
      const result = await cloudOperations.run(signal => cloud.write(key, {
        id: attempt.id, expectedRevision: attempt.expectedRevision ?? null, checkpoint: parseCheckpoint(attempt.checkpointJson),
      }, signal));
      if (disposed()) return { status: "disposed" };
      if (result?.status === "conflict") { state = "conflict"; return { status: "conflict" }; }
      if (result?.status !== "saved" || !validCloudRevision(result.revision)) throw new Error();
      const cloudRevision = result.revision;
      await persist(value => {
        if (value.attempt?.id !== attempt.id) throw new Error();
        delete value.attempt;
        return { ...value, cloudRevision, lastCheckpointJson: attempt.checkpointJson };
      });
      state = "ready";
      return { status: "saved" };
    } catch { return { status: failure() }; }
  };
  const flush = (): Promise<FlushOutcome> => {
    if (disposed()) return Promise.resolve({ status: "disposed" });
    if (!writable() || migrating || creatingSave) return Promise.resolve({ status: "not-ready" });
    if (flushing) return flushing;
    if (staging) return Promise.resolve({ status: "not-ready" });
    flushing = flushOnce().finally(() => { flushing = undefined; });
    return flushing;
  };
  const migrate = async (): Promise<StageOutcome> => {
    if (disposed()) return { status: "disposed" };
    const checkpoint = current();
    if (state !== "incompatible" || !checkpoint || journal.attempt || migrating) return { status: "not-ready" };
    const migration = migrations[`${checkpoint.rulesVersion}/${checkpoint.contentVersion}`];
    if (!migration) return { status: "not-ready" };
    migrating = true;
    try {
      const save = newSave(migration(checkpoint));
      if (disposed()) return { status: "disposed" };
      const result = await storeStage(save);
      if (result.status === "stored") state = "ready";
      return result;
    } catch { return { status: "invalid" }; }
    finally { migrating = false; }
  };
  return {
    load, stage, flush, migrate,
    /** A detached bounded record for explicit host recovery; never log its contents. */
    exportRecovery: () => evidence === null ? null : copyRecovery(evidence),
    status: () => ({ state, staged: journal.staged !== undefined, inFlight: flushing !== undefined }),
    dispose() {
      state = "disposed"; localOperations.dispose(); cloudOperations.dispose(); pending?.resolve({ status: "disposed" }); pending = undefined;
      evidence = null; journal = { type: "gameRecoveryJournal", version: "1.0.0", ...key };
    },
  };
}
