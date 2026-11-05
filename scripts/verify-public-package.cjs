#!/usr/bin/env node
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  collectRepositoryArtifactPaths,
  comparePackageArtifactAllowlist,
  findPackageFilesPolicyViolations,
  findPrivateArtifactViolations,
} = require("./private-artifact-policy.cjs");

const EXPECTED_PACKAGE_FILES = Object.freeze(["dist"]);

const EXPECTED_PACKED_PATHS = Object.freeze(["LICENSE", "README.md", "package.json", "dist/index.js", "dist/index.js.map", "dist/index.cjs", "dist/index.cjs.map", "dist/index.d.ts", "dist/index.d.cts"]);


function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === "--inventory-stdin") {
    verifyStdinPackageInventory();
    return;
  }
  if (argv.length > 0) {
    throw new Error("Unsupported public package check arguments.");
  }

  const cacheDir = path.resolve(process.cwd(), ".npm-cache-packcheck");
  try {
    let repositoryPaths;
    try {
      repositoryPaths = collectRepositoryArtifactPaths(process.cwd());
    } catch {
      throw new Error(
        "Repository path metadata could not be evaluated; details were not logged."
      );
    }
    const repositoryViolations =
      findPrivateArtifactViolations(repositoryPaths);
    if (repositoryViolations.length > 0) {
      throw new Error(
        `Prohibited private artifact path metadata was found (${summarizePrivateArtifactViolations(repositoryViolations)}); values were not logged.`
      );
    }

    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")
    );
    const packageFilesViolations = findPackageFilesPolicyViolations(
      packageJson.files,
      EXPECTED_PACKAGE_FILES
    );
    if (packageFilesViolations.length > 0) {
      const ruleIds = [
        ...new Set(packageFilesViolations.map(({ ruleId }) => ruleId)),
      ].sort();
      throw new Error(
        `package.json files policy failed (${ruleIds.join(", ")}).`
      );
    }


    let output;
    try {
      output = runNpmPack(cacheDir);
    } catch {
      throw new Error(
        "npm package inventory could not be produced; details were not logged."
      );
    }
    const parsed = parseNpmPackJson(output);
    const files =
      Array.isArray(parsed) && Array.isArray(parsed[0]?.files)
        ? parsed[0].files
        : [];
    const paths = files
      .map((entry) => entry?.path)
      .filter((entry) => typeof entry === "string");

    verifyPackagePathInventory(paths);

    verifyPackageContents({ packageJson, paths });
  } finally {
    fs.rmSync(cacheDir, { force: true, recursive: true });
  }
}

function verifyStdinPackageInventory() {
  const input = fs.readFileSync(0);
  if (input.byteLength > 16 * 1024 * 1024) {
    throw new Error("Packed path inventory exceeds the 16 MiB limit.");
  }

  const paths = input
    .toString("utf8")
    .split("\n")
    .filter((entry) => entry.length > 0);
  verifyPackagePathInventory(paths);
  console.log("Sealed package inventory check passed.");
}

function verifyPackagePathInventory(paths) {
  const privateArtifactViolations = findPrivateArtifactViolations(paths);
  if (privateArtifactViolations.length > 0) {
    throw new Error(
      `Packed output contains prohibited private artifact path metadata (${summarizePrivateArtifactViolations(privateArtifactViolations)}); values were not logged.`
    );
  }

  const packageAllowlist = comparePackageArtifactAllowlist(
    paths,
    EXPECTED_PACKED_PATHS
  );
  if (
    packageAllowlist.missingPaths.length > 0 ||
    packageAllowlist.unexpectedPaths.length > 0
  ) {
    throw new Error(
      `Packed paths differ from the exact allowlist (${packageAllowlist.missingPaths.length} missing, ${packageAllowlist.unexpectedPaths.length} unexpected); values were not logged.`
    );
  }
}

function verifyPackageContents({ packageJson }) {
  const expected = { types: "./dist/index.d.ts", import: "./dist/index.js", require: "./dist/index.cjs" };
  if (JSON.stringify(packageJson.exports) !== JSON.stringify({ ".": expected })) {
    throw new Error("Package dual-module exports are incorrect.");
  }
  const api = require(path.resolve(process.cwd(), "dist/index.cjs"));
  for (const name of ["createGameRuntime", "createRandom", "parseInput", "parseCheckpoint"]) {
    if (typeof api[name] !== "function") throw new Error("Required runtime export is missing.");
  }
}

function runNpmPack(cacheDir) {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : "npm";
  const args = npmExecPath
    ? [npmExecPath, "pack", "--dry-run", "--json", "--ignore-scripts"]
    : ["pack", "--dry-run", "--json", "--ignore-scripts"];
  args.push("--cache", cacheDir);

  return execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function summarizePrivateArtifactViolations(violations) {
  const counts = new Map();
  for (const violation of violations) {
    counts.set(violation.ruleId, (counts.get(violation.ruleId) || 0) + 1);
  }
  return [...counts]
    .sort(([left], [right]) => left.localeCompare(right, "en-US"))
    .map(([ruleId, count]) => `${ruleId}: ${count}`)
    .join(", ");
}

function parseNpmPackJson(rawOutput) {
  const start = rawOutput.indexOf("[");
  const end = rawOutput.lastIndexOf("]");

  if (start < 0 || end < start) {
    throw new Error("Could not find npm pack JSON payload in command output.");
  }

  const jsonSlice = rawOutput.slice(start, end + 1);
  return JSON.parse(jsonSlice);
}



if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Public package check failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  EXPECTED_PACKED_PATHS,
  main,
  verifyPackagePathInventory,
};
