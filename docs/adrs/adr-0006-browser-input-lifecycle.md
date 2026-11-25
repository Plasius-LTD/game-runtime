# ADR 0006: Browser lifecycle with fixed-tick input sampling

Status: accepted for implementation. Date: 17 November 2026.
Work: game-runtime #7; site Feature #2384 / Story #2416 / Epic #2382.

Extend the existing runtime with an optional synchronous input sampling port.
Sample once per actual tick, rather than once per animation frame, because
display refresh and bounded catch-up can otherwise omit intentions or alter
replay. Validate complete batches using the existing schema/order checks, retain
queued replay precedence and commit input sequence only with successful rules.
Input failure is fatal and bounded; presentation hook failure remains isolated.

Put native Pointer Events, focused keys and animation-frame ownership behind
`/browser`. Keep the root portable and preserve its checkpoint/API format.
The browser driver delegates fixed timing to the core and never controls remote
room authority. It pauses local simulation on hidden/blur/pagehide, clears time,
and requires an explicit start. Abort/dispose release only owned resources.

Use the existing published schema dependency; no additional engine, DOM library
or scheduler. Semantic host buttons use bounded one-tick pulses/nudges, providing
non-drag and assistive activation paths. Games map generic controls into their
own complete intentions; the host supplies accessible layout, translated labels,
focus styles and account/capability decisions. No raw input telemetry is added.

Stored `arcade.runtime.enabled` and backend capabilities remain host-owned.
Rollback disables new sessions and preserves saves; no environment override.
Source tests and Chromium checks do not establish phone/tablet qualification or
the full arcade's ten-hour-per-game public launch evidence.
