import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { createBrowserRecoveryStore } from "../src/browser-recovery.js";

const key = { scope: "account-a", gameId: "prism-breaker" };
const signal = () => new AbortController().signal;

describe("native IndexedDB recovery transaction adapter", () => {
  it("persists detached records across instances and isolates accounts and games", async () => {
    const indexedDB = new IDBFactory(); const first = createBrowserRecoveryStore({ indexedDB });
    const value = { futureVersion: 42, payload: "preserve" };
    expect(await first.read(key, signal())).toBeNull();
    expect(await first.write(key, null, value, signal())).toEqual({ status: "written", revision: 1 });
    value.payload = "changed";
    const reopened = createBrowserRecoveryStore({ indexedDB });
    expect(await reopened.read(key, signal())).toEqual({ revision: 1, value: { futureVersion: 42, payload: "preserve" } });
    expect(await reopened.read({ ...key, scope: "account-b" }, signal())).toBeNull();
    expect(await reopened.read({ ...key, gameId: "vector-volley" }, signal())).toBeNull();
    first.dispose(); reopened.dispose();
  });

  it("makes concurrent tab compare-and-swap atomic", async () => {
    const indexedDB = new IDBFactory(); const a = createBrowserRecoveryStore({ indexedDB }); const b = createBrowserRecoveryStore({ indexedDB });
    const results = await Promise.all([a.write(key, null, { value: 1 }, signal()), b.write(key, null, { value: 2 }, signal())]);
    expect(results.map(x => x.status).sort()).toEqual(["conflict", "written"]);
    const saved = await a.read(key, signal()); expect(saved?.revision).toBe(1);
    expect(await b.write(key, 1, { value: 3 }, signal())).toEqual({ status: "written", revision: 2 });
    expect(await a.write(key, 1, { value: 4 }, signal())).toEqual({ status: "conflict" });
    expect((await a.read(key, signal()))?.value).toEqual({ value: 3 }); a.dispose(); b.dispose();
  });

  it("rejects invalid/oversized data, cancelled work and disposed access without deleting data", async () => {
    const indexedDB = new IDBFactory(); const store = createBrowserRecoveryStore({ indexedDB });
    await store.write(key, null, { kept: true }, signal());
    await expect(store.write(key, 1, { huge: "x".repeat(4 * 1024 * 1024) }, signal())).rejects.toThrow("recovery-too-large");
    await expect(store.write({ ...key, scope: "../another" }, null, {}, signal())).rejects.toThrow("invalid-recovery-key");
    const aborted = AbortSignal.abort(); await expect(store.write(key, 1, { lost: true }, aborted)).rejects.toThrow();
    expect((await store.read(key, signal()))?.value).toEqual({ kept: true }); store.dispose();
    await expect(store.read(key, signal())).rejects.toThrow();
    const next = createBrowserRecoveryStore({ indexedDB }); expect((await next.read(key, signal()))?.value).toEqual({ kept: true }); next.dispose();
  });

  it("preserves a newer database version instead of resetting or downgrading it", async () => {
    const indexedDB = new IDBFactory();
    const newer = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("plasius-game-recovery", 2);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => request.result.createObjectStore("future");
    }); newer.close();
    const store = createBrowserRecoveryStore({ indexedDB }); await expect(store.read(key, signal())).rejects.toThrow();
    const request = indexedDB.open("plasius-game-recovery");
    const reopened = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
    expect(reopened.version).toBe(2); expect([...reopened.objectStoreNames]).toEqual(["future"]); reopened.close(); store.dispose();
  });

  it("reports a transaction abort after request success and preserves the previous committed value", async () => {
    const indexedDB = new IDBFactory(); const store = createBrowserRecoveryStore({ indexedDB });
    await store.write(key, null, { kept: true }, signal());
    const put = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args) {
      const request = put.apply(this, args); request.addEventListener("success", () => this.transaction.abort()); return request;
    });
    try { await expect(store.write(key, 1, { lost: true }, signal())).rejects.toThrow("recovery-unavailable"); }
    finally { spy.mockRestore(); }
    expect((await store.read(key, signal()))?.value).toEqual({ kept: true }); store.dispose();
  });

  it("preserves data after a quota failure and rejects corrupt local revisions", async () => {
    const indexedDB = new IDBFactory(); const store = createBrowserRecoveryStore({ indexedDB });
    await store.write(key, null, { kept: true }, signal());
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => { throw new DOMException("private detail", "QuotaExceededError"); });
    try { await expect(store.write(key, 1, { lost: true }, signal())).rejects.toThrow("invalid-recovery-data"); }
    finally { spy.mockRestore(); }
    for (const revision of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER]) {
      await expect(store.write(key, revision, {}, signal())).rejects.toThrow("invalid-recovery-revision");
    }
    const request = indexedDB.open("plasius-game-recovery", 1);
    const db = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
    const tx = db.transaction("saves", "readwrite"); tx.objectStore("saves").put({ revision: 0, value: {} }, [key.scope, key.gameId]);
    await new Promise(resolve => { tx.oncomplete = resolve; }); db.close();
    await expect(store.read(key, signal())).rejects.toThrow("invalid-recovery-data");
    await expect(store.write(key, null, {}, signal())).rejects.toThrow("invalid-recovery-data"); store.dispose();
  });

  it("rejects missing object stores, unavailable storage, invalid names and non-JSON records", async () => {
    const indexedDB = new IDBFactory(); const request = indexedDB.open("plasius-game-recovery", 1);
    const db = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); }); db.close();
    const missing = createBrowserRecoveryStore({ indexedDB }); await expect(missing.read(key, signal())).rejects.toThrow("recovery-unavailable"); missing.dispose();
    const unavailable = createBrowserRecoveryStore(); await expect(unavailable.read(key, signal())).rejects.toThrow("recovery-unavailable");
    expect(() => createBrowserRecoveryStore({ databaseName: "../escape" })).toThrow("invalid-recovery-database");
    const broken = createBrowserRecoveryStore({ indexedDB: { open() { throw new Error("private provider failure"); } } as unknown as IDBFactory });
    await expect(broken.read(key, signal())).rejects.toThrow("recovery-unavailable");
    const good = createBrowserRecoveryStore({ indexedDB: new IDBFactory() });
    const circular: any = {}; circular.loop = circular;
    for (const value of [undefined, { value: undefined }, { value: NaN }, circular, { value: 1n }]) {
      await expect(good.write(key, null, value, signal())).rejects.toThrow("invalid-recovery-data");
    }
    good.dispose();
  });

  it("bounds unresponsive open requests even after deadlines, cancels callers and closes late connections", async () => {
    vi.useFakeTimers();
    try {
      const requests: any[] = [];
      const indexedDB = { open: vi.fn(() => { const request = {}; requests.push(request); return request; }) } as unknown as IDBFactory;
      const store = createBrowserRecoveryStore({ indexedDB, timeoutMs: 10 });
      const pending = Array.from({ length: 4 }, () => store.read(key, signal()).catch(e => e.message));
      await expect(store.read(key, signal())).rejects.toThrow("recovery-busy");
      await vi.advanceTimersByTimeAsync(11);
      expect(await Promise.all(pending)).toEqual(Array(4).fill("recovery-unavailable"));
      await expect(store.read(key, signal())).rejects.toThrow("recovery-busy");
      const close = vi.fn(); requests[0].result = { close }; requests[0].onsuccess(); expect(close).toHaveBeenCalledOnce();
      const next = store.read(key, signal()).catch(e => e.message); store.dispose(); expect(await next).toBe("recovery-cancelled");
      const abort = vi.fn(); requests[4].transaction = { abort }; requests[4].onupgradeneeded(); expect(abort).toHaveBeenCalledOnce();
      requests[4].onerror(); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("rejects a blocked open immediately and cancels an in-flight transaction", async () => {
    const request: any = {};
    const blocked = createBrowserRecoveryStore({ indexedDB: { open: () => request } as unknown as IDBFactory });
    const opening = blocked.read(key, signal()); request.onblocked();
    await expect(opening).rejects.toThrow("recovery-blocked"); blocked.dispose();
    const indexedDB = new IDBFactory(); const store = createBrowserRecoveryStore({ indexedDB });
    await store.write(key, null, { kept: true }, signal());
    const controller = new AbortController(); const get = IDBObjectStore.prototype.get;
    const spy = vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(function (this: IDBObjectStore, ...args) {
      const read = get.apply(this, args); read.addEventListener("success", () => controller.abort()); return read;
    });
    try { await expect(store.write(key, 1, { lost: true }, controller.signal)).rejects.toThrow("recovery-cancelled"); }
    finally { spy.mockRestore(); }
    expect((await store.read(key, signal()))?.value).toEqual({ kept: true }); store.dispose();
  });

  it("does not expose browser policy errors when IndexedDB access itself is denied", async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, get() { throw new DOMException("private browser policy", "SecurityError"); } });
    try {
      const store = createBrowserRecoveryStore();
      await expect(store.read(key, signal())).rejects.toThrow("recovery-unavailable"); store.dispose();
    } finally {
      if (previous) Object.defineProperty(globalThis, "indexedDB", previous);
      else Reflect.deleteProperty(globalThis, "indexedDB");
    }
  });
});
