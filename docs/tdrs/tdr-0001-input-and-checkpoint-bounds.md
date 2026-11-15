# TDR 0001: Input and checkpoint bounds

Task #1. Tick rate is 60 Hz. Default catch-up is five ticks; configurable bounds
are 1–60. Default queue holds 256 commands (maximum 4,096), with a 120-tick future
window (maximum 3,600). A host uses one to four distinct stable slot names.
Axes are finite values in [-1, 1], buttons a 16-bit unsigned mask, tick and
sequence nonnegative safe integers. No freeform text is accepted.

Checkpoints use a 256 KiB UTF-8 state limit and a 1 MiB total envelope limit.
State validation is game-owned and must reject unknown keys, nonfinite values
and impossible states. Catch-up discards surplus whole ticks and reports this
to the host; an authoritative server must monitor overload and stop admission
rather than use local catch-up as proof of realtime capacity.

Randomness is Mulberry32 with an explicit uint32 state, intended only for
reproducible gameplay, never credentials, invitations or security decisions.
Presentation hooks receive detached data; their failures produce a bounded
host result and do not modify rule outcomes. No private state is logged.

Lifecycle interruption discards all unconsumed elapsed time, including the
fraction. `AdvanceResult.steps` counts committed ticks, while `discardedMs`
includes both overload and interruption. Every actual lifecycle transition
changes an identity token rather than an incrementing counter, so a synchronous
pause/resume cannot continue a stale batch. The per-tick random stream is copied
before evaluation and detached again at commit to prevent retained references
from changing subsequent randomness.

Exclusive synchronous operations reject nested advance/restore/checkpoint calls
and input admission. A finally block releases ownership after success or failure.
Every host hook also holds this gate, including standalone lifecycle and cleanup
notifications; snapshot/status reads and lifecycle actions remain available.
