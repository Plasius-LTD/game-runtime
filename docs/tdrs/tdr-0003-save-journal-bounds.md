# TDR 0003: Save journal and operation bounds

Task #2. The `gameRecoveryJournal` 1.0.0 schema rejects undeclared fields and
contains the exact account/game key, optional acknowledged cloud revision and
checkpoint, optional immutable attempt and optional latest staged checkpoint.
Checkpoints are serialized JSON strings parsed through the existing contract.
The attempt's expected revision equals the acknowledged base revision. IDs
cannot collide between active, attempted and staged saves.

The record limit is 4 MiB UTF-8 including JSON escaping. Each checkpoint retains
the 1 MiB envelope and 256 KiB state limits; three individually valid checkpoints
can still exceed the combined journal limit and must not be committed. Account
scopes and operation IDs are 1–128 ASCII alphanumeric/underscore/hyphen. Cloud
revisions are 1–256 printable non-whitespace ASCII characters. Local revisions
are positive safe integers and writes cannot overflow them.

Stage holds one active and one pending request. Replacing the pending request
immediately resolves it as `superseded`; flush during staging is `not-ready`.
One load and one flush can be active, with repeated callers sharing their
promise. Local mutations serialize behind these bounded callers; transforms use
the current committed journal, so an acknowledgement cannot discard a stage
that arrived while the network request was in flight. Host ID callbacks and
migrations cannot recursively stage or flush.

Every provider call has a 5-second default deadline, configurable to an integer
10–30000 ms. Abort races non-cooperative providers, and late completion cannot
change disposed state. Abort cannot undo a remote commit. The durable attempt
therefore survives timeout, server error and failed acknowledgement persistence.
No implicit retries or new operation IDs are issued for uncertain attempts.

Local and cloud ports each admit at most four unresolved provider calls. A port
that ignores cancellation retains its slot until settling; repeated explicit
flush calls cannot accumulate unlimited hung requests. Cloud saturation does not
consume local slots, so newer recovery can still be staged while offline.

Native IndexedDB uses one transaction per operation with compound key
`[scope, gameId]`. Read/compare/put occur within the same readwrite transaction.
Only transaction completion resolves success. At most four operations or
unresolved opens are admitted. Timed-out opens retain admission slots until
native completion: repeated caller retries cannot accumulate an unlimited
browser open queue. Late connections close; disposal aborts active transactions.
Version 1 is created only for a new database; newer versions are preserved.

Exports contain bounded detached recovery evidence, never provider error strings.
Disposal clears in-memory evidence access without deleting stored data. The host
owns explicit recovery, retention/deletion policy, user feedback, authentication,
capabilities and `arcade.progress.enabled`. Disable new writes on rollout
rollback, preserving existing recovery.
