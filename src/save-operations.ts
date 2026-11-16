export function parseRecoveryTimeout(value = 5000): number {
  if (!Number.isInteger(value) || value < 10 || value > 30_000) throw new RangeError("invalid-recovery-timeout");
  return value;
}

/** Race even a non-cooperative port; late completions cannot publish a result. */
export function createSaveOperations(timeoutMs: number) {
  const active = new Set<AbortController>();
  let disposed = false;
  let unsettled = 0;
  return {
    run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
      if (disposed) return Promise.reject(new Error("disposed"));
      if (unsettled >= 4) return Promise.reject(new Error("unavailable"));
      unsettled++;
      return new Promise<T>((resolve, reject) => {
        const controller = new AbortController();
        active.add(controller);
        let finished = false;
        const finish = (value: T | undefined, error?: string) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          controller.signal.removeEventListener("abort", abort);
          active.delete(controller);
          if (error) reject(new Error(error)); else resolve(value as T);
        };
        const abort = () => finish(undefined, disposed ? "disposed" : "unavailable");
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        controller.signal.addEventListener("abort", abort, { once: true });
        Promise.resolve().then(() => {
          if (controller.signal.aborted) throw new Error();
          return operation(controller.signal);
        }).then(value => { unsettled--; finish(value); }, () => { unsettled--; finish(undefined, "unavailable"); });
      });
    },
    dispose() { disposed = true; for (const controller of active) controller.abort(); },
  };
}
