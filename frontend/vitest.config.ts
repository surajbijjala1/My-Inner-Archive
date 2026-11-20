import { defineConfig } from "vitest/config";

// Unit tests only: no network, no real browser. jsdom stands in for the page;
// anything it lacks (Web Audio, matchMedia) is faked inside the test that needs it.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
