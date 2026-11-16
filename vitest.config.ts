import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["tests/**/*.test.ts"], passWithNoTests: false, coverage: { provider: "v8", include: ["src/**/*.ts", "scripts/verify-first-publication.mjs"], reporter: ["text", "json", "lcov"], thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 } } } });
