# Foundation validation and dependency review

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
