import { expect, it } from "vitest";
import { withoutImages } from "./recording";

it("leaves the window's images out of a trace and keeps it valid JSON", () => {
  const png = "data:image/png;base64," + "iVBORw0KGgo".repeat(20);
  const svg = `data:image/svg+xml,<svg title="${"x".repeat(80)}"></svg>`;
  const trace = JSON.stringify({
    traceEvents: [{ args: { data: { url: png } } }, { args: { url: svg } }],
    small: "data:,",
  });
  const out = withoutImages(trace);
  expect(out).not.toContain("iVBORw0KGgo");
  expect(out).not.toContain("<svg");
  expect(JSON.parse(out).small).toBe("data:,");
});
