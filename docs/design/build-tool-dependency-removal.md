# Remove Picomatch implementations from arcade build tooling

The owner chose dependency removal on 18 November 2026. Site #2539 and glob#1
retain their existing owner for the new published `@plasius/glob` adapter. The
arcade release work must also remove the Picomatch 4.0.3 implementation embedded
inside `tsup@8.5.1/dist/rollup.js`; a package alias cannot replace bundled code.

No current Plasius package owns JavaScript/declaration bundling. `road-map` owns
governance and `gpu-shader` owns WGSL tooling, neither this capability. Preserve
the first-party package/build orchestration and use the existing esbuild
compiler directly, with `dts-bundle-generator` for declarations from TypeScript.
Evaluate published `esbuild@0.28.2` and `dts-bundle-generator@10.0.0` before
selection. The installed-code regression rejected `rolldown@1.3.3`: its
`dist/utils-index.mjs` embeds Picomatch 4.0.7. Do not add tsdown: its current
wrapper brings another direct Picomatch dependency.
Do not write a custom glob matcher or declaration compiler.

Requirements before replacement:

1. Capture exact entry/ESM/CJS/declaration/source-map inventories and API behavior.
2. Add a regression rejecting tsup and embedded Picomatch source from the selected
   builder's installed modules. Separately retain the full lock/audit check for
   externally resolved Picomatch; a clean lock alone is insufficient.
3. Build independent entries from explicit source paths. Keep runtime dependencies
   external and the root arcade game's dynamic imports lazy in both formats.
4. Retain the reviewed packed path inventory, public export surface and private
   artifact checks. Compare isolated strict TypeScript/ESM/CJS consumers and
   complete test discovery/coverage. Do not hide extra declaration chunks or
   silently exclude source/tests to pass.
5. Verify source maps, legal notices and cross-platform Node 24 builds. Full
   coverage, type/lint/build/audit checks and exact-head CI remain required.
6. Once the existing owner publishes the verified `@plasius/glob`, consume that
   released version for remaining external Vite/Vitest/tinyglobby callers and
   rerun the full dependency and installed-code scans. No unpublished dependency,
   renamed vulnerable implementation, exception or scanner suppression.

Changes apply to game-runtime, game-multiplayer and arcade-games, with one tracked
Task per repository under site Story #2416 / Feature #2384 / Epic #2382. Inherit
the stored, disabled `arcade.runtime.enabled` flag; build integrity checks are
unconditional and this maintenance grants no product capability.

The approved first-registration guard, main/cd.yml/production path, package API
and release-note preparation remain unchanged. Publication and OIDC handover wait
for the actual dependency-removal and site CI/CD prerequisites. Record each
candidate's validation; no package, game or arcade launch is inferred from build
tool replacement.

Lockfile portability: use the Node 24.18.0/npm 11.19.1 client used by CI and
its existing `--legacy-peer-deps` mode when generating and verifying the lock.
The first catalogue CI run reproduced missing optional `@emnapi/core` and
`@emnapi/runtime` WASI dependencies after the older local npm client pruned them.
Regenerate through npm, then verify `npm ci --no-fund --no-audit
--legacy-peer-deps` from the resulting lock. Do not hand-edit resolved packages
or omit optional dependencies to mask a portability failure.
