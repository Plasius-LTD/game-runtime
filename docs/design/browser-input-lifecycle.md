# Browser input and animation lifecycle

Work: [game-runtime #7](https://github.com/Plasius-LTD/game-runtime/issues/7),
site Feature #2384 / Story #2416 / Epic #2382. The approved
arcade design assigns browser animation and input lifecycle to game-runtime.
The existing headless runtime owns fixed ticks, queues and checkpoint sequences;
the browser adapter must not implement a second simulation scheduler. Existing
gpu-interaction provides action descriptors, and gpu-camera provides camera
gestures; neither provides game intentions sampled on deterministic ticks.

## Contracts

Add an optional synchronous `RuntimePorts.sampleInput` handoff before each
actual simulation tick, including each bounded catch-up tick. It receives the
next tick and the last committed sequence for each slot without an already
queued command for that tick. It returns at most four complete input commands.
Validate the whole batch with the existing schema and queue ordering rules;
require the current next tick and no duplicate slot. A malformed batch or thrown
callback faults the runtime without advancing state/random/sequence. Reentrant
pause/dispose interrupts work; nested enqueue/advance/restore remain prohibited.
No sampler, or an omitted slot, still means neutral missing input. Queued replay
commands are never overwritten by live input. Commit sampled commands only with
a successful rule step. Existing callers and checkpoint formats stay compatible.

The separate `/browser` subpath provides two composable adapters:

- `createBrowserGameControls(surface)`: a single owned Pointer Events gesture,
  normalised absolute X/Y with Y upward, arrows/WASD directions and Space as
  primary action. Only the focused surface consumes keys; child form controls,
  shortcuts, composition and unmapped keys retain native behavior. A second
  pointer never steals ownership. Pointer up/cancel/lost capture clears the
  target; blur, focus loss, hidden documents and disposal clear all intentions.
  `sample()` returns a detached snapshot once per tick. Semantic host buttons
  may call bounded `pulse(mask)` and `nudge(x,y)`; these coalesce into one tick,
  preserving quick accessible activations between animation frames without
  unbounded event queues. The game maps this generic snapshot into its axes and
  button meanings. No account, network, ranking or score is accepted here.
- `createBrowserGameLoop(runtime, options)`: exactly one outstanding animation
  frame, feeding elapsed timestamps into the existing `advance`. Start is
  explicit. Hidden/blur/pagehide stops frames, pauses local simulation and hands
  a bounded reason to the host, which clears controls and offers resume or online
  reconnect. Visibility alone never resumes play. A fresh start resets time so
  hidden time cannot earn progress. Online authority continues on the server;
  stopping local prediction is not a room pause. Stale cancelled callbacks cannot
  revive a stopped/replaced loop. Abort/dispose remove owned listeners and frames.

No browser global is accessed at module import. Native DOM ports are resolved
from the supplied surface/document/window only at construction. No third-party
runtime dependency is needed. The host owns semantic labels, 44 CSS-pixel buttons,
focus styling, handedness, safe areas, non-drag alternatives, translations and
the game-specific mapping. It sets `touch-action` on the aiming region without
disabling browser zoom across the page.

## Requirement-derived verification

Before source: tests must fail for per-tick sampling, bounded/atomic validation,
queued replay precedence, sequence restore, neutral omissions and reentrancy.
Fake-clock frame tests cover high-refresh timestamps, catch-up, stale callbacks,
pause/resume, hidden/blur, abort, disposal and failures without rescheduling.
Event tests cover equivalent pointer types, cancellation/capture failure, second
pointer exclusion, focus-only keyboard input, modifiers/composition, detached
snapshots, bounded pulses/nudges and complete listener cleanup. A real Chromium
harness verifies native pointer capture, focus/keyboard and animation behavior;
it does not substitute for real phone/tablet or ten-hour game qualification.

Every changed source must appear in combined LCOV; all coverage metrics remain
at least 80%. Run types/lint/build, public inventory, full dependency audit and
isolated ESM/CJS/strict-type consumers. Update README, Unreleased, ADR/TDR and the
public artifact allowlist. Keep prepared first-publication main unchanged until
the separate reviewed release route is authorized. Consumers adopt a released
version only.

## Rollout and browser references

Inherit stored `arcade.runtime.enabled` (read back disabled, 0% on 17 November
2026). Backend capabilities and all 24-game public qualification gates remain
authoritative; no environment override. Disabling new sessions preserves saves.

Browser contracts checked against MDN on 17 November 2026:
[pointer capture](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture),
[animation frames](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)
and [page visibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API).

## Source validation — 17 November 2026

The requirement tests first failed for missing per-tick sampling and browser
exports. A later failing regression exposed a Space press released between
ticks; coalescing preserves that one-tick action without a repeat queue.

The implemented source passes 195 Vitest and 24 privacy tests. Combined coverage
is 98.87% lines, 96.17% statements, 93.19% branches and 96.79% functions. Every
changed source is represented in LCOV. Types, lint, all four ESM/CJS builds and
the exact 27-path public inventory pass. The full dependency audit reports zero
vulnerabilities; no dependency was added or changed.

The local harness passed native Chromium pointer capture, clamping outside the
surface, release, focused keys/quick Space, semantic pulse/nudge, normal text
input isolation and real frame advance/pause. Chromium's native touch pipeline
at 390 by 844 passed aiming, second-pointer exclusion, movement/end/cancellation
and disposed-listener checks. This is browser emulation, not physical-device
evidence. CLI session expiry was handled by the browser tool; the successful
checks used the same local harness. Generated evidence stays in ignored
`output/playwright/`.

Publication, site/game adoption, authority integration and real device/human
qualification remain separate gates. No production flag was enabled.
