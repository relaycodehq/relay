// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  document.documentElement.removeAttribute("style");
});

const promptSize = () =>
  document.documentElement.style.getPropertyValue("--prompt-font-size");

it("keeps an explicitly chosen 13 px prompt size through reload", async () => {
  const typography = await import("./typography");
  typography.initTypography();
  typography.setTypography({ interfaceSize: 16, promptSize: 13 });
  expect(promptSize()).toBe("10.563px");
  vi.resetModules();
  (await import("./typography")).initTypography();
  expect(promptSize()).toBe("10.563px");
});

it("applies typography changed in another window", async () => {
  const typography = await import("./typography");
  typography.initTypography();
  const saved = JSON.stringify({
    ...typography.defaultTypography,
    interfaceSize: 16,
    promptSize: 13,
    mono: "Fixture Mono",
    wrap: true,
  });
  localStorage.setItem("relay-typography", saved);
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: "relay-typography",
      newValue: saved,
      storageArea: localStorage,
    }),
  );
  expect(promptSize()).toBe("10.563px");
  expect(
    document.documentElement.style.getPropertyValue("--font-mono"),
  ).toContain('"Fixture Mono"');
  expect(document.documentElement.hasAttribute("data-wrap")).toBe(true);
});
