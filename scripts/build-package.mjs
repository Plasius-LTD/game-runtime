import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { build } from "esbuild";
import { generateDtsBundle } from "dts-bundle-generator";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const entries = Object.keys(manifest.exports).map(name => name === "." ? "index" : name.slice(2));
const dependencies = Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies });

/** Build one explicit public entry; declaration generation uses the installed TypeScript compiler. */
export async function buildEntry(name, { outDir = "dist" } = {}, { compile = build, declarations = generateDtsBundle } = {}) {
  if (!entries.includes(name)) throw new TypeError("Unknown public build entry.");
  const output = resolve(outDir, name);
  const input = {
    entryPoints: [`src/${name}.ts`], bundle: true, platform: "neutral", target: "es2022",
    external: ["node:*", ...builtinModules, ...dependencies],
    sourcemap: true, legalComments: "inline", logLevel: "warning",
  };
  for (const formatOptions of [
    { outfile: `${output}.js`, format: "esm" },
    { outfile: `${output}.cjs`, format: "cjs" },
  ]) await compile({ ...input, ...formatOptions });
  const [declaration] = declarations([{ filePath: `src/${name}.ts`, output: { exportReferencedTypes: false } }], { preferredConfigPath: "tsconfig.json" });
  if (typeof declaration !== "string" || !declaration.trim()) throw new TypeError("Missing public declaration output.");
  mkdirSync(dirname(output), { recursive: true });
  // Both formats have the same named API and no relative declaration imports.
  for (const extension of ["d.ts", "d.cts"]) writeFileSync(`${output}.${extension}`, declaration);
}

/** Independent sequential builds avoid common chunks and overlapping directory cleanup. */
export async function buildPackage(run = buildEntry, { outDir = "dist" } = {}) {
  const fromOutputToRoot = relative(resolve(outDir), process.cwd());
  if (!fromOutputToRoot || (!fromOutputToRoot.startsWith("..") && !isAbsolute(fromOutputToRoot))) throw new TypeError("Build output cannot contain the repository root.");
  rmSync(outDir, { force: true, recursive: true });
  for (const name of entries) await run(name, { outDir });
}

export async function main(argv = process.argv.slice(2), operations = { buildPackage, buildEntry }) {
  if (argv.length === 0) return operations.buildPackage();
  if (argv.length === 4 && argv[0] === "--entry" && argv[2] === "--out-dir" && argv[3]) {
    return operations.buildEntry(argv[1], { outDir: argv[3] });
  }
  throw new TypeError("Unsupported build arguments.");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
