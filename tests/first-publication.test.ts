import { describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
// Dependency-free release tooling deliberately runs without a TypeScript loader.
// @ts-expect-error Repository-local release script has no public declarations.
import { runFirstPublication, verifyFirstPublication } from "../scripts/verify-first-publication.mjs";

const sha = "a".repeat(40);
const valid = {
  repository: "Plasius-LTD/game-runtime",
  packageName: "@plasius/game-runtime",
  version: "0.1.0",
  optIn: "true",
  credentialPresent: true,
  ref: "refs/heads/main",
  workflowRef: "Plasius-LTD/game-runtime/.github/workflows/cd.yml@refs/heads/main",
  eventName: "workflow_dispatch",
  expectedCommitSha: sha,
  checkedOutSha: sha,
  workflowSha: sha,
};

describe("one-time arcade package registration", () => {
  it.each(["game-runtime", "game-multiplayer", "arcade-games"])("admits only absent %s 0.1.0 from its exact main CD", async name => {
    const registry = vi.fn().mockResolvedValue({ status: 404 });
    await verifyFirstPublication({ ...valid, repository: `Plasius-LTD/${name}`, packageName: `@plasius/${name}`,
      workflowRef: `Plasius-LTD/${name}/.github/workflows/cd.yml@refs/heads/main` }, registry);
    expect(registry).toHaveBeenCalledExactlyOnceWith(`https://registry.npmjs.org/@plasius%2f${name}`, {
      signal: expect.any(AbortSignal), redirect: "error", headers: { accept: "application/json" },
    });
  });

  it.each([
    { repository: "another-owner/game-runtime" }, { repository: "Plasius-LTD/other" },
    { packageName: "@plasius/arcade-games" }, { version: "0.1.1" }, { version: "0.1.0-beta.0" },
    { optIn: "false" }, { optIn: true }, { credentialPresent: false }, { credentialPresent: "true" },
    { ref: "refs/heads/release" }, { workflowRef: "Plasius-LTD/game-runtime/.github/workflows/other.yml@refs/heads/main" },
    { workflowRef: "Plasius-LTD/game-runtime/.github/workflows/cd.yml@refs/heads/feature" },
    { eventName: "push" }, { expectedCommitSha: "short" }, { expectedCommitSha: undefined },
    { checkedOutSha: "b".repeat(40) }, { workflowSha: "b".repeat(40) },
  ])("rejects invalid admission before any request: %j", async override => {
    const registry = vi.fn();
    await expect(verifyFirstPublication({ ...valid, ...override }, registry)).rejects.toThrow("admission");
    expect(registry).not.toHaveBeenCalled();
  });

  it.each([200, 301, 302, 401, 403, 410, 429, 500, undefined])("does not mistake status %s for absence", async status => {
    await expect(verifyFirstPublication(valid, vi.fn().mockResolvedValue({ status }))).rejects.toThrow("confirmed absent");
  });

  it("bounds the anonymous registry check and fails closed on network, redirect and timeout errors", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      for (const reason of [new TypeError("network"), new TypeError("redirect"), new DOMException("expired", "TimeoutError")]) {
        await expect(verifyFirstPublication(valid, vi.fn().mockRejectedValue(reason))).rejects.toThrow();
      }
      expect(timeout.mock.calls).toEqual([[10_000], [10_000], [10_000]]);
    } finally { timeout.mockRestore(); }
  });

  it("maps environment admission without passing the credential to the verifier or leaking failures", async () => {
    const verify = vi.fn().mockResolvedValue(undefined);
    const report = vi.fn();
    const env = { GITHUB_REPOSITORY: valid.repository, PACKAGE_NAME: valid.packageName, PACKAGE_VERSION: valid.version,
      FIRST_PUBLICATION: "true", NPM_BOOTSTRAP_CREDENTIAL: "synthetic-test-credential", GITHUB_REF: valid.ref,
      GITHUB_WORKFLOW_REF: valid.workflowRef, GITHUB_EVENT_NAME: valid.eventName, EXPECTED_SHA: sha, ACTUAL_SHA: sha, GITHUB_SHA: sha };
    expect(await runFirstPublication(env, verify, report)).toBe(0);
    expect(verify).toHaveBeenCalledExactlyOnceWith(valid);
    expect(report).not.toHaveBeenCalled();
    verify.mockRejectedValue(new Error("synthetic private registry detail"));
    expect(await runFirstPublication(env, verify, report)).toBe(1);
    expect(report).toHaveBeenCalledExactlyOnceWith("First-publication verification failed; check approved admission and registry absence.\n");
  });

  it("runs the actual CLI boundary without network when the managed credential is absent", async () => {
    const argv = process.argv;
    const exitCode = process.exitCode;
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    vi.stubEnv("NPM_BOOTSTRAP_CREDENTIAL", "");
    process.argv = [process.execPath, fileURLToPath(new URL("../scripts/verify-first-publication.mjs", import.meta.url))];
    try {
      vi.resetModules();
      // @ts-expect-error Exercise the dependency-free JavaScript CLI entry point.
      await import("../scripts/verify-first-publication.mjs");
      expect(process.exitCode).toBe(1);
      expect(stderr).toHaveBeenCalledExactlyOnceWith("First-publication verification failed; check approved admission and registry absence.\n");
    } finally {
      process.argv = argv; process.exitCode = exitCode; stderr.mockRestore(); vi.unstubAllEnvs();
    }
  });
});
