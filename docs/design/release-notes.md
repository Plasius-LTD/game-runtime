# Release-note preparation

The three arcade packages reuse Schema's release preparation tooling from
Plasius-LTD/schema commit d6b0ccd95bbf9143c73f44d4aac1e5ecbc994b20
(PR #77). Their approved first-registration workflow currently predates that
change and would insert placeholder categories after promoting Unreleased.
Adopt the canonical helper before the first publication so subsequent OIDC
releases retain meaningful, validated history.

## Boundary and rollout

This is release tooling under site Feature #2384 / Story #2416 and inherits the
stored, disabled arcade.runtime.enabled flag. Release integrity is unconditional;
this change grants no product access. The approved main/cd.yml/production route,
first-publication guard, isolated credential step, exact-main checks, artifact
inventory and OIDC handover stay unchanged. See first-publication.md and ADR 0002.

Use scripts/release-changelog.mjs from Schema, with no new dependency. The
release-preparation workflow invokes prepare before staging metadata and check
after the protected main branch contains the reviewed metadata. Only the pipeline
promotes versioned sections; contributors add real notes under Unreleased.
The helper rejects placeholders anywhere, missing or empty release notes and
invalid metadata. It preserves prior history and line endings, updates release
references, and permits an identical preparation retry without rewriting content.

## Requirement-derived validation

Before implementation, install Schema's regression suite and demonstrate that
the legacy workflow's placeholder generation fails the policy assertion and that
the missing helper fails preparation tests. Cover first release, repeated
preparation, historical preservation, CRLF, empty categories, synthetic notes,
invalid metadata, version-prefix mismatch and rejected-file immutability.
Exercise the real CLI on scratch files, including bounded I/O errors. Verify
both workflow helper calls, and preserve the first-publication guard and CD
workflow byte-for-byte. Include the helper in combined LCOV, with every coverage
metric at least 80%, then run types, lint, build, package checks and pushed CI.
No published version, CD result or arcade qualification is inferred from those
local checks. First publication and the ordinary OIDC handover remain required.

