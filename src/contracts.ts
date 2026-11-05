import { createSchema, field, type SchemaValidationContext } from "@plasius/schema";

/** Per-tick intentions. Player IDs are host-issued slots, not account identities. */
export interface GameInput {
  type: "gameInput";
  version: "1.0.0";
  tick: number;
  sequence: number;
  playerId: string;
  axes: { x: number; y: number; z: number };
  buttons: number;
}

/** Identity is pinned for replay and rankings; versions are not interchangeable. */
export interface GameIdentity {
  gameId: string;
  rulesVersion: string;
  contentVersion: string;
}

/** Portable, bounded, untrusted checkpoint. Hosts own account authorization. */
export interface GameCheckpoint extends GameIdentity {
  type: "gameCheckpoint";
  version: "1.0.0";
  tick: number;
  randomState: number;
  stateJson: string;
  players: { playerId: string; sequence: number }[];
  pending: GameInput[];
}

export const MAX_STATE_BYTES = 256 * 1024;
export const MAX_CHECKPOINT_BYTES = 1024 * 1024;
const encoder = new TextEncoder();
const integer = (min: number, max = Number.MAX_SAFE_INTEGER) =>
  field.number().validator((value) => Number.isSafeInteger(value) && value >= min && value <= max);
const slot = () => field.string().validator((value) => /^[a-zA-Z0-9_-]{1,32}$/.test(value));
const axis = () => field.number().validator((value) => Number.isFinite(value) && value >= -1 && value <= 1);
const identityShape = {
  gameId: field.string().validator((value) => /^[a-z][a-z0-9-]{0,63}$/.test(value)),
  rulesVersion: field.version().max(64),
  contentVersion: field.version().max(64),
};
const inputShape = {
  tick: integer(0), sequence: integer(0), playerId: slot(),
  axes: field.object({ x: axis(), y: axis(), z: axis() }), buttons: integer(0, 65535),
};
const exact = { version: "1.0.0", unknownFields: "reject", identity: "exact" } as const;
const envelope = { ...exact, schemaValidator: (_value: unknown, context?: SchemaValidationContext) =>
  context?.wasProvided("type") === true && context.wasProvided("version") };
const identitySchema = createSchema(identityShape, "gameIdentity", exact);
const inputSchema = createSchema(inputShape, "gameInput", envelope);
const checkpointSchema = createSchema({
  ...identityShape, tick: integer(0), randomState: integer(0, 0xffffffff),
  stateJson: field.string().min(1).max(MAX_STATE_BYTES),
  players: field.array(field.object({ playerId: slot(), sequence: integer(-1) })).min(1).max(4),
  pending: field.array(field.object({
    type: field.string().enum(["gameInput"]), version: field.string().enum(["1.0.0"]), ...inputShape,
  })).max(4096),
}, "gameCheckpoint", envelope);

/** Validate a game identity without accepting undeclared fields. */
export function parseIdentity(value: GameIdentity): GameIdentity {
  const result = identitySchema.validate(value);
  if (!result.valid) throw new TypeError("invalid-identity");
  return { gameId: value.gameId, rulesVersion: value.rulesVersion, contentVersion: value.contentVersion };
}

/** Strict schema validation returns detached, normalized input or a bounded error. */
export function parseInput(value: unknown): GameInput {
  const result = inputSchema.validate(value);
  if (!result.valid) throw new TypeError("invalid-input");
  return result.value as unknown as GameInput;
}

/** Parse a bounded checkpoint without mutating, migrating or trusting its score. */
export function parseCheckpoint(raw: unknown): GameCheckpoint {
  let candidate = raw;
  if (typeof raw === "string") {
    if (encoder.encode(raw).byteLength > MAX_CHECKPOINT_BYTES) throw new RangeError("checkpoint-too-large");
    try { candidate = JSON.parse(raw); } catch { throw new TypeError("invalid-checkpoint"); }
  }
  const result = checkpointSchema.validate(candidate);
  if (!result.valid) throw new TypeError("invalid-checkpoint");
  const value = result.value as unknown as GameCheckpoint;
  if (encoder.encode(value.stateJson).byteLength > MAX_STATE_BYTES
    || encoder.encode(JSON.stringify(value)).byteLength > MAX_CHECKPOINT_BYTES) throw new RangeError("checkpoint-too-large");
  return value;
}

/** JSON-only state is bounded before it crosses a host persistence boundary. */
export function serializeState(state: unknown): string {
  let value: string | undefined;
  try {
    value = JSON.stringify(state, (_key, item: unknown) => {
      if (typeof item === "number" && !Number.isFinite(item)) throw new TypeError();
      if (item === undefined || typeof item === "bigint" || typeof item === "function" || typeof item === "symbol") throw new TypeError();
      return item;
    });
  } catch { throw new TypeError("invalid-state"); }
  if (value === undefined) throw new TypeError("invalid-state");
  if (encoder.encode(value).byteLength > MAX_STATE_BYTES) throw new RangeError("state-too-large");
  return value;
}
