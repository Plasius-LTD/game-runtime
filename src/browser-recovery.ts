import { copyRecovery, parseRecoveryKey, validLocalRevision, type RecoveryKey, type RecoveryStore } from "./save-contracts.js";
import { parseRecoveryTimeout } from "./save-operations.js";

/** Native IndexedDB configuration; no global storage is accessed until construction. */
export interface BrowserRecoveryOptions {
  indexedDB?: IDBFactory;
  databaseName?: string;
  timeoutMs?: number;
}
type RecordValue = { revision: number; value: unknown };
type WriteResult = Awaited<ReturnType<RecoveryStore["write"]>>;

/** Atomic account/game recovery; failed or future databases are never deleted or reset. */
export function createBrowserRecoveryStore(options: BrowserRecoveryOptions = {}): RecoveryStore & { dispose(): void } {
  const timeoutMs = parseRecoveryTimeout(options.timeoutMs);
  const databaseName = options.databaseName ?? "plasius-game-recovery";
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(databaseName)) throw new TypeError("invalid-recovery-database");
  let factory: IDBFactory | undefined;
  try { factory = options.indexedDB ?? globalThis.indexedDB; } catch { /* Browser storage policy can deny access. */ }
  const active = new Set<() => void>();
  let opening = 0;
  let disposed = false;
  const execute = <T>(key: RecoveryKey, signal: AbortSignal, mutation?: { revision: number | null; value: unknown }): Promise<T> => {
    if (disposed || signal.aborted) return Promise.reject(new Error("recovery-cancelled"));
    if (!factory) return Promise.reject(new Error("recovery-unavailable"));
    // Bound callers as well as stored bytes; the session normally uses at most two slots.
    if (active.size >= 4 || opening >= 4) return Promise.reject(new Error("recovery-busy"));
    return new Promise<T>((resolve, reject) => {
      let db: IDBDatabase | undefined;
      let tx: IDBTransaction | undefined;
      let request: IDBOpenDBRequest | undefined;
      let finished = false;
      let result: RecordValue | WriteResult | null = null;
      const finish = (error?: string) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        active.delete(cancel);
        if (error) {
          try { (tx ?? request?.transaction)?.abort(); } catch { /* Already committed/aborted. */ }
        }
        db?.close();
        if (error) reject(new Error(error)); else resolve(result as T);
      };
      const cancel = () => finish("recovery-cancelled");
      const timer = setTimeout(() => finish("recovery-unavailable"), timeoutMs);
      active.add(cancel);
      signal.addEventListener("abort", cancel, { once: true });
      try {
        request = factory.open(databaseName, 1);
        opening++;
        request.onerror = () => { opening--; finish("recovery-unavailable"); };
        request.onblocked = () => finish("recovery-blocked");
        request.onupgradeneeded = () => {
          if (finished) { request!.transaction!.abort(); return; }
          request!.result.createObjectStore("saves");
        };
        request.onsuccess = () => {
          opening--;
          db = request!.result;
          if (finished) { db.close(); return; }
          db.onversionchange = () => finish("recovery-unavailable");
          db.onclose = () => finish("recovery-unavailable");
          try {
            tx = db.transaction("saves", mutation ? "readwrite" : "readonly", { durability: "strict" });
            tx.onabort = () => finish("recovery-unavailable");
            tx.onerror = () => finish("recovery-unavailable");
            // Request success is insufficient: acknowledge only the committed transaction.
            tx.oncomplete = () => finish();
            const store = tx.objectStore("saves");
            const requestKey = [key.scope, key.gameId];
            const read = store.get(requestKey);
            read.onsuccess = () => {
              try {
                const record = read.result as RecordValue | undefined;
                if (record !== undefined && (!record || !validLocalRevision(record.revision)
                  || Object.keys(record).length !== 2 || !Object.hasOwn(record, "value"))) throw new Error();
                if (!mutation) result = record === undefined ? null : { revision: record.revision, value: copyRecovery(record.value) };
                else if ((record?.revision ?? null) !== mutation.revision) result = { status: "conflict" };
                else {
                  const revision = (mutation.revision ?? 0) + 1;
                  store.put({ revision, value: mutation.value }, requestKey);
                  result = { status: "written", revision };
                }
              } catch { finish("invalid-recovery-data"); }
            };
          } catch { finish("recovery-unavailable"); }
        };
      } catch { finish("recovery-unavailable"); }
    });
  };
  return {
    async read(key, signal) { return execute<RecordValue | null>(parseRecoveryKey(key), signal); },
    async write(key, expectedRevision, value, signal) {
      const parsedKey = parseRecoveryKey(key);
      if (expectedRevision !== null && (!validLocalRevision(expectedRevision) || expectedRevision === Number.MAX_SAFE_INTEGER)) {
        throw new TypeError("invalid-recovery-revision");
      }
      return execute<WriteResult>(parsedKey, signal, { revision: expectedRevision, value: copyRecovery(value) });
    },
    dispose() { disposed = true; for (const cancel of active) cancel(); },
  };
}
