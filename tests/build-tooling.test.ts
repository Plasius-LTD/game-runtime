import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
// @ts-expect-error The build script is JavaScript and exercised as a contributor tool.
import { buildEntry, buildPackage, main } from "../scripts/build-package.mjs";

it("removes the builder that embeds an unreplaceable vulnerable Picomatch implementation", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  expect(manifest.devDependencies).not.toHaveProperty("tsup");
  expect(lock.packages).not.toHaveProperty("node_modules/tsup");
  for (const name of ["esbuild", "dts-bundle-generator"]) {
    expect(manifest.devDependencies[name]).toMatch(/^\d+\.\d+\.\d+$/);
    const root = join("node_modules", name);
    const files = readdirSync(root, { recursive: true, withFileTypes: true }).filter(e => e.isFile() && /\.(?:m?js|cjs|map)$/.test(e.name));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(join(file.parentPath, file.name), "utf8");
      expect(/picomatch\/lib\/(?:parse|picomatch)\.js|require_picomatch|analyzeRepeatedExtglob/.test(source), `${name}/${file.name} contains embedded Picomatch`).toBe(false);
    }
  }
});

it("emits both formats and self-contained declarations without changing external dependencies", async () => {
  const output = mkdtempSync(join(tmpdir(), "game-runtime-build-contract-"));
  const compile = vi.fn(async () => {});
  const declarations = vi.fn(() => ["export declare const value: unknown;\n"]);
  try {
    await buildEntry("saves", { outDir: output }, { compile, declarations });
    expect(compile.mock.calls).toHaveLength(2);
    const options = compile.mock.calls.map(call => (call as any[])[0]);
    expect(options.map(option => option.format)).toEqual(["esm", "cjs"]);
    for (const option of options) {
      expect(option).toMatchObject({ entryPoints: ["src/saves.ts"], bundle: true, platform: "neutral", target: "es2022", sourcemap: true, legalComments: "inline" });
      expect(option.external).toEqual(expect.arrayContaining(["node:*", "fs", "@plasius/schema"]));
    }
    expect(declarations).toHaveBeenCalledWith([{ filePath: "src/saves.ts", output: { exportReferencedTypes: false } }], { preferredConfigPath: "tsconfig.json" });
    for (const extension of ["d.ts", "d.cts"]) {
      expect(readFileSync(join(output, `saves.${extension}`), "utf8")).toBe("export declare const value: unknown;\n");
    }
  } finally { rmSync(output, { recursive: true, force: true }); }
});

it("rejects unknown entries, stops on compiler errors and refuses missing declaration output", async () => {
  const output = mkdtempSync(join(tmpdir(), "game-runtime-build-failure-"));
  const compile = vi.fn(async () => {});
  const declarations = vi.fn(() => ["export {};\n"]);
  try {
    await expect(buildEntry("../../outside", { outDir: output }, { compile, declarations })).rejects.toThrow("Unknown public build entry");
    expect(compile).not.toHaveBeenCalled(); expect(declarations).not.toHaveBeenCalled();
    compile.mockRejectedValueOnce(new Error("compiler failed"));
    await expect(buildEntry("index", { outDir: output }, { compile, declarations })).rejects.toThrow("compiler failed");
    expect(compile).toHaveBeenCalledOnce(); expect(declarations).not.toHaveBeenCalled();
    for (const values of [[], [" "], [null]]) {
      await expect(buildEntry("index", { outDir: output }, { compile, declarations: () => values })).rejects.toThrow("Missing public declaration");
      expect(existsSync(join(output, "index.d.ts"))).toBe(false);
    }
    await expect(buildEntry("index", { outDir: output }, { compile, declarations: () => { throw new Error("invalid public types"); } })).rejects.toThrow("invalid public types");
  } finally { rmSync(output, { recursive: true, force: true }); }
});

it("cleans stale output before rebuilding and never deletes the repository or its parents", async () => {
  const output = mkdtempSync(join(tmpdir(), "game-runtime-build-clean-"));
  const run = vi.fn(async () => { expect(existsSync(join(output, "stale.js"))).toBe(false); });
  try {
    writeFileSync(join(output, "stale.js"), "stale output");
    await buildPackage(run, { outDir: output });
    expect(run).toHaveBeenCalledTimes(4);
    expect(run.mock.calls.map(call => (call as any[])[0])).toEqual(["index", "saves", "browser-recovery", "browser"]);
    const failure = vi.fn(async () => { throw new Error("entry build failed"); });
    await expect(buildPackage(failure, { outDir: output })).rejects.toThrow("entry build failed");
    expect(failure).toHaveBeenCalledOnce();
    for (const outDir of [".", "..", "/"]) await expect(buildPackage(run, { outDir })).rejects.toThrow("cannot contain the repository root");
    expect(existsSync("package.json")).toBe(true);
  } finally { rmSync(output, { recursive: true, force: true }); }
});

it("accepts only the complete public build or an explicit single-entry build", async () => {
  const operations = { buildPackage: vi.fn(), buildEntry: vi.fn() };
  await main([], operations); expect(operations.buildPackage).toHaveBeenCalledOnce();
  await main(["--entry", "index", "--out-dir", "output"], operations);
  expect(operations.buildEntry).toHaveBeenCalledWith("index", { outDir: "output" });
  for (const args of [["--entry"], ["--unknown", "index", "--out-dir", "output"], ["--entry", "index", "--bad", "output"], ["--entry", "index", "--out-dir", ""]]) {
    await expect(main(args, operations)).rejects.toThrow("Unsupported build arguments");
  }
});
