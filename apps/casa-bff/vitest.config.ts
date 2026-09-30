import { defineConfig } from "vitest/config";

// Same shape as packages/extractor/vitest.config.ts, on purpose: both workspaces run
// their own suite from their own directory, so `npm test` at the root covers the repo
// without either package reaching into the other's test/ tree.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Pins "today" — see test/setup.ts.
    setupFiles: ["test/setup.ts"],
  },
});
