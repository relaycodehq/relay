import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { parseVersion } from "../../shared/agent-updates";

it("lets executable discovery accept the mock without trying an installed agent", () => {
  const version = execFileSync(
    process.execPath,
    [resolve("tests/fixtures/room-agent.cjs"), "--version"],
    { encoding: "utf8", timeout: 5000 },
  );
  expect(parseVersion(version)).toBeTruthy();
});
