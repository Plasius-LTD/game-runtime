# ADR 0001: Deterministic headless game runtime

Status: accepted. Task #1 / site Feature #2384. Date: 5 November 2026.

Use pure fixed-step rules with injected host presentation, audio, checkpoint and
lifecycle hooks. Strict input/checkpoint envelopes reuse `@plasius/schema@1.4.9`;
do not introduce another validation library or game engine. Existing Plasius
learning games are curriculum-bound, while GPU and scene packages own rendering
and physics. Neither is a general portable lifecycle/checkpoint host.

Versioned state and random-stream checkpoints allow deterministic replay on both
clients and authoritative servers. Rules must avoid wall-clock time, ambient
randomness, platform-dependent physics and I/O. Validation of a checkpoint does
not establish server authority: multiplayer and ranking hosts must authenticate
and authorize their own inputs and never trust a client-provided score.

Stored `arcade.runtime.enabled` is evaluated by the site/backend; capabilities
own user access. The core has no environment override. Rollback disables new
sessions without deleting checkpoint data. Schema-template legal/tooling and
exact-main two-phase CD apply. Package publication requires verified CI, npm OIDC
binding and a protected production environment; local publishing is forbidden.

## Synchronous ownership clarification — 15 November 2026

Advance, restore and checkpoint operations are exclusive, including host hooks.
Reject recursive operations with `runtime-busy`; do not implicitly queue them.
Lifecycle transitions invalidate the outstanding batch even when a hook resumes
immediately. Prepare state and randomness separately, then commit one complete
tick only if its lifecycle is unchanged. This prevents callbacks from using
disposed presentation resources or committing work after a pause.

Lifecycle hooks may change status, but nested notifications are suppressed to
bound recursion. Disposal remains terminal and cleanup runs once. The detailed
[boundary contract](../design/runtime-reentrancy.md) defines errors, discarded
time and regressions. These are core guarantees, independent of browser or
server presentation; hosts still evaluate `arcade.runtime.enabled`.
