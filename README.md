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
proof of server authority or entitlement. Cloud conflict resolution and browser
recovery are separate work under Task #2.

The host evaluates stored `arcade.runtime.enabled` and backend capabilities.
There is no local/environment rollout override. Disabling the feature must
preserve saves. The core sends no telemetry or network requests; host adapters
own approved analytics/NFR collection and privacy controls.

## Development and release

Use Node from `.nvmrc`, then `npm ci`. Run `npm run typecheck`, `npm run lint`,
`npm run test:coverage`, `npm run build`, `npm run pack:check` and `npm run audit:npm`.
Tests and all coverage metrics must meet the 80% gate. ESM and CJS exports are
built from the same source. Only the exact runtime distribution and public
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
[contributing](CONTRIBUTING.md) and [security](SECURITY.md). Apache-2.0.
