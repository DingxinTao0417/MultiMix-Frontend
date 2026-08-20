import { afterAll } from "vitest";

type JSDOMGlobal = typeof globalThis & {
  jsdom?: { window: Window };
};

const testWindow = (globalThis as JSDOMGlobal).jsdom?.window;

if (testWindow) {
  const storageNames = ["localStorage", "sessionStorage"] as const;
  const originalDescriptors = new Map(
    storageNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );

  for (const name of storageNames) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      enumerable: true,
      get: () => testWindow[name],
    });
  }

  afterAll(() => {
    for (const name of storageNames) {
      const originalDescriptor = originalDescriptors.get(name);
      if (originalDescriptor) {
        Object.defineProperty(globalThis, name, originalDescriptor);
      } else {
        delete (globalThis as Record<string, unknown>)[name];
      }
    }
  });
}
