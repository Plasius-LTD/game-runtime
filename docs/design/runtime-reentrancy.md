# Synchronous runtime lifecycle boundaries

Work: game-runtime#1, site Story #2416 / Feature #2384. Inherits the disabled
`arcade.runtime.enabled` control. The November 5 reviewer reproduction showed
that an audio callback could dispose the host at tick one while a three-tick
batch continued invoking rules, audio and rendering.

An advance, restore or checkpoint handoff owns one exclusive synchronous
operation. Nested calls to those operations fail with `runtime-busy` before
mutation. Input admission during an operation returns `inactive`; ordinary
browser input arrives between synchronous operations. Snapshot/status reads and
pause/resume/dispose remain available to hooks.

Every actual lifecycle transition invalidates outstanding work, including a
pause followed immediately by resume. A batch stops at the last committed tick,
does not invoke another hook after interruption, and reports actual completed
steps. Remaining elapsed time, including its fraction, is discarded. The next
explicit advance starts without hidden catch-up. A render hook can also end the
batch and clear its fractional time. Presentation exceptions remain isolated.

Rule evaluation and state validation prepare a candidate before committing.
Each tick uses a detached random stream; interrupted or failed evaluation cannot
commit candidate state, tick, input watermarks or randomness. A rule-retained
random stream cannot mutate the next tick. Pure rules must still avoid host I/O.
Restore similarly validates/migrates a candidate before an atomic commit and
rejects lifecycle interruption with `runtime-interrupted`.

Lifecycle changes inside a lifecycle notification update state immediately,
while nested notifications are suppressed to prevent unbounded callback
recursion. Consumers can read final status. Disposal is terminal and its cleanup
hook runs once, including when a callback throws afterward. Operation ownership
is released in finally blocks; errors cannot leave the host permanently busy.

Define regressions first for audio/render/rule/parser/migration interruption,
pause-resume, nested advance/restore/checkpoint/input, lifecycle recursion,
random-state isolation, failed save handoff and ordinary deterministic catch-up.
Retain existing tests and >=80% coverage, validate every changed source in LCOV,
and run types/lint/build/package/audit and pushed quarantine CI. First publication
still requires game-runtime#3 and release guard verification; this fix does not
authorize a bootstrap, package publication or public arcade rollout.
