import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { androidSdk, hubEnv, tokenIn } from "./hub";

describe("tokenIn", () => {
  it("reads the token from the hub's startup link", () => {
    const output = [
      "Expo Device Hub ready",
      "",
      "  Local:   http://localhost:3461/?token=hWPbzF85TqTx9hKFsfJyyqhCh3T8y1PFis0dzQlebCQ",
      "  Network: pass --host 0.0.0.0 to expose on your local network",
    ].join("\n");
    expect(tokenIn(output)).toBe("hWPbzF85TqTx9hKFsfJyyqhCh3T8y1PFis0dzQlebCQ");
  });

  it("waits for the whole line", () => {
    expect(tokenIn("Local:   http://localhost:3461/?token=hWPb")).toBeUndefined();
  });
});

describe("androidSdk", () => {
  async function sdkAt(dir: string) {
    await mkdir(join(dir, "platform-tools"), { recursive: true });
    await writeFile(join(dir, "platform-tools", "adb"), "");
    return dir;
  }

  it("prefers ANDROID_HOME over the default folder", async () => {
    const home = await mkdtemp(join(tmpdir(), "relay-sdk-"));
    await sdkAt(join(home, "Library", "Android", "sdk"));
    const custom = await sdkAt(join(home, "custom-sdk"));
    expect(await androidSdk({ ANDROID_HOME: custom }, "darwin", home)).toBe(custom);
  });

  it("finds the Android Studio default and skips a folder without adb", async () => {
    const home = await mkdtemp(join(tmpdir(), "relay-sdk-"));
    const empty = join(home, "empty");
    await mkdir(empty);
    const studio = await sdkAt(join(home, "Library", "Android", "sdk"));
    expect(await androidSdk({ ANDROID_HOME: empty }, "darwin", home)).toBe(studio);
    expect(await androidSdk({}, "linux", home)).toBeUndefined();
  });
});

it("puts the SDK's tools first on the hub's PATH", () => {
  const env = hubEnv({ PATH: "/usr/bin" }, "/sdk");
  expect(env.ANDROID_HOME).toBe("/sdk");
  expect(env.PATH).toBe(
    [join("/sdk", "platform-tools"), join("/sdk", "emulator"), "/usr/bin"].join(delimiter),
  );
});
