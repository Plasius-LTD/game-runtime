import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const read = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const ciWorkflow = read(".github/workflows/ci.yml");
const cdWorkflow = read(".github/workflows/cd.yml");
const releasePrepareWorkflow = read(".github/workflows/release-prepare.yml");
const npmConfig = read(".npmrc");

describe("release workflow trust boundaries", () => {
  it("admits only repository-owned pushes on explicit quarantined runners", () => {
    expect(ciWorkflow).toContain('branches: ["**"]');
    expect(ciWorkflow).not.toContain("pull_request:");
    expect(ciWorkflow).not.toContain("pull_request_target:");
    expect(ciWorkflow.match(/group: Public CI - Quarantined/gu)).toHaveLength(3);
    expect(ciWorkflow.match(/labels: \[self-hosted, Linux, X64\]/gu)).toHaveLength(3);
    expect(ciWorkflow).not.toContain("ubuntu-latest");
    expect(ciWorkflow).toContain("github.event_name == 'push'");
  });

  it("binds a second publication run to the prepared main SHA and successful CI", () => {
    expect(cdWorkflow).toContain("- prepare");
    expect(cdWorkflow).toContain("- publish");
    expect(cdWorkflow).toContain("expected_commit_sha");
    expect(cdWorkflow).toContain('"ref": "main"');
    expect(cdWorkflow).toContain('"phase": "publish"');
    expect(cdWorkflow).toContain("actions/workflows/cd.yml/dispatches");
    expect(cdWorkflow).toContain('-f head_sha="${EXPECTED_SHA}"');
    expect(cdWorkflow).toContain("-f branch=main");
    expect(cdWorkflow).toContain("-f event=push");
    expect(cdWorkflow).toContain("refs/heads/main");
    expect(releasePrepareWorkflow).toContain("COMMIT_SHA=$(git rev-parse HEAD)");
  });

  it("uses supported phase-isolated concurrency", () => {
    expect(cdWorkflow).toContain(
      "group: npm-cd-${{ github.repository }}-${{ inputs.phase == 'publish'",
    );
    expect(cdWorkflow).toContain("inputs.expected_commit_sha");
    expect(cdWorkflow).toContain("cancel-in-progress: false");
    expect(cdWorkflow).not.toContain("queue:");
  });

  it("executes stable release identity derivation on the release runtime", () => {
    const scriptMatch = releasePrepareWorkflow.match(
      /EFFECTIVE_PREID=\$\(TARGET_VER="\$\{MAIN_VERSION\}" node -e '\n([\s\S]*?)\n\s+'\)/u,
    );
    expect(scriptMatch).not.toBeNull();

    const result = spawnSync(process.execPath, ["-e", scriptMatch?.[1] ?? ""], {
      encoding: "utf8",
      env: { ...process.env, TARGET_VER: "1.3.1" },
    });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("uses hosted OIDC publication with no persistent npm write-token fallback", () => {
    expect(cdWorkflow).toContain("runs-on: ubuntu-latest");
    expect(cdWorkflow).toContain("environment: production");
    expect(cdWorkflow).toContain("id-token: write");
    expect(cdWorkflow).toContain("--provenance");
    expect(cdWorkflow).toContain("npm publish");
    expect(cdWorkflow).not.toContain("NPM_TOKEN");
    expect(cdWorkflow).not.toContain("NODE_AUTH_TOKEN");
    expect(npmConfig).not.toContain("_authToken");
    expect(npmConfig).not.toContain("NODE_AUTH_TOKEN");
  });

  it("keeps dependency code out of the OIDC mutation job", () => {
    const validationJob = cdWorkflow.slice(
      cdWorkflow.indexOf("\n  validate_and_pack:"),
      cdWorkflow.indexOf("\n  publish:"),
    );
    const publishJob = cdWorkflow.slice(cdWorkflow.indexOf("\n  publish:"));

    expect(validationJob).toContain("npm ci");
    expect(validationJob).toContain("npm pack --ignore-scripts --json");
    expect(validationJob).toContain("actions/upload-artifact@v7");
    expect(validationJob).not.toContain("environment: production");
    expect(validationJob).not.toContain("id-token: write");
    expect(publishJob).toContain("actions/download-artifact@v8");
    expect(publishJob).toContain("digest-mismatch: error");
    expect(publishJob).not.toContain("npm ci");
    expect(publishJob).not.toContain("npm run ");
  });

  it("pins the approved publishing client before validating its runtime", () => {
    const publishJob = cdWorkflow.slice(cdWorkflow.indexOf("\n  publish:"));
    const install = publishJob.indexOf("npm install --global npm@11.6.2 --ignore-scripts --registry https://registry.npmjs.org");
    expect(install).toBeGreaterThan(-1);
    expect(publishJob.indexOf("- name: Verify release runtime")).toBeGreaterThan(install);
    expect(publishJob).toContain('"${EXPECTED_NODE}" != "24.18.0"');
    const guard = publishJob.match(/node - "\$\{ACTUAL_NPM\}" <<'NODE'\n([\s\S]*?)\n\s+NODE/u)?.[1];
    expect(guard).toBeDefined();
    for (const [version, code] of [["11.6.2", 0], ["11.5.1", 0], ["11.4.9", 1], ["10.9.0", 1], ["invalid", 1]] as const) {
      const result = spawnSync(process.execPath, ["-", version], { input: guard, encoding: "utf8" });
      expect(result.status, version).toBe(code);
    }
  });

  it("rechecks current main after attestations and fails closed if it moved or fetch failed", () => {
    const publishJob = cdWorkflow.slice(cdWorkflow.indexOf("\n  publish:"));
    const fenceName = "      - name: Revalidate exact main immediately before npm publication";
    const fenceIndex = publishJob.indexOf(fenceName);
    const mutationFence = publishJob.indexOf("- name: Revalidate exact main immediately before release mutation");
    expect(mutationFence).toBeGreaterThan(-1);
    expect(publishJob.indexOf('git tag "${TAG}"')).toBeGreaterThan(mutationFence);
    expect(fenceIndex).toBeGreaterThan(publishJob.lastIndexOf("actions/attest-build-provenance@"));
    expect(publishJob.indexOf('npm publish "./${TARBALL}"')).toBeGreaterThan(fenceIndex);
    const fence = publishJob.slice(fenceIndex).split("\n      - name:")[0] ?? "";
    const script = fence.split("        run: |\n")[1];
    expect(script).toBeDefined();
    const mockGit = 'git() { if [ "$1" = fetch ]; then return "${FETCH_STATUS}"; elif [ "$1" = rev-parse ]; then printf "%s\\n" "${CURRENT_MAIN}"; else return 99; fi; }\n';
    const expected = "a".repeat(40);
    for (const [current, fetchStatus, code] of [[expected, "0", 0], ["b".repeat(40), "0", 1], [expected, "1", 1]] as const) {
      const result = spawnSync("bash", ["-c", mockGit + script], {
        encoding: "utf8", env: { ...process.env, EXPECTED_SHA: expected, CURRENT_MAIN: current, FETCH_STATUS: fetchStatus },
      });
      expect(result.status, `${current}/${fetchStatus}`).toBe(code);
    }
  });

  it("reads the complete tar listing when pipefail is enabled", () => {
    expect(cdWorkflow).toContain(
      `tar -tzf "\${TARBALL}" | grep -E '^package/dist(/|$)' >/dev/null`,
    );
    expect(cdWorkflow).not.toContain(
      `tar -tzf "\${TARBALL}" | grep -Eq '^package/dist(/|$)'`,
    );
  });

  it("publishes the sealed artifact as an explicit local tarball", () => {
    expect(cdWorkflow).toContain(`npm publish "./\${TARBALL}"`);
    expect(cdWorkflow).not.toContain(`npm publish "\${TARBALL}"`);
  });

  it("rechecks the sealed tarball with the shared exact inventory policy", () => {
    const digestVerification = cdWorkflow.indexOf(
      'TARBALL_SHA256="$(sha256sum "${TARBALL}"',
    );
    const inventoryVerification = cdWorkflow.indexOf(
      'tar -tzf "${TARBALL}" | node scripts/verify-public-package.cjs --inventory-stdin',
    );
    const publish = cdWorkflow.indexOf('npm publish "./${TARBALL}"');

    expect(digestVerification).toBeGreaterThan(-1);
    expect(inventoryVerification).toBeGreaterThan(digestVerification);
    expect(publish).toBeGreaterThan(inventoryVerification);
    expect(cdWorkflow).not.toContain('const prohibited = "legal/cla-registry.csv"');
  });

  it("lands release metadata through a unique non-force-pushed pull request", () => {
    expect(releasePrepareWorkflow).toMatch(
      /- name: Checkout main[\s\S]*?persist-credentials: false/u,
    );
    expect(releasePrepareWorkflow).toContain(
      'BRANCH="release/${TAG}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"',
    );
    expect(releasePrepareWorkflow).not.toContain(
      'git push origin "HEAD:${BASE_BRANCH}"',
    );
    expect(releasePrepareWorkflow).not.toContain("--force-with-lease");
    expect(releasePrepareWorkflow).not.toContain("secrets: inherit");
  });

  it("fails closed on private paths before dependency or release metadata mutation", () => {
    const ciPrivacy = ciWorkflow.indexOf("run: npm run privacy:check");
    const ciInstall = ciWorkflow.indexOf(
      "run: npm ci --no-fund --no-audit --legacy-peer-deps",
    );
    const ciPackage = ciWorkflow.indexOf("run: npm run pack:check");
    expect(ciPrivacy).toBeGreaterThan(-1);
    expect(ciInstall).toBeGreaterThan(ciPrivacy);
    expect(ciPackage).toBeGreaterThan(ciInstall);

    const prepareCheckout = releasePrepareWorkflow.indexOf(
      'git checkout -B "${BASE_BRANCH}" "origin/${BASE_BRANCH}"',
    );
    const preparePrivacy = releasePrepareWorkflow.indexOf(
      'npm --prefix "${PACKAGE_DIRECTORY}" run privacy:check',
    );
    const prepareVersion = releasePrepareWorkflow.indexOf(
      'npm version "${TARGET_VER}"',
    );
    expect(prepareCheckout).toBeGreaterThan(-1);
    expect(preparePrivacy).toBeGreaterThan(prepareCheckout);
    expect(prepareVersion).toBeGreaterThan(preparePrivacy);

    const validationJob = cdWorkflow.slice(
      cdWorkflow.indexOf("\n  validate_and_pack:"),
      cdWorkflow.indexOf("\n  publish:"),
    );
    const publicationPrivacy = validationJob.indexOf("npm run privacy:check");
    const publicationInstall = validationJob.indexOf("npm ci");
    expect(publicationPrivacy).toBeGreaterThan(-1);
    expect(publicationInstall).toBeGreaterThan(publicationPrivacy);
  });

});
