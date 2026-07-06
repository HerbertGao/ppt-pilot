import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    clearMocks: true,
    unstubGlobals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Run test files sequentially. Parallel jsdom environments starve CPU and make
    // cold-start `waitFor`s (auto-drive chains under userEvent) exceed testing-
    // library's timeout non-deterministically; serial is deterministic (112/112)
    // and only ~15s slower at this suite size.
    fileParallelism: false,
  },
});
