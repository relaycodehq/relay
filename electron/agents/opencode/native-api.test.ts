import { expect, it } from "vitest";
import { staleService } from "./native-api";

it("tells a service an older OpenCode left running from the installed one", () => {
  const info = (version: string) => JSON.stringify({ version, pid: 1 });
  expect(staleService("2.1.4", info("2.0.32"))).toBe(true);
  expect(staleService("2.1.4", info("2.1.4"))).toBe(false);
  // Nothing to go by: leave the service alone.
  expect(staleService("", info("2.0.32"))).toBe(false);
  expect(staleService("2.1.4", "not json")).toBe(false);
  expect(staleService("2.1.4", "{}")).toBe(false);
});
