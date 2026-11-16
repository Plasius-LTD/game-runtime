import { createSchema, field, type SchemaValidationContext } from "@plasius/schema";
import { parseCheckpoint, type GameCheckpoint } from "./contracts.js";

/** Opaque account partition, never an email address or a credential. */
export interface RecoveryKey { scope: string; gameId: string }
/** Local storage must compare and commit the revision in one transaction. */
export interface RecoveryStore {
  read(key: RecoveryKey, signal: AbortSignal): Promise<{ revision: number; value: unknown } | null>;
  write(key: RecoveryKey, expectedRevision: number | null, value: unknown, signal: AbortSignal):
    Promise<{ status: "written"; revision: number } | { status: "conflict" }>;
}
/** Cloud adapters authorize the scope and atomically deduplicate IDs before checking revisions. */
export interface CloudSaveStore {
  read(key: RecoveryKey, signal: AbortSignal): Promise<{ revision: string; checkpoint: unknown } | null>;
  write(key: RecoveryKey, attempt: { id: string; expectedRevision: string | null; checkpoint: GameCheckpoint }, signal: AbortSignal):
    Promise<{ status: "saved"; revision: string } | { status: "conflict" }>;
}
/** Maximum UTF-8 bytes retained in a recovery record. */
export const MAX_RECOVERY_BYTES = 4 * 1024 * 1024;
export interface StagedSave { id: string; checkpointJson: string }
export interface RecoveryJournal extends RecoveryKey {
  type: "gameRecoveryJournal";
  version: "1.0.0";
  cloudRevision?: string;
  lastCheckpointJson?: string;
  attempt?: StagedSave & { expectedRevision?: string };
  staged?: StagedSave;
}
const boundedId = (value: string) => /^[A-Za-z0-9_-]{1,128}$/.test(value);
const revisionField = () => field.string().validator(validCloudRevision);
const stagedShape = { id: field.string().validator(boundedId), checkpointJson: field.string().min(1).max(MAX_RECOVERY_BYTES) };
const journalSchema = createSchema({
  scope: field.string().validator(boundedId), gameId: field.string().validator(value => /^[a-z][a-z0-9-]{0,63}$/.test(value)),
  cloudRevision: revisionField().optional(), lastCheckpointJson: field.string().min(1).max(MAX_RECOVERY_BYTES).optional(),
  attempt: field.object({ ...stagedShape, expectedRevision: revisionField().optional() }).optional(),
  staged: field.object(stagedShape).optional(),
}, "gameRecoveryJournal", { version: "1.0.0", identity: "exact", unknownFields: "reject",
  schemaValidator: (_value: unknown, context?: SchemaValidationContext) => context?.wasProvided("type") === true && context.wasProvided("version") });

export function validCloudRevision(value: unknown): value is string {
  return typeof value === "string" && /^[\x21-\x7e]{1,256}$/.test(value);
}
export function validLocalRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}
export function parseRecoveryKey(key: RecoveryKey): RecoveryKey {
  if (!key || typeof key.scope !== "string" || !boundedId(key.scope)
    || typeof key.gameId !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(key.gameId)) throw new TypeError("invalid-recovery-key");
  return Object.freeze({ scope: key.scope, gameId: key.gameId });
}
export function parseOperationId(value: string): string {
  if (typeof value !== "string" || !boundedId(value)) throw new TypeError("invalid-operation-id");
  return value;
}
/** Detach bounded JSON without permitting silent serialization loss. */
export function copyRecovery(value: unknown): unknown {
  let json: string | undefined;
  try {
    json = JSON.stringify(value, (_key, item: unknown) => {
      if (item === undefined || typeof item === "function" || typeof item === "symbol" || typeof item === "bigint"
        || (typeof item === "number" && !Number.isFinite(item))) throw new Error();
      return item;
    });
  } catch { throw new TypeError("invalid-recovery-data"); }
  if (json === undefined) throw new TypeError("invalid-recovery-data");
  if (json.length > MAX_RECOVERY_BYTES || new TextEncoder().encode(json).byteLength > MAX_RECOVERY_BYTES) throw new RangeError("recovery-too-large");
  return JSON.parse(json);
}
export function parseJournal(raw: unknown, key: RecoveryKey): RecoveryJournal {
  const result = journalSchema.validate(raw);
  if (!result.valid) throw new TypeError("invalid-recovery-data");
  const value = result.value as unknown as RecoveryJournal;
  if (value.scope !== key.scope || value.gameId !== key.gameId) throw new TypeError("invalid-recovery-data");
  for (const checkpoint of [value.lastCheckpointJson, value.attempt?.checkpointJson, value.staged?.checkpointJson]) {
    if (checkpoint !== undefined && parseCheckpoint(checkpoint).gameId !== key.gameId) throw new TypeError("invalid-recovery-data");
  }
  if ((value.cloudRevision === undefined) !== (value.lastCheckpointJson === undefined)
    || (value.attempt && value.attempt.expectedRevision !== value.cloudRevision)
    || (value.attempt && value.attempt.id === value.staged?.id)) throw new TypeError("invalid-recovery-data");
  return copyRecovery(value) as RecoveryJournal;
}
export function latestCheckpoint(journal: RecoveryJournal): GameCheckpoint | null {
  const json = journal.staged?.checkpointJson ?? journal.attempt?.checkpointJson ?? journal.lastCheckpointJson;
  return json === undefined ? null : parseCheckpoint(json);
}
export function isFutureJournal(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const value = raw as Record<string, unknown>;
  return value.type === "gameRecoveryJournal" && typeof value.version === "string"
    && /^\d+\.\d+\.\d+$/.test(value.version) && value.version !== "1.0.0";
}
