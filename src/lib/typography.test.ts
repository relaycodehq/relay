// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { settingsBridge } from "../../tests/unit/settings-file-bridge";

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  document.documentElement.removeAttribute("style");
});

const css = (name: string) =>
  document.documentElement.style.getPropertyValue(name);

it("keeps an explicitly chosen 13 px prompt size through reload", async () => {
  const bridge = settingsBridge();
  const typography = await import("./typography");
  typography.initTypography();
  typography.setTypography({ interfaceSize: 16, promptSize: 13 });
  expect(css("--prompt-font-size")).toBe("10.563px");
  await vi.waitFor(() =>
    expect(bridge.file.values).toEqual({
      typography: { interfaceSize: 16, promptSize: 13 },
    }),
  );
  vi.resetModules();
  (await import("./typography")).initTypography();
  expect(css("--prompt-font-size")).toBe("10.563px");
});

it("follows settings.json as a script changes it, with defaults for keys that don't read", async () => {
  const bridge = settingsBridge({ typography: { codeSize: 14 } });
  const typography = await import("./typography");
  typography.initTypography();
  expect(css("--code-font-size")).toBe("14px");

  bridge.change({
    typography: {
      interfaceSize: 16,
      promptSize: 13,
      codeFont: "Fixture Mono",
      codeSize: "big",
      wrapCode: true,
    },
  });
  expect(css("--prompt-font-size")).toBe("10.563px");
  expect(css("--font-mono")).toContain('"Fixture Mono"');
  expect(css("--code-font-size")).toBe(`${+((12 * 13) / 16).toFixed(3)}px`);
  expect(document.documentElement.hasAttribute("data-wrap")).toBe(true);

  // Gone from the file, back to the default.
  bridge.change({});
  expect(css("--code-font-size")).toBe("12px");
  expect(document.documentElement.hasAttribute("data-wrap")).toBe(false);
});

it("moves typography saved before the file into it, unless the file already has some", async () => {
  const saved = JSON.stringify({
    interfaceSize: 15,
    codeSize: 14,
    mono: "Old Mono",
    advanced: true,
  });
  localStorage.setItem("relay-typography", saved);
  const bridge = settingsBridge();
  const typography = await import("./typography");
  typography.initTypography();
  expect(css("--font-mono")).toContain('"Old Mono"');
  await vi.waitFor(() =>
    expect(localStorage.getItem("relay-typography")).toBeNull(),
  );
  expect(bridge.file.values).toEqual({
    typography: { interfaceSize: 15, codeFont: "Old Mono", codeSize: 14 },
  });
  // The switch that shows every row stays with the window.
  expect(localStorage.getItem("relay-typography-advanced")).toBe("1");

  // A file a script wrote first wins; the old values are dropped.
  vi.resetModules();
  localStorage.setItem("relay-typography", saved);
  settingsBridge({ typography: { interfaceSize: 12 } });
  (await import("./typography")).initTypography();
  expect(css("--font-mono")).not.toContain("Old Mono");
  expect(localStorage.getItem("relay-typography")).toBeNull();
});
