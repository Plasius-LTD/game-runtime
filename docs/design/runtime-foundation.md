# Deterministic runtime foundation

Execution source: [Task #1](https://github.com/Plasius-LTD/game-runtime/issues/1),
site Story #2416 / Feature #2384 / Epic #2382. Host rollout control:
`arcade.runtime.enabled`, initially disabled. This library never grants access.

## Contract and acceptance

Provide a portable fixed 60 Hz host for pure game rules, a reproducible uint32
random stream, strict bounded input envelopes, and versioned checkpoints using
released `@plasius/schema`. The same rules execute in browser and authority
processes. Framework, GPU, network, account and storage providers are injected;
importing the core must not touch browser globals or open network connections.

Inputs are complete intentions for a particular tick, never authoritative scores
or transforms. Only configured player slots are accepted (one to four slots,
no account identifiers). Accept out-of-order arrival within a bounded future
window, order by tick/slot/sequence, reject replayed or contradictory ordering,
and bound the total pending queue. A missing tick input is neutral: rules must
not implicitly retain a previous intention. Every accepted input is detached
from the caller. Reject input while paused, faulted or disposed.

Advance by elapsed milliseconds, with bounded catch-up and explicit discarded
time. Wall-clock elapsed time never changes a rule's fixed timestep. Pausing
clears queued intentions and fractional elapsed time; callers resume explicitly.
Snapshots are detached from internal state. Reducer failure faults the host;
optional presentation hooks are isolated and cannot change simulation progress.
Disposal is idempotent and prevents subsequent work.

Checkpoints preserve exact game/rules/content identity, logical tick, random
state, player sequence watermarks, queued intentions and bounded JSON state.
Restore validates the entire candidate before mutation, including its queue and
game-owned state validator. Unsupported versions are preserved by the caller,
never silently reset. Explicit migrations are a game-owned allowlisted mapping
from a known older rules version, followed by current validation. Content-version
changes require explicit migration too. The source checkpoint remains untouched.

Tests are defined before implementation for deterministic replay across frame
groupings, randomness and snapshot restore, malformed/extra/nonfinite input,
reordered/duplicate/stale/future/overfull input, foreign player rejection, pause,
bounded catch-up, detached snapshots, lifecycle failures, disposal, version
rejection and successful/failed migration without data loss. Coverage is at least
80% across statements, branches, functions and lines, including every source file.

This Task does not implement IndexedDB, cloud save conflicts, transport, a GPU
renderer, matchmaking, any finished game or ten-hour qualification. Those remain
separate tracked work. No runtime telemetry transport is included; host-owned
analytics/NFR adapters own approved events and retention.
