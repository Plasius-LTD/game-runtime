# One-time first publication through approved CD

> Registration mechanics are superseded by the [shared Schema design](shared-first-registration.md)
> under Task #17. Historical secret names below are not operator instructions.

Work: game-runtime #3, site Story #2416 / Feature #2384 / Epic #2382.
The owner approved preparation of this route on 16 November 2026. Credential
creation and publication remain separate operator actions after review.
Inherits the disabled host flag `arcade.runtime.enabled`; release integrity is
unconditional and does not create product access.

npm requires a package to exist before configuring its OIDC trusted publisher.
Reuse the Plasius learning-runtime first-publication pattern within the existing
`main` / `cd.yml` / `production` release. Do not publish locally or introduce an
alternate workflow. The normal path remains OIDC with no credential fallback.

An explicit, default-false `first_publication` input is propagated through the
two-phase workflow. It permits only the initial `0.1.0` publication of the exact
repository/package pairs game-runtime, game-multiplayer and arcade-games. Each
owning repository must adopt and test the route before use. A dependency-free
guard checks the pair, version, main identity and credential presence and makes
a bounded anonymous registry request. Only a confirmed HTTP 404 permits first
registration. Existing packages, redirects, other statuses and network failures
fail closed. No failed OIDC run automatically selects the bootstrap path.

The normal exact-main push CI, protected production environment, unprivileged
build, immutable tarball/SBOM digests, inventory checks, attestations, fresh main
fences, provenance and registry byte verification remain mandatory. The
short-lived, minimally scoped bootstrap credential is stored only in the owning
repository's production environment. It is exposed only to the opted-in publish
step, never to dependencies, package scripts or validation. The temporary npm
configuration contains an environment reference, uses restrictive permissions,
and is removed on exit. Publish the sealed tarball with scripts disabled.

The owner creates a fresh granular credential with the smallest package write
scope npm supports for these initial registrations, no organisation-management
permission and a one-day expiry. Store it as `NPM_BOOTSTRAP_TOKEN` only
in the owning repository's `production` environment. Do not reuse an existing
organisation token or send the value in chat. The operator completes credential
entry and submission; the agent verifies secret metadata without reading values.
Dispatch preparation with `bump=none`, `first_publication=true`, and an empty
prerelease ID so the initial version stays `0.1.0`. Review the pipeline-generated
metadata PR, then verify exact-main CI before the queued publication. Do not
dispatch until the prepared route and site audit policy have passed review/CI.

The site release audit currently rejects all npm authentication placeholders.
Its exception must recognize only these three approved repository/package pairs,
the reviewed bootstrap step and guard, and explicit default-off admission. All
credential use outside that exact boundary remains rejected. Test malformed and
tampered admission, unexpected packages/versions, missing credentials, existing
packages, registry errors/redirects/timeouts, normal OIDC behavior and cleanup.
Do not conceal authentication configuration from the audit or lower its checks.

After the first verified release, configure the exact repository's npm trusted
publisher for `cd.yml` and `production`; revoke the bootstrap credential and
remove its environment secret. Retire the one-time exception and bootstrap path
through reviewed changes so subsequent releases use OIDC permanently. Record
sanitized evidence on the tracked Task. A registry placeholder or staged artifact
is not a usable release. This route does not qualify any game or enable launch.

The new OIDC binding must be validated by a successful ordinary OIDC release
within npm's two-day first-use window. Use the reviewed bootstrap-removal change
for that release and verify bytes/provenance/consumer behavior again. Merely
creating a pending binding does not complete the permanent handover. See
[npm's trusted-publisher expiry](https://docs.npmjs.com/trusted-publishers/#trusted-publisher-configuration-expiry)
and [granular token permissions](https://docs.npmjs.com/creating-and-viewing-access-tokens/).
