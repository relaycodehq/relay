import { rm, stat } from "node:fs/promises";
import { expect, it } from "vitest";
import { emptyCwd } from "./helper-output";

it("makes the helpers' folder again once the system's temp cleaner removed it", async () => {
  const first = await emptyCwd();
  // As systemd-tmpfiles does to a folder left alone for 10 days on a Linux server.
  await rm(first, { recursive: true, force: true });
  const next = await emptyCwd();
  expect((await stat(next)).isDirectory()).toBe(true);
  await rm(next, { recursive: true, force: true });
});
