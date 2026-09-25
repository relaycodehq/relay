import { describe, expect, it } from "vitest";
import {
  extractPath,
  hydratePath,
  loginShells,
  mergePath,
  type Run,
} from "../../electron/shell-path";

const marked = (path: string, noise = "") =>
  `${noise}__RELAY_PATH_START__\n${path}\n__RELAY_PATH_END__\n`;

describe("extractPath", () => {
  it("ignores whatever the profile prints around the markers", () => {
    expect(
      extractPath(
        marked("/opt/homebrew/bin:/usr/bin", "Welcome!\n🍺 brew is ready\n"),
      ),
    ).toBe("/opt/homebrew/bin:/usr/bin");
  });

  it("gives nothing for a shell that never reached the markers", () => {
    expect(extractPath("zsh: command not found: printenv\n")).toBeUndefined();
    expect(extractPath("__RELAY_PATH_START__\nhalf")).toBeUndefined();
    expect(extractPath(marked(""))).toBeUndefined();
  });
});

describe("mergePath", () => {
  it("keeps the inherited entries in front and drops repeats", () => {
    expect(
      mergePath(
        "/fake/bin:/usr/bin",
        "/Users/me/.local/bin:/usr/bin:/bin",
        ":",
      ),
    ).toBe("/fake/bin:/usr/bin:/Users/me/.local/bin:/bin");
  });

  it("works with either side missing", () => {
    expect(mergePath(undefined, "/a:/b", ":")).toBe("/a:/b");
    expect(mergePath("/a", undefined, ":")).toBe("/a");
    expect(mergePath("", " : ", ":")).toBeUndefined();
  });
});

describe("loginShells", () => {
  it("asks the session's shell, then the account's, then the platform default", () => {
    expect(
      loginShells({ SHELL: "/opt/homebrew/bin/fish" }, "darwin", "/bin/zsh"),
    ).toEqual(["/opt/homebrew/bin/fish", "/bin/zsh"]);
    expect(loginShells({}, "linux", undefined)).toEqual(["/bin/bash"]);
  });
});

describe("hydratePath", () => {
  const bare = "/usr/bin:/bin:/usr/sbin:/sbin";

  it("appends the login shell's PATH to a Dock launch's bare one", async () => {
    const env = { PATH: bare, SHELL: "/bin/zsh" };
    const exec: Run = async (file, args) => {
      expect(file).toBe("/bin/zsh");
      expect(args[0]).toBe("-ilc");
      return marked("/Users/me/.local/bin:/usr/bin:/bin");
    };
    await hydratePath(env, { platform: "darwin", exec });
    expect(env.PATH).toBe(`${bare}:/Users/me/.local/bin`);
  });

  it("moves on from a shell that fails to the next one, then launchctl", async () => {
    const calls: string[] = [];
    const exec: Run = async (file, args) => {
      calls.push(file);
      if (file === "/bin/launchctl") return "/opt/homebrew/bin\n";
      throw new Error(`${file} ${args.join(" ")} timed out`);
    };
    const env = { PATH: bare, SHELL: "/usr/local/bin/fish" };
    await hydratePath(env, { platform: "darwin", userShell: "/bin/zsh", exec });
    expect(calls).toEqual([
      "/usr/local/bin/fish",
      "/bin/zsh",
      "/bin/launchctl",
    ]);
    expect(env.PATH).toBe(`${bare}:/opt/homebrew/bin`);
  });

  it("leaves PATH alone when nothing answers, and on Windows", async () => {
    const failing: Run = async () => {
      throw new Error("no");
    };
    const env = { PATH: bare };
    await hydratePath(env, { platform: "linux", exec: failing });
    expect(env.PATH).toBe(bare);
    const windows = { PATH: "C:\\Windows" };
    await hydratePath(windows, {
      platform: "win32",
      exec: async () => marked("/should/not/run"),
    });
    expect(windows.PATH).toBe("C:\\Windows");
  });
});
