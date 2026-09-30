import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Pins "today" — see test/setup.ts.
    setupFiles: ["test/setup.ts"],
  },
});
