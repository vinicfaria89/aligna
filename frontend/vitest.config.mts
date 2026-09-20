import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Vitest configuration (TASK-025). The AIE server/library tests run in the default
 * `node` environment exactly as before. The React component tests opt into the
 * DOM per file with a `// @vitest-environment jsdom` docblock. The alias mirrors
 * tsconfig's "@/*" so components can be imported the way the app imports them.
 */
export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },

  test: {
    environment: "node",
  },
});