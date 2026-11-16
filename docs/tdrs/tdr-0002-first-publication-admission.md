# TDR 0002: First-publication admission and credential lifetime

The guard is plain JavaScript using Node's built-in fetch, AbortSignal and URL
utilities. It executes in the final publication job without installing or
executing package dependencies. Reuse the Plasius learning-runtime pattern;
do not import the unreleased runtime or duplicate product schema behavior.

Admission compares repository/package pairs, the initial version, explicit
dispatch, main workflow identity and all three commit identities before any
request. Registry access is anonymous, redirect-free and bounded to ten
seconds; errors remain errors. CLI failures emit fixed text without input,
credential or provider details. The credential itself is never passed to the
verifier, only its presence. The following shell fence re-fetches current main
immediately before creating configuration and publishing the sealed artifact.

Tests cover all three pairs, rejected identities/statuses/network failures,
the executable CLI, default-off workflow forwarding and separate OIDC routing.
Executable shell tests stub only external commands and prove mode-0600 literal
configuration, sealed-tarball arguments, no credential output, cleanup after
success/failure and no publish on guard/fetch/stale-main rejection. Vitest
includes the new script in LCOV with unchanged 80% gates.

The site audit pins the complete reviewed guard and credential step. Those
fixtures must stay byte-equivalent (ignoring boundary whitespace) to the
reviewed package implementation. The ordinary release policy still evaluates
the full workflow; authentication scanning excludes only that verified step.
The operator owns the token's one-day expiry and revocation; neither
workflow input nor registry checks prove remote token lifetime.
