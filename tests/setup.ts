import { afterEach } from "vitest";

const defaultChrome = {
  storage: {
    local: {
      async get() {
        return {};
      },
      async set() {},
      async remove() {},
    },
  },
} as any;

Object.defineProperty(globalThis, "chrome", {
  configurable: true,
  writable: true,
  value: defaultChrome,
});

afterEach(() => {
  globalThis.chrome = defaultChrome;
});
