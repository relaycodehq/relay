import { describe, expect, it, vi } from "vitest";
import {
  extractPath,
  extractRegistryPath,
  hydratePath,
  loginShells,
  mergePath,
  pathRefresher,
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
    const exec: Run = async (file) => {
      expect(file).toBe(
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      );
      return registryOutput(
        "%SystemRoot%\\system32;C:\\Program Files\\GitHub CLI\\",
        "%LOCALAPPDATA%\\Programs\\OpenAI\\Codex\\bin;%UNSET%\\bin",
      );
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

describe("reading the registry's PATH", () => {
  const windows = () => ({ PATH: "C:\\Windows", SystemRoot: "C:\\Windows" });

  it("says once in the log that PowerShell timed out, and again after a read that worked", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const timedOut: Run = async () => {
      throw Object.assign(new Error("Command failed: powershell.exe …"), {
        killed: true,
        signal: "SIGTERM",
      });
    };
    await hydratePath(windows(), { platform: "win32", exec: timedOut });
    await hydratePath(windows(), { platform: "win32", exec: timedOut });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/took longer than 15 s/);
    await hydratePath(windows(), {
      platform: "win32",
      exec: async () => registryOutput("C:\\Windows", ""),
    });
    await hydratePath(windows(), { platform: "win32", exec: timedOut });
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("logs PowerShell's own error rather than the script, and an empty answer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await hydratePath(windows(), {
      platform: "win32",
      exec: async () => {
        throw Object.assign(new Error("Command failed: powershell.exe …"), {
          code: 1,
          stderr: "Access is denied.\r\n",
        });
      },
    });
    await hydratePath(windows(), {
      platform: "win32",
      exec: async () => registryOutput("", ""),
    });
    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      "Could not read the PATH from the registry: PowerShell exited with 1: Access is denied.",
      "The registry gave Relay no PATH to read.",
    ]);
    warn.mockRestore();
  });
});

describe("extractRegistryPath", () => {
  it("decodes folders outside any code page and expands variables whatever their case", () => {
    expect(
      extractRegistryPath(
        registryOutput("C:\\Users\\Lubomír\\bin", "%userprofile%\\.bun\\bin"),
        { USERPROFILE: "C:\\Users\\Lubomír" },
      ),
    ).toBe("C:\\Users\\Lubomír\\bin;C:\\Users\\Lubomír\\.bun\\bin");
  });

  it("gives nothing without a Path, or for anything but the script's lines", () => {
    expect(extractRegistryPath(registryOutput("", ""), {})).toBeUndefined();
    expect(
      extractRegistryPath(
        "Get-Item : Cannot find path 'HKCU:\\Environment'",
        {},
      ),
    ).toBeUndefined();
  });
});

describe("pathRefresher", () => {
  const gate = () => {
    let open!: () => void;
    const opened = new Promise<void>((resolve) => (open = resolve));
    return { open, opened };
  };

  it("lets every lookup that missed together search again after one read", async () => {
    const reading = gate();
    const read = vi.fn(() => reading.opened);
    const refresh = pathRefresher(read, 10_000);
    const misses = Promise.all([refresh(0), refresh(0), refresh(0)]);
    reading.open();
    expect(await misses).toEqual([true, true, true]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("tells a lookup that began before the last read to search again, without reading", async () => {
    let clock = 1_000;
    const read = vi.fn(async () => {
      clock = 2_000;
    });
    const refresh = pathRefresher(read, 10_000, () => clock);
    expect(await refresh(500)).toBe(true);
    expect(await refresh(1_500)).toBe(true);
    expect(await refresh(2_500)).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
    clock = 12_000;
    expect(await refresh(11_000)).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
  });
});

function registryOutput(machine: string, user: string) {
  return [machine, user]
    .map((path) => Buffer.from(path, "utf8").toString("base64"))
    .join("\r\n");
}
