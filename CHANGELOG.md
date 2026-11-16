# Changelog

## [Unreleased]

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
