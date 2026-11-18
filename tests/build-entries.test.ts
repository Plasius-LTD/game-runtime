import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("keeps optional adapters outside the real built root in both formats", () => {
  const output = mkdtempSync(join(tmpdir(), "independent-root-build-"));
  try {
    execFileSync(process.execPath, ["scripts/build-package.mjs", "--entry", "index", "--out-dir", output], { stdio: "pipe" });
    for (const extension of ["js", "cjs"]) {
      const bundle = readFileSync(join(output, `index.${extension}`), "utf8");
      for (const name of ["createSaveSession", "createBrowserRecoveryStore", "indexedDB"]) expect(bundle).not.toContain(name);
      const map = JSON.parse(readFileSync(join(output, `index.${extension}.map`), "utf8"));
      expect(map.version).toBe(3); expect(map.mappings.length).toBeGreaterThan(0);
      expect(map.sourcesContent).toHaveLength(map.sources.length);
    }
    for (const extension of ["d.ts", "d.cts"]) {
      const types = readFileSync(join(output, `index.${extension}`), "utf8");
      for (const name of ["createSaveSession", "createBrowserRecoveryStore", "indexedDB"]) expect(types).not.toContain(name);
      expect(types).toContain("export");
    }
  } finally { rmSync(output, { recursive: true, force: true }); }
}, 30_000);
