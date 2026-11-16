# ADR 0003: Account-scoped save recovery

Status: accepted. Date: 16 November 2026. Task #2 / site Story #2418,
Feature #2386, Epic #2382. Host flag: `arcade.progress.enabled`, disabled.

Add independent `/saves` and `/browser-recovery` entry points in game-runtime.
Reuse released `@plasius/schema` and the existing checkpoint contract. Existing
`@plasius/storage` provides Node/Azure asset mechanisms and public
`@plasius/offline-cache` excludes authenticated data. Neither owns transactional
browser recovery. No third-party runtime dependency is added; `fake-indexeddb`
is dev-only and supplements real-browser qualification.

Bind a save session immutably to one opaque account scope and game identity.
Dispose on logout/account change. Inject conditional cloud storage with
server-side authorization; the library cannot confer entitlement, validate a
score, or turn a browser checkpoint into authoritative multiplayer state.

Persist an immutable upload attempt before calling the cloud. Retain its ID,
expected revision and payload after an uncertain response, with at most one
newer staged checkpoint. Retry only by explicit flush. Cloud adapters must
deduplicate IDs transactionally before checking revisions and reject ID reuse
with different content. Acknowledgements preserve newer staged progress.

Local compare-and-swap transactions detect concurrent tab changes. Unknown
versions, malformed data, failed migrations and conflicts block further writes;
no implicit winner, downgrade or database reset is allowed. Explicit migrations
reuse game-owned runtime validation and cannot change an uncertain attempt.

The browser adapter uses native IndexedDB and waits for transaction completion,
not request success. Strict durability is requested, but browser eviction and
device loss still require cloud recovery. Partitioning is not an origin security
boundary; keep personal data and credentials outside game records. Native
storage failures remain bounded failures with no public-cache fallback.

Capabilities own account access; the backend evaluates the stored feature flag.
No local override is introduced. Rollback stops new sessions/saves and preserves
existing recovery. Publication remains gated by Task #3 and approved main
`cd.yml`/production. This change does not enable the public arcade.

See the [design](../design/account-save-recovery.md),
[bounds](../tdrs/tdr-0003-save-journal-bounds.md) and
[IndexedDB transaction lifecycle](https://www.w3.org/TR/IndexedDB/#transaction-lifecycle).
