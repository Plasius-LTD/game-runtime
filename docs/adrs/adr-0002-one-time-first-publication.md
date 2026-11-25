# ADR 0002: One-time first publication through existing CD

> Registration mechanics are superseded by the [shared Schema design](../design/shared-first-registration.md)
> under Task #17. Historical secret names below are not operator instructions.

Status: Accepted for preparation; credential setup and publication await the
operator action recorded in Task #3. Owner approval: 16 November 2026.
Parent: site Feature #2384 / Story #2416; stored `arcade.runtime.enabled` stays
disabled and never bypasses release integrity.

## Context

npm requires an existing package to configure its trusted publisher. The new
arcade packages cannot perform their first registration with a binding that
cannot yet be created. Plasius learning-runtime already documents a narrowly
scoped first-publication pattern. Local publication and permanent credential
fallbacks conflict with the approved delivery boundary.

## Decision

Reuse that pattern within main `.github/workflows/cd.yml`, on a GitHub-hosted
runner in `production`. Forward a default-false `first_publication` input from
prepare to publish. A dependency-free guard accepts only the three exact
Plasius repository/package pairs, version `0.1.0`, an explicit opt-in and the
matching checkout/workflow/current-main identity. It makes one anonymous
registry request with a ten-second deadline and rejects redirects, existing
packages and every non-404 result or failure.

The temporary credential is available only to the opted-in publication step.
It is never present during dependency execution or package validation. A mode
0600 temporary npm configuration contains a literal environment reference and
is removed on normal or failed exit. Publish only the sealed, attested tarball
with scripts disabled, provenance enabled and a fresh main check. All ordinary
release checks remain mandatory. OIDC failure cannot select this path.

Site Task #2531 binds admission to the reviewed guard and step digests, exact
package identity/version and default-off dispatch. Other npm authentication
configuration remains drift. Changes to either digest require a reviewed
policy update with regression evidence, not a hash refresh to silence failure.

After byte/provenance/consumer verification, configure the exact package OIDC
binding, revoke the credential and remove its production secret. Remove the
bootstrap path and corresponding audit admission through reviewed changes.
Subsequent publication must use OIDC, and Task #3 stays open until this handover
is complete. Disable CD and revoke the temporary credential to stop a failed
registration attempt; never rewrite or reuse a published version.

## Consequences

The operator must perform a credential handoff once per package. Use the
smallest npm write scope available for initial registration, no organisation
administration grants, a one-day expiry, and remove it immediately
after use. An unavailable registry blocks registration rather than admitting
uncertain ownership. No new runtime dependency or public API is introduced.
Tests execute failure admission and shell cleanup; they do not claim a real
publication or arcade qualification. See the [operator design](../design/first-publication.md).
