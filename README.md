# @plasius/game-runtime

Deterministic, headless game lifecycle for Plasius spatial games. This foundation
provides fixed 60 Hz rules, bounded ordered input, reproducible gameplay random
streams and versioned checkpoints. It does not contain a playable game, renderer,
account system or multiplayer transport.

Tracked by [Task #1](https://github.com/Plasius-LTD/game-runtime/issues/1),
[site Feature #2384](https://github.com/Plasius-LTD/plasius-ltd-site/issues/2384)
and [Epic #2382](https://github.com/Plasius-LTD/plasius-ltd-site/issues/2382).
Package publication and site consumption remain separate delivery gates.

```ts
import { createGameRuntime } from "@plasius/game-runtime";

const runtime = createGameRuntime(gameRules, {
  seed: 42,
  players: ["p1"],
  ports: {
    render: (snapshot, alpha) => renderer.draw(snapshot, alpha),
  },
});

runtime.enqueue({
  type: "gameInput", version: "1.0.0", playerId: "p1",
  tick: 1, sequence: 1, axes: { x: 0, y: 0, z: 1 }, buttons: 0,
});
runtime.advance(1000 / 60);
const checkpoint = runtime.checkpoint();
runtime.restore(checkpoint);
runtime.dispose();
```

`gameRules` supplies stable game/rules/content identity, `initialState`, a strict
`parseState` validator (reuse `@plasius/schema`) and a pure `step`. Use only the
step's fixed delta and random stream; ambient randomness, wall time and I/O break
replay. Rules receive the current tick's inputs; missing input is neutral, not a
latched prior intention. `snapshot()` and host hooks receive detached values.
Hooks are synchronous handoffs. Async persistence/transport adapters must own
timeouts, cancellation, bounded queues, retries and account authorization.

`enqueue` returns a bounded decision code. Out-of-order delivery is accepted
within the configured future window; duplicate sequences, one player's conflicting
tick/sequence ordering, foreign slots and overfull queues are rejected. Axis
values are finite in [-1, 1]. Button masks are uint16. Player slots contain no
account identifiers. Never accept client scores or transforms as authoritative.

`advance` reports completed steps, discarded overload/interruption time, interpolation alpha
and presentation failure. Defaults allow five catch-up ticks, 256 queued inputs
and 120 future ticks. Hosts must qualify performance and stop server admission
on overload; discarded time is not proof of realtime capacity. Pause clears the
queue and fractional time. Solo browser adapters should pause on backgrounding;
one online client must not pause the authoritative session for everyone.

Calling `pause` or `dispose` from a hook ends the current batch immediately after
the last committed tick. A pause followed by a resume in the same callback also
ends that batch. Remaining elapsed time, including its fraction, is discarded;
the next explicit `advance` starts without hidden catch-up. Interrupted rules
and state validation do not commit their candidate state or random stream.

Hooks may read `snapshot`/`status` and call `pause`/`resume`/`dispose`. During a
rule, migration or host callback, nested `advance`, `restore` and `checkpoint`
calls throw `runtime-busy`, and `enqueue` returns `inactive`. Restore interrupted
by a lifecycle change throws `runtime-interrupted` without committing its
candidate. Lifecycle callbacks can change status, but nested lifecycle
notifications are suppressed; read `status()` for the final state. Disposal is
terminal and calls its cleanup hook once. Explicit checkpoint handoff failures
propagate so hosts cannot accidentally report a failed save as persisted.

Checkpoint state is JSON, limited to 256 KiB UTF-8; the complete envelope is
limited to 1 MiB. Restore validates identity, slots, sequence watermarks, queue
and game state before committing. For known older rules/content, supply an
explicit migration keyed by `sourceRulesVersion/sourceContentVersion`; its
output must validate under the current rules. Unknown versions remain rejected.
Keep the original checkpoint when restoration fails. A valid checkpoint is not
proof of server authority or entitlement.

## Browser controls and animation

Task [#7](https://github.com/Plasius-LTD/game-runtime/issues/7) adds the lazy
`/browser` subpath. Importing it or the root does not access browser globals.

```ts
const { createBrowserGameControls, createBrowserGameLoop } =
  await import("@plasius/game-runtime/browser");
const controls = createBrowserGameControls(aimingElement);
const runtime = createGameRuntime(gameRules, {
  seed: 42, players: ["p1"],
  ports: {
    sampleInput({ tick, players }) {
      const intentions = controls.sample();
      return players.map(({ playerId, sequence }) => ({
        type: "gameInput", version: "1.0.0", tick, playerId, sequence: sequence + 1,
        // This example game uses directional movement; target-based games map pointer instead.
        axes: { ...intentions.direction, z: 0 }, buttons: intentions.buttons,
      }));
    },
    render: (snapshot, alpha) => renderer.draw(snapshot, alpha),
  },
});
const loop = createBrowserGameLoop(runtime, {
  window, document,
  onSuspend: reason => { controls.clear(); showResumeOrReconnect(reason); },
  onError: code => showLocalGameError(code),
});
// Labelled native buttons provide touch, keyboard and assistive activation.
launchButton.onclick = () => controls.pulse(1);
leftButton.onclick = () => controls.nudge(-1, 0);
startButton.onclick = () => loop.start();
// On route/account teardown, release each owned adapter.
loop.dispose(); controls.dispose(); runtime.dispose();
```

`sampleInput` runs synchronously before every actual simulation tick, including
bounded catch-up, and never for discarded ticks. Context slots omit players with
queued commands for that tick; `sequence` is the last committed watermark.
Return at most one next-tick command per remaining slot. The existing schema,
roster, sequence and queue bounds apply to the whole batch. Invalid or throwing
samplers fault with `input-sampling-failed`, without committing the tick. Do not
return a Promise. Omitted input remains neutral and replay inputs are preserved.
Use this local sampler only for locally controlled slots; remote authority still
validates authenticated commands through its transport and `enqueue` boundary.

Controls return a detached absolute pointer target (or null), directional axes
and button mask. One primary touch/mouse/pen owns the aiming surface until up,
cancel or lost capture. X runs left-to-right and Y bottom-to-top. Arrows/WASD and
Space apply only when the aiming surface itself has focus; child controls and
browser shortcuts retain normal behavior. Quick Space presses and semantic
`pulse` activations are coalesced for one tick. `nudge` accepts -1, 0 or 1 per
axis. Focus loss, blur, hidden documents, `clear` and disposal discard intentions.

The host must supply `tabindex`, a translated accessible name, visible focus,
44 CSS-pixel semantic buttons, handedness/safe-area layout and non-drag controls.
Set `touch-action` only on the aiming area; retain page zoom. Game-specific
mapping must respect neutral missing inputs and use actual tick time for motion.

The loop starts explicitly and owns one animation frame at a time. Hidden tabs,
blur and pagehide pause **local simulation**, reset elapsed time and notify the
host. Visible/focused again does not restart it. For online games, present the
host's reconnect policy; this does not pause server authority. Stale cancelled
frames are ignored. Invalid timestamps/runtime/scheduling failures stop with a
bounded code and no retry. Notification callbacks cannot recursively restart.
An optional `AbortSignal` disposes the loop. Dispose leaves the caller's runtime
paused and does not delete saves or dispose external render/network resources.

The [browser design](docs/design/browser-input-lifecycle.md),
[ADR](docs/adrs/adr-0004-browser-input-lifecycle.md) and
[bounds TDR](docs/tdrs/tdr-0004-browser-input-bounds.md) describe ownership/tests.
After building, serve this repository locally and open `tests/browser/input.html`
for native controls/frame checks. It uses synthetic state only; real device and
gameplay qualification are separate. Keep artifacts in `output/playwright/`.

## Account save recovery

Task [#2](https://github.com/Plasius-LTD/game-runtime/issues/2) adds independent
`/saves` and `/browser-recovery` entry points. The root import remains headless.
Reuse the site's authenticated cloud adapter; this package adds no transport,
credentials or backend authorization. The host evaluates stored
`arcade.progress.enabled` and the backend capability before creating a session.

```ts
const { createSaveSession } = await import("@plasius/game-runtime/saves");
const { createBrowserRecoveryStore } = await import("@plasius/game-runtime/browser-recovery");
const local = createBrowserRecoveryStore();
const saves = createSaveSession({ scope: opaqueAccountScope, identity: gameIdentity,
  local, cloud: authenticatedCloudSaveAdapter, timeoutMs: 5000 });
const recovery = await saves.load();
// Present blocked/offline states and validate recovered game state with runtime.restore.
if (recovery.status === "ready" || recovery.status === "offline") {
  if (recovery.checkpoint) runtime.restore(recovery.checkpoint);
  const staged = await saves.stage(runtime.checkpoint());
  if (staged.status === "stored") {
    const upload = await saves.flush();
    // Handle unavailable/conflict outcomes: a local save is not a cloud acknowledgement.
    showSaveOutcome(upload.status);
  }
}
// On logout/account change, stop callbacks and release this account's session.
saves.dispose();
local.dispose();
```

Each session binds an immutable opaque account scope and game identity. Scopes
are 1–128 ASCII letters, digits, `_` or `-`; never use emails, credentials or
profile data. Checkpoints must contain game state only. Cloud adapters must
authenticate and authorize the passed scope server-side on every request, and
atomically deduplicate the operation ID **before** checking the expected cloud
revision. A repeat ID with different request content must be rejected. Injected
`operationId` functions must produce globally unique IDs across devices/tabs and
restarts; the default is native `crypto.randomUUID()`.

`load()` returns a detached checkpoint and a state. `ready` and `offline` permit
staging; `incompatible`, `invalid-data`, `conflict` and `unavailable` block writes.
`stage()` acknowledges a local commit with `stored`; it holds one active and one
latest pending stage, immediately resolving displaced pending calls as
`superseded`. `flush()` uploads one durable attempt, returning `saved`, `idle`,
`not-ready`, `conflict`, `unavailable` or `disposed`. Await `stage()` first;
flush during an unfinished stage returns `not-ready`. Concurrent load/flush
calls share the active promise. There is no automatic network retry.

An uncertain upload retains its ID, expected revision and checkpoint across
restarts. A later explicit flush replays that exact attempt before sending newer
staged progress. Acknowledgements preserve that newer progress. Local atomic
compare-and-swap and cloud revision conflicts block further writes without
selecting a winner. `exportRecovery()` returns bounded detached evidence for an
explicit host recovery decision; never log it. Dispose clears in-memory recovery
access and aborts pending calls, preserving stored data. An already committed
server request cannot be undone by cancellation and remains scoped to its
original account.

Only explicit `migrate()` invokes a supplied migration keyed by
`sourceRulesVersion/sourceContentVersion`. Reuse the game's `runtime.restore`
validation in that callback and return its current checkpoint. Unknown versions,
failed migrations and incompatible uncertain attempts remain preserved and
blocked. A valid envelope alone does not validate game state or score authority.

The native adapter uses IndexedDB database `plasius-game-recovery`, version 1,
store `saves`, with compound account/game keys and strict-durability transactions.
It acknowledges only transaction completion and never resets a future or broken
database. No public offline cache or fallback stores account saves. Browser
eviction, private browsing, device loss and user-cleared storage still apply;
cloud acknowledgement is required for cross-device recovery. Account partitions
prevent accidental cross-account access, not access by other scripts in the same
origin; keep credentials and personal data out of these records.

Recovery records are limited to 4 MiB UTF-8 in total, including JSON escaping and
up to three checkpoint copies. Existing 1 MiB checkpoint and 256 KiB state limits
also apply. Port deadlines default to 5 seconds and permit 10–30000 ms. Local and
cloud calls each admit at most four unresolved operations, retaining slots when
a provider ignores cancellation; cloud saturation leaves local staging available. The native
adapter admits at most four active/unresolved opens and rejects excess work with
`recovery-busy`. Timeout, unavailable/blocked storage, quota and abort failures
never trigger deletion. Rollback disables new work through the host flag and
preserves recovery records; no local environment override is provided.

The host evaluates stored `arcade.runtime.enabled` and backend capabilities.
There is no local/environment rollout override. Disabling the feature must
preserve saves. The core sends no telemetry or network requests; host adapters
own approved analytics/NFR collection and privacy controls.

## Development and release

Use Node from `.nvmrc`, then `npm ci`. Run `npm run typecheck`, `npm run lint`,
`npm run test:coverage`, `npm run build`, `npm run pack:check` and `npm run audit:npm`.
Tests and all coverage metrics must meet the 80% gate. ESM and CJS exports are
built from the same source. Build each entry sequentially after one clean to keep
declarations self-contained and the packed path allowlist exact. Only the exact runtime distribution and public
package metadata may enter the npm tarball; contributor records stay private.

The schema template supplies legal/tooling/privacy controls and two-phase,
exact-main OIDC `cd.yml`. CI uses repository-owned pushes in the `Public CI -
Quarantined` runner group. Admit only reviewed, protected/frozen workflow refs;
no fork execution or alternate hosted CI. Before CD, verify the trusted npm
publisher, release-preparation App and protected-branch-only `production`
environment. Publish only via approved `cd.yml` on `main`; never publish locally.
CD pins npm 11.6.2, validates Node 24.18.0 and npm >=11.5.1, and rechecks current
main before release mutation and again immediately before npm publication.
First registration remains gated by [Task #3](https://github.com/Plasius-LTD/game-runtime/issues/3);
the reviewed, default-off `first_publication` input permits only the initial
`0.1.0` registration after an anonymous registry request confirms absence.
The [first-publication design](docs/design/first-publication.md) describes the
temporary production credential, isolated sealed-artifact publication, required
owner action and permanent OIDC handover. Normal releases remain OIDC-only.
Credential creation and publication require the final operator step; approval
to prepare the route alone does not authorize either action.
No publication or ten-hour game qualification is claimed by this foundation.

See [design](docs/design/runtime-foundation.md),
[ADR 0001](docs/adrs/adr-0001-deterministic-headless-game-runtime.md),
[first-registration ADR](docs/adrs/adr-0002-one-time-first-publication.md),
[bounds TDR](docs/tdrs/tdr-0001-input-and-checkpoint-bounds.md),
[lifecycle boundaries](docs/design/runtime-reentrancy.md),
[save recovery](docs/design/account-save-recovery.md),
[save ADR](docs/adrs/adr-0003-account-save-recovery.md),
[save bounds TDR](docs/tdrs/tdr-0003-save-journal-bounds.md),
[contributing](CONTRIBUTING.md) and [security](SECURITY.md). Apache-2.0.

## Release notes

Add meaningful changes under `Unreleased`; the approved release pipeline alone
promotes versioned sections. Preparation and the merged-main check reuse
Schema's dependency-free `scripts/release-changelog.mjs`, reject placeholder or
empty release notes, and preserve published history on retries. See the
[release-note design](docs/design/release-notes.md) for the template revision
and validation contract. The first-registration and permanent OIDC handover
remain governed by the [publication route](docs/design/first-publication.md).
