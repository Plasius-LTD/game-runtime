# Changelog

## [Unreleased]

- Retire verified first-registration enrollment and require ordinary npm Trusted
  Publishing, with a real-checkout regression preventing accidental re-enrollment (#17).

## [0.1.0] - 2026-11-25

- Replace remaining external Picomatch implementations with the verified public
  Plasius Glob 1.0.2 adapter and its exact Minimatch 11.0.9 engine. Validate all
  installed package identities/code and preserve complete test discovery (#13).

- Replace tsup's embedded Picomatch build dependency with direct esbuild and
  TypeScript declaration generation, preserving independent public entry formats
  and the exact packed inventory; external test-tool removal remains tracked
  separately (#13).

- Adopt the shared Schema first-registration template with the standard temporary
  `NPM_TOKEN`, exact enrollment and subsequent tokenless OIDC handover (#17).

- Reuse Schema release-note preparation and validation, preserving authored
  history and rejecting empty or placeholder release notes before publication.

- Add account-scoped save sessions and a lazy native IndexedDB adapter, with
  atomic local revisions, coalesced stages, durable idempotent upload recovery,
  explicit migrations, future/conflict preservation and bounded cancellation (#2).
- Prepare an explicit first-registration path through main `cd.yml`/production,
  restricted to the approved initial arcade packages and confirmed registry
  absence, with a temporary isolated credential and mandatory OIDC handover (#3).
- Stop catch-up when a hook pauses or disposes the runtime, isolate interrupted
  state/random candidates, and bound nested operations and lifecycle callbacks
  with explicit errors and accurate completed-tick/time accounting (#1).
- Pin the approved npm release client and revalidate current main immediately
  before npm publication; first registration remains a separate gate (#1, #3).
- Add the deterministic 60 Hz headless runtime, bounded spatial intentions,
  reproducible gameplay random stream, injected host hooks and atomic validated
  checkpoint restoration with explicit rules/content migrations (#1).
- Establish schema-template legal, privacy, dual-module packaging, coverage and
  governed CI/CD controls. Public arcade launch remains independently gated.

[Unreleased]: https://github.com/Plasius-LTD/game-runtime/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Plasius-LTD/game-runtime/releases/tag/v0.1.0
