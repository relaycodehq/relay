import { describe, expect, it } from "vitest";
import {
  extractPath,
  extractRegistryPath,
  hydratePath,
  loginShells,
  mergePath,
  type Run,
} from "./shell-path";

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
  it("follows the shell's order, as `which -a` does", () => {
    // An app started from omarchy's launcher, with mise activated in the shell.
    const mise =
      "/home/me/.local/share/mise/installs/gh/latest/gh_2.101.0_linux_amd64/bin";
    expect(
      mergePath(
        "/usr/local/bin:/usr/bin:/bin",
        `${mise}:/home/me/.local/share/mise/shims:/home/me/.local/bin:/usr/local/bin:/usr/bin:/bin`,
        ":",
      )?.split(":")[0],
    ).toBe(mise);
  });

  it("keeps folders put in front of the launch PATH there, and drops repeats", () => {
    expect(
      mergePath(
        "/fake/bin:/usr/bin:/usr/sbin",
        "/Users/me/.local/bin:/usr/bin:/bin",
        ":",
      ),
    ).toBe("/fake/bin:/Users/me/.local/bin:/usr/bin:/bin:/usr/sbin");
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

  it("puts the login shell's PATH ahead of a Dock launch's bare one", async () => {
    const env = { PATH: bare, SHELL: "/bin/zsh" };
    const exec: Run = async (file, args) => {
      expect(file).toBe("/bin/zsh");
      expect(args[0]).toBe("-ilc");
      return marked("/Users/me/.local/bin:/usr/bin:/bin");
    };
    await hydratePath(env, { platform: "darwin", exec });
    expect(env.PATH).toBe("/Users/me/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin");
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

  it("leaves PATH alone when nothing answers", async () => {
    const failing: Run = async () => {
      throw new Error("no");
    };
    const env = { PATH: bare };
    await hydratePath(env, { platform: "linux", exec: failing });
    expect(env.PATH).toBe(bare);
    const windows = { PATH: "C:\\Windows" };
    await hydratePath(windows, { platform: "win32", exec: failing });
    expect(windows.PATH).toBe("C:\\Windows");
  });

  it("adds what Windows' registry has since the launch, machine before user", async () => {
    // Relay started before Codex's installer added its folder to the user's Path.
    const env = {
      PATH: "C:\\Program Files\\Git\\cmd;C:\\Windows\\system32",
      SystemRoot: "C:\\Windows",
      LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
    };
    const exec: Run = async (file, args) => {
      expect(file).toBe("C:\\Windows\\System32\\reg.exe");
      return args[1].startsWith("HKLM")
        ? "\r\nHKEY_LOCAL_MACHINE\\...\\Environment\r\n    Path    REG_EXPAND_SZ    %SystemRoot%\\system32;C:\\Program Files\\GitHub CLI\\\r\n\r\n"
        : "\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    %LOCALAPPDATA%\\Programs\\OpenAI\\Codex\\bin;%UNSET%\\bin\r\n\r\n";
    };
    await hydratePath(env, { platform: "win32", exec });
    expect(env.PATH).toBe(
      [
        "C:\\Program Files\\Git\\cmd",
        "C:\\Windows\\system32",
        "C:\\Program Files\\GitHub CLI\\",
        "C:\\Users\\me\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin",
        "%UNSET%\\bin",
      ].join(";"),
    );
  });
});

describe("extractRegistryPath", () => {
  it("expands variables whatever their case, and gives nothing without a Path", () => {
    expect(
      extractRegistryPath(
        "    Path    REG_EXPAND_SZ    %userprofile%\\.bun\\bin\r\n",
        {
          USERPROFILE: "C:\\Users\\me",
        },
      ),
    ).toBe("C:\\Users\\me\\.bun\\bin");
    expect(
      extractRegistryPath(
        "ERROR: The system was unable to find the specified registry key or value.",
        {},
      ),
    ).toBeUndefined();
  });
});
