import { describe, expect, it } from "vitest";
import { idleShutdownOff, withoutIdleShutdown, wslDistro } from "./wsl";

describe("wslDistro", () => {
  it("names the distribution only inside WSL", () => {
    const env = { WSL_DISTRO_NAME: "Ubuntu" };
    expect(
      wslDistro(env, "Linux version 6.18.54.1-microsoft-standard-WSL2"),
    ).toBe("Ubuntu");
    expect(wslDistro(env, "Linux version 6.8.0-45-generic")).toBeUndefined();
  });
});

describe(".wslconfig", () => {
  it("turns idle shutdown off and leaves the rest as it was", () => {
    const config = "[wsl2]\r\nmemory=8GB\r\nnetworkingMode=mirrored\r\n";
    const next = withoutIdleShutdown(config);
    expect(next).toBe(
      "[general]\r\ninstanceIdleTimeout=-1\r\n\r\n[wsl2]\r\nmemory=8GB\r\nnetworkingMode=mirrored\r\n",
    );
    expect(idleShutdownOff(next)).toBe(true);
    expect(idleShutdownOff(config)).toBe(false);
  });

  it("changes a timeout already set, in its own section only", () => {
    const config = [
      "[general]",
      "instanceIdleTimeout = 15000",
      "[wsl2]",
      "instanceIdleTimeout=5",
    ].join("\n");
    expect(withoutIdleShutdown(config)).toBe(
      [
        "[general]",
        "instanceIdleTimeout=-1",
        "[wsl2]",
        "instanceIdleTimeout=5",
      ].join("\n"),
    );
    expect(idleShutdownOff("[wsl2]\ninstanceIdleTimeout=-1")).toBe(false);
  });

  it("adds the key to a [general] section without one", () => {
    expect(withoutIdleShutdown("[general]\nsafeMode=false\n")).toBe(
      "[general]\ninstanceIdleTimeout=-1\nsafeMode=false\n",
    );
    expect(withoutIdleShutdown("")).toBe("[general]\ninstanceIdleTimeout=-1\n");
  });
});
