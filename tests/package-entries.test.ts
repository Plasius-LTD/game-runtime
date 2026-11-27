import { createRequire } from "node:module";
import fs, { readFileSync } from "node:fs";
import childProcess from "node:child_process";
import Module from "node:module";
import { describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const pack = vi.spyOn(childProcess, "execFileSync");
const { EXPECTED_PACKED_PATHS, verifyPackageContents, verifyPackagePathInventory, main } = require("../scripts/verify-public-package.cjs");
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const exports = { createGameRuntime() {}, createRandom() {}, parseInput() {}, parseCheckpoint() {}, createSaveSession() {}, createBrowserRecoveryStore() {}, createBrowserGameControls() {}, createBrowserGameLoop() {} };

describe("independent dual-module package entry policy", () => {
  it("requires exact self-contained runtime, saves and browser entries", () => {
    expect(EXPECTED_PACKED_PATHS).toHaveLength(27);
    verifyPackagePathInventory(EXPECTED_PACKED_PATHS);
    verifyPackageContents({ packageJson: manifest }, () => exports);
    for (const key of [".", "./saves", "./browser-recovery", "./browser"]) {
      const changed = structuredClone(manifest); delete changed.exports[key];
      expect(() => verifyPackageContents({ packageJson: changed }, () => exports)).toThrow("exports are incorrect");
    }
    for (const name of Object.keys(exports)) {
      expect(() => verifyPackageContents({ packageJson: manifest }, () => ({ ...exports, [name]: undefined }))).toThrow("export is missing");
    }
    expect(() => verifyPackagePathInventory([...EXPECTED_PACKED_PATHS, "dist/accidental.js"])).toThrow("exact allowlist");
    expect(() => verifyPackagePathInventory(EXPECTED_PACKED_PATHS.slice(1))).toThrow("exact allowlist");
    expect(() => verifyPackagePathInventory([...EXPECTED_PACKED_PATHS, "legal/cla-registry.csv"])).toThrow("prohibited private");
    expect(() => main(["--unsupported"])).toThrow("Unsupported");
  });

  it("checks npm's actual inventory contract, module loading and failure cleanup", () => {
    const load = (Module as any)._load;
    const loader = vi.spyOn(Module as any, "_load").mockImplementation((...args: any[]) =>
      /\/dist\/(index|saves|browser-recovery|browser)\.cjs$/.test(args[0]) ? exports : load(...args));
    const inventory = JSON.stringify([{ files: EXPECTED_PACKED_PATHS.map((path: string) => ({ path })) }]);
    const remove = vi.spyOn(fs, "rmSync").mockImplementation(() => {});
    try {
      pack.mockReturnValue(`npm notice\n${inventory}\n`);
      main([]);
      expect(remove).toHaveBeenCalledWith(expect.stringContaining(".npm-cache-packcheck"), { force: true, recursive: true });
      pack.mockReturnValue("not JSON"); expect(() => main([])).toThrow("Could not find npm pack JSON");
      pack.mockReturnValue("[]"); expect(() => main([])).toThrow("exact allowlist");
      pack.mockImplementation(() => { throw new Error("private details"); });
      expect(() => main([])).toThrow("inventory could not be produced; details were not logged");
    } finally { loader.mockRestore(); remove.mockRestore(); }
  });

  it("rejects broadened file metadata and checks exact sealed inventories from stdin", () => {
    const read = fs.readFileSync;
    const spy = vi.spyOn(fs, "readFileSync");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      spy.mockImplementation((...args: any[]) => {
        if (args[0] === 0) return Buffer.from(EXPECTED_PACKED_PATHS.join("\n"));
        if (String(args[0]).endsWith("/package.json")) return JSON.stringify({ ...manifest, files: ["*"] });
        return (read as any)(...args);
      });
      expect(() => main([])).toThrow("files policy failed");
      main(["--inventory-stdin"]); expect(log).toHaveBeenCalledWith("Sealed package inventory check passed.");
      spy.mockImplementation((...args: any[]) => args[0] === 0 ? Buffer.alloc(16 * 1024 * 1024 + 1) : (read as any)(...args));
      expect(() => main(["--inventory-stdin"])).toThrow("16 MiB");
    } finally { spy.mockRestore(); log.mockRestore(); }
  });
});
