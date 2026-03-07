import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig(async () => ({
  plugins: await WxtVitest(),
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/manifest-build.test.ts"],
    restoreMocks: true,
  },
}));
