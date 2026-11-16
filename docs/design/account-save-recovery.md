# Account-scoped game save recovery

Work: game-runtime #2; site Story #2418, Feature #2386, Epic #2382.
Host rollout: stored `arcade.progress.enabled`, initially disabled. Backend
capabilities/authentication own account access; this library grants none.

## Existing package assessment

Reuse the current game-runtime checkpoint parser and explicit rule/content
migrations, and released `@plasius/schema` for envelope validation. Existing
`@plasius/storage` owns Node-only Azure storage and immutable asset/packet
mechanics; it provides no browser recovery transaction. `@plasius/offline-cache`
owns public responses and explicitly excludes authenticated requests. Neither
is an account-save store. Do not put checkpoints or credentials in that public
cache. The approved arcade architecture assigns browser recovery to game-runtime
and the authenticated cloud adapter to the site.

## Interfaces and ownership

Add a portable `/saves` subpath with a session bound immutably to one opaque
account scope and one game identity. Hosts dispose it on logout/account change
and create a new session; no mutable global account or credential is captured.
Injected cloud ports receive that exact scope on every request and must verify
the authenticated subject server-side. The site owns transport, capabilities,
conditional revisions and idempotent transactional storage.

The local port supports read and atomic compare-and-swap. Add a lazy
`/browser-recovery` subpath implementing that port with native IndexedDB
transactions. It stores only bounded game recovery records under account/game
keys, never credentials, account profile data or telemetry. IndexedDB failures
remain failures; there is no unpartitioned fallback or database deletion.

## Durable journal

The versioned journal contains the last acknowledged cloud revision/checkpoint,
one immutable in-flight save attempt and at most one newer staged checkpoint.
Each attempt has an idempotency ID and the expected cloud revision. Persist it
locally before a cloud write. A timeout can leave the server outcome unknown;
retry exactly that persisted attempt before considering a newer staged save.
Never generate a new ID for the same uncertain request.

Stage writes serialize, retaining only the latest pending checkpoint. Superseded
callers receive an explicit outcome immediately; queues and retained checkpoint
copies stay bounded. An acknowledgement clears only its own attempt and updates
the base revision while preserving any newer staged checkpoint. All local
updates are compare-and-swap; a concurrent tab change becomes a conflict and
must not be silently overwritten. Do not delete local recovery on failure.

Loading preserves malformed, unknown-envelope and unsupported rules/content
versions. Such data blocks writes and remains available to the host for export
or a separately confirmed recovery decision. Known migrations must be explicit
and reuse the runtime's game-owned migration/validation path. No future-version
downgrade, default-state overwrite or automatic conflict winner is permitted.

## Failure and lifecycle bounds

Ports take abort signals; operations have explicit bounded deadlines. Disposal
aborts work, clears queued callbacks and prevents late results from changing
session state or starting another operation. A server might commit before it
observes cancellation, but its request remains bound to the original account
and idempotency ID. No completion is routed into another account's session.

Use fixed diagnostic codes without raw provider errors or checkpoint content.
The library retries no network request automatically; the host controls bounded
retry. Checkpoints retain the core 1 MiB envelope and 256 KiB state limits;
the journal has a fixed total byte limit and bounded identity/revision fields.
Rollback stops new saves through the host flag and preserves existing records.

## Acceptance tests before implementation

- Isolated account/game keys, immutable session scope and cancellation during
  load/stage/flush; late results cannot reach the next account.
- Valid bounded checkpoints, invalid/oversized input rejection before storage,
  detached values, unknown future envelopes and explicit migration only.
- Initial load, offline load, interrupted persistence, coalesced stages, exact
  idempotent retry after unknown outcomes, and newer-save preservation on ack.
- Concurrent-tab compare-and-swap conflicts and remote revision conflicts retain
  both recovery evidence and a clear blocked outcome.
- Deadline, disposal, provider errors, cleanup, unsupported IndexedDB versions,
  transaction abort and write failures; no success reported before commit.
- Real browser/IndexedDB integration plus portable deterministic port tests,
  all changed sources in LCOV, unchanged >=80% coverage, dual-module consumer
  checks, type/lint/build/audit/package validation and reviewed CI/CD.

These package checks cannot prove the site's authenticated persistence boundary,
device qualification, ten-hour game depth or public launch readiness.

## Local validation — 16 November 2026

The initial two test suites failed for missing modules before implementation.
Additional failure tests caught early idle reporting, retained in-memory data
after disposal, unbounded timed-out provider/open attempts and browser policy
error disclosure; each failed before its corresponding fix.

- 145 Vitest tests and 24 privacy tests pass. Combined Vitest coverage is
  98.59% lines, 96.16% statements, 93.11% branches and 96.59% functions. All four
  added source modules and the changed package verifier appear in LCOV.
  Each added module has 100% line coverage; the verifier has 91.46% lines.
- Strict type checks, lint, dual builds, exact 21-file npm inventory and package
  privacy checks pass. Full locked dependency audit reports zero vulnerabilities.
  `fake-indexeddb@6.2.8` is test-only; `@plasius/schema@1.4.9` remains the only
  production dependency.
- An isolated consumer installed the local tarball and passed ESM/CJS runtime,
  save and browser exports, staging, acknowledgement and reopened recovery.
  NodeNext `.mts` and `.cts` declaration consumers type-check successfully.
- Native IndexedDB in Playwright Chromium 157 on macOS passed atomic concurrent
  writers, account isolation, interrupted upload replay, newer-progress
  preservation, cancellation and persistence across page reload. This is a
  package storage qualification, not the full browser/device launch matrix.

The reproducible browser harness is `tests/browser/recovery.html`. After a build,
serve an isolated loopback folder containing that file as `index.html`, the
package's emitted `.js` files at `/dist/` and released schema's emitted `.js`
files at `/schema/`. Run the checks, reload, then verify the persisted record.
Keep local browser artifacts under ignored `output/playwright/`. Only synthetic
data is used; the harness never contacts the site's account or production API.

CI, reviewed merge and registration/CD remain delivery gates. Neither this local
validation nor the first-publication preparation enables arcade rollout. Site
#2519 remains with its existing owner under the user's explicit direction.
