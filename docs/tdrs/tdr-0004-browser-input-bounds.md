# TDR 0004: Browser input and frame bounds

Task #7 / site Feature #2384. Inherit `arcade.runtime.enabled`.

- Sample at most four commands, once per actual core tick. Each command must
  address that next tick and pass unchanged schema, player, queue and sequence
  rules. No implicit future commands or replacement of queued replay input.
- Keep one pointer owner, nine fixed recognized keyboard codes, one uint16 pulse
  mask and one two-axis nudge. Repeated events coalesce instead of accumulating.
  `sample()` consumes pulses/nudges while reading current held intentions.
- Map the aiming surface's CSS bounds into finite [-1, 1] X/Y coordinates, Y up.
  Pointer capture failure and invalid geometry do not establish ownership.
- Keep at most one animation request. Zero is a valid request ID; use null as the
  empty marker. A generation check rejects cancelled callbacks after restart.
  Nonfinite, backward or >24-hour elapsed frames stop with a bounded code.
- Explicit start resets the timestamp. Stop/hidden/blur/pagehide clear fractional
  runtime time through pause; there is no hidden catch-up or automatic resume.
  Notification callbacks cannot recursively restart a loop. Reentrant runtime
  lifecycle changes invalidate the current frame generation.
- Abort/dispose detach owned listeners, cancel frames and clear controls. The
  driver does not dispose the caller's runtime, save session or network room.

See the [design and test matrix](../design/browser-input-lifecycle.md). Package
CI/CD, real device accessibility, authority/cost and game depth remain separate.
