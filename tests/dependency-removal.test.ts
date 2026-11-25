import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

it("uses the verified Plasius adapter for every matcher resolution without original or embedded Picomatch code", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  expect(manifest.overrides.picomatch).toBe("npm:@plasius/glob@1.0.2");
  expect(manifest.overrides.minimatch).toBe("11.0.9");
  const packages = Object.entries(lock.packages) as [string, { name?: string; version?: string; resolved?: string; integrity?: string }][];
  const aliases = packages.filter(([path]) => /(?:^|\/)node_modules\/picomatch$/.test(path));
  expect(aliases.length).toBeGreaterThan(0);
  for (const [path, value] of packages) {
    expect(value.name).not.toBe("picomatch");
    expect(value.resolved ?? "").not.toMatch(/registry\.npmjs\.org\/picomatch\//);
    if (/(?:^|\/)node_modules\/minimatch$/.test(path)) expect(value.version).toBe("11.0.9");
    const file = join(path, "package.json");
    if (path && existsSync(file)) expect(JSON.parse(readFileSync(file, "utf8")).name).not.toBe("picomatch");
  }
  for (const [path, value] of aliases) {
    expect(value).toMatchObject({ name: "@plasius/glob", version: "1.0.2",
      resolved: "https://registry.npmjs.org/@plasius/glob/-/glob-1.0.2.tgz",
      integrity: "sha512-hDIfFBA4SpwLn/aZzICaaRJFU7sRDW34txSvyrIiDbQatRgmpuTDKqNRAMw1LAlwMTQpZYvTpzmT3DEDzH3jew==" });
    const installed = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
    expect(installed).toMatchObject({ name: "@plasius/glob", version: "1.0.2", dependencies: { minimatch: "11.0.9" } });
  }
  const files = readdirSync("node_modules", { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && /\.(?:m?js|cjs|map)$/.test(entry.name));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const path = join(file.parentPath, file.name);
    expect(/picomatch\/lib\/(?:parse|picomatch)\.js|require_picomatch|analyzeRepeatedExtglob/.test(readFileSync(path, "utf8")),
      `${path} contains an original or embedded Picomatch implementation`).toBe(false);
  }
});
