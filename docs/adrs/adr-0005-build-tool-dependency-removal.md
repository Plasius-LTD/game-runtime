# ADR 0005: Direct JavaScript and declaration builds

Status: Accepted for the candidate build migration; publication gates remain open.

## Context

Task #13 belongs to site Story #2416 / Feature #2384 / Epic #2382. The owner
requested removal of Picomatch rather than a temporary vulnerability exception.
The installed `tsup@8.5.1/dist/rollup.js` contains Picomatch 4.0.3 code, which
cannot be replaced through npm's external dependency overrides.

No current Plasius package owns JavaScript or TypeScript declaration bundling.
Creating a compiler here would duplicate maintained tooling. An installed-code
regression also rejected Rolldown 1.3.3 because its `dist/utils-index.mjs` embeds
Picomatch 4.0.7. A clean dependency name list is insufficient evidence of removal.

## Decision

Keep build orchestration in the package's first-party script. Use published,
exact-pinned esbuild 0.28.2 for independent ESM/CJS bundles and
dts-bundle-generator 10.0.0 with the installed TypeScript compiler for declarations.
The generator imports external library types and exports only the source entry's
public types. Copy each self-contained named declaration surface to both `.d.ts`
and `.d.cts`; verify both with strict consumers.

Build only explicit manifest entry paths, sequentially. Keep Node builtins and
declared runtime dependencies external. Keep optional browser/provider adapters
in independent entry points. Preserve
source maps and legal comments inline. Retain all 21 packed paths and the public
API checks; do not add shared output chunks, glob entry discovery or public
implementation claims. Compiler or declaration failures abort the build.

The test-tool graph still has external Picomatch callers. Its replacement must
use the separately owned, verified and published `@plasius/glob` before the full
removal task can complete. No audit exception, disabled scanner, renamed vulnerable
code or local unpublished dependency is permitted.

## Verification and consequences

Regressions cover installed builder code, independent ESM/CJS entry boundaries, declaration
failures, unknown entry rejection, sequential build failure and safe output
cleanup. Full tests/coverage, types, lint, all-entry build, exact tarball checks,
isolated ESM/CJS/strict TypeScript consumers and pushed CI are required.

The stored `arcade.runtime.enabled` flag remains disabled. Build integrity checks
are unconditional and grant no product capability. The approved first-registration
guard, release notes, main/cd.yml/production route and OIDC handover are unchanged.
Do not publish until full dependency and site release prerequisites pass.

References: [esbuild API](https://esbuild.github.io/api/),
[declaration generator](https://github.com/timocov/dts-bundle-generator).
