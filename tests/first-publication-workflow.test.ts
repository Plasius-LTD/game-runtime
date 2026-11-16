import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/cd.yml", import.meta.url), "utf8");
const step = workflow.split("\n      - name: Publish first package with temporary credential\n")[1]?.split("\n      - name:")[0] ?? "";
const body = step.split("        run: |\n")[1]?.split("\n").map(line => line.replace(/^ {10}/u, "")).join("\n");

describe("first registration CD isolation", () => {
  it("requires a default-off explicit input, forwards it and keeps normal OIDC separate", () => {
    expect(workflow).toMatch(/first_publication:\n\s+description:[^\n]+\n\s+required: false\n\s+type: boolean\n\s+default: false/u);
    expect(workflow).toContain('FIRST_PUBLICATION: ${{ inputs.first_publication }}');
    expect(workflow).toContain('--arg first_publication "${FIRST_PUBLICATION}"');
    expect(workflow).toContain('"first_publication": $first_publication');
    expect(workflow).toContain("if: steps.release.outputs.should_publish_npm == 'true' && !inputs.first_publication");
    expect(step).toContain("if: steps.release.outputs.should_publish_npm == 'true' && inputs.first_publication");
    expect(step).not.toContain("continue-on-error");
    const outside = workflow.replace(`\n      - name: Publish first package with temporary credential\n${step}`, "");
    expect(outside).not.toMatch(/NPM_BOOTSTRAP_CREDENTIAL|NPM_BOOTSTRAP_TOKEN|_authToken/u);
    expect(step).toContain("NPM_BOOTSTRAP_CREDENTIAL: ${{ secrets.NPM_BOOTSTRAP_TOKEN }}");
  });

  it.each([
    ["0", "0", "0", "a".repeat(40), 0, true],
    ["0", "0", "17", "a".repeat(40), 17, true],
    ["1", "0", "0", "a".repeat(40), 1, false],
    ["0", "1", "0", "a".repeat(40), 1, false],
    ["0", "0", "0", "b".repeat(40), 1, false],
  ] as const)("cleans configuration and fails closed (guard %s, fetch %s, publish %s, main %s)", (guardStatus, fetchStatus, publishStatus, remote, expected, published) => {
    expect(body).toBeDefined();
    const directory = mkdtempSync(join(tmpdir(), "arcade-first-release-test-"));
    const marker = join(directory, "published");
    const mocks = `
node() { [ "$1" = scripts/verify-first-publication.mjs ] || return 99; return "$GUARD_STATUS"; }
git() { if [ "$1" = fetch ]; then return "$FETCH_STATUS"; elif [ "$1" = rev-parse ]; then if [ "$2" = HEAD ]; then printf '%s' "$EXPECTED_SHA"; else printf '%s' "$REMOTE_SHA"; fi; else return 99; fi; }
npm() {
  [ "$1" = publish ] && [ "$2" = ./sealed.tgz ] && [ "$3" = --ignore-scripts ] || return 98
  [ "$NPM_BOOTSTRAP_CREDENTIAL" = synthetic-test-credential ] || return 97
  [ "$(cat "$NPM_CONFIG_USERCONFIG")" = '//registry.npmjs.org/:_authToken=\${NPM_BOOTSTRAP_CREDENTIAL}' ] || return 96
  case "$(ls -l "$NPM_CONFIG_USERCONFIG")" in -rw-------*) ;; *) return 95 ;; esac
  printf '%s' "$*" > "$PUBLISH_MARKER"
  return "$PUBLISH_STATUS"
}
`;
    try {
      const result = spawnSync("bash", ["-c", mocks + body], { encoding: "utf8", env: {
        ...process.env, RUNNER_TEMP: directory, EXPECTED_SHA: "a".repeat(40), REMOTE_SHA: remote,
        GUARD_STATUS: guardStatus, FETCH_STATUS: fetchStatus, PUBLISH_STATUS: publishStatus,
        NPM_BOOTSTRAP_CREDENTIAL: "synthetic-test-credential", TARBALL: "sealed.tgz", DIST_TAG: "latest", PUBLISH_MARKER: marker,
      } });
      expect(result.status, result.stderr).toBe(expected);
      expect(existsSync(marker)).toBe(published);
      if (published) expect(readFileSync(marker, "utf8")).toContain("--access public --provenance --registry https://registry.npmjs.org --tag latest");
      expect(readdirSync(directory).filter(name => name !== "published")).toEqual([]);
      expect(result.stdout + result.stderr).not.toContain("synthetic-test-credential");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
