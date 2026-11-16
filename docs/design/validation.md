# Foundation validation and dependency review

## First-registration route — 16 November 2026

Task #3 preparation adds no runtime dependency and changes no product API.
The new workflow tests first failed because admission and the publication step
were absent; the guard suite initially failed on its missing module. After
implementation, 110 Vitest tests and 24 private-artifact tests pass. Combined
Vitest coverage is 99.48% lines, 98.57% statements, 95.74% branches and 100%
functions; the new release guard has all 14 statements covered and appears in
LCOV alongside all four runtime sources. Thresholds remain 80% throughout.

Typecheck, lint, ESM/CJS/declaration builds, public package checks, full npm
audit (zero findings), and actionlint 1.7.12 for changed CD and existing CI pass.
The candidate site audit accepts this exact guard/step and all ordinary release
checks. Executable shell tests verify cleanup and refusal on guard, fetch,
publication and stale-main failures. No credential was created and no bootstrap
publication was executed for this preparation. Pushed CI and reviewed operator
handover remain separate delivery gates. These checks do not qualify a game.

## Initial foundation

5 November 2026; Task #1. This evidence does not qualify a game or claim a package
release. Node 24.18.0 and the schema template's npm/dual-module conventions apply.

The runtime tests were added before implementation and failed on the missing
entry point. A later explicit-envelope-identity test failed before the validator
was tightened; missing type/version are rejected, not silently defaulted.

- 53 runtime/workflow tests passed; 24 inherited private-artifact tests passed.
- All four source files appear in LCOV: 99.29% lines, 98.63% statements,
  94.96% branches and 100% functions overall. Thresholds are 80% in every metric.
- Type checking, lint, ESM/CJS builds, public package inventory and runtime audit
  passed. The exact public inventory is nine files, excluding legal records,
  credentials, tooling, tests and private application code.
- The only runtime dependency is released `@plasius/schema@1.4.9`; it supplies
  strict envelope validation. No engine, network client or second validator was
  introduced. Browser/device/rendering and persistence integration remain separate.
- The initial development audit identified the schema template's minimatch
  override as affected by
  [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).
  Pinned the documented patched 11.0.1 version, then reran lint/tests and the
  complete audit: zero known runtime or development vulnerabilities.

CI uses the current quarantined push-only policy; release preparation/publication
retain the schema baseline's exact-main two-phase OIDC protocol. Workflow tests
check identity, credential boundaries, private-artifact ordering and sealed
inventory verification. `actionlint` was unavailable locally; runtime workflow
execution and repository admission remain separate gates.

Before release, verify pushed CI, branch protection, the release-preparation App,
protected `production` environment and npm trusted publisher. Do not mark Task #1
complete or consume an unpublished workspace link in the site. Manual ten-hour
playtests, production concurrency and device performance are outside the evidence
provided by these unit and package checks.
