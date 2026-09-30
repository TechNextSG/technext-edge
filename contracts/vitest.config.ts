import { defineConfig } from "vitest/config";

// Present even though it only sets `include`: without a config file vite searches the parent
// directories for one, and on a drive with a stray vite.config.ts it loads that instead.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
