/** Reproducible gameplay randomness. Never use this stream for security tokens. */
export interface RandomStream {
  next(): number;
  state(): number;
}

/** Create or resume a Mulberry32 stream from its complete unsigned 32-bit state. */
export function createRandom(seed: number): RandomStream {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("invalid-seed");
  let current = seed;
  return {
    state: () => current,
    next() {
      current = (current + 0x6d2b79f5) >>> 0;
      let value = Math.imul(current ^ (current >>> 15), current | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
    },
  };
}
