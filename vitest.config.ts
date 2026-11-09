import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts"],
    // wa-outreach builds on the app-outreach rule engine, which lives in another module of the monorepo.
    exclude: ["src/lib/wa-outreach.test.ts"],
  },
});
