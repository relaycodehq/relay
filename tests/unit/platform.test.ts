import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { manifestSchema, newerVersion } from "../../shared/updates";
import { powershellScript } from "../../electron/local";
import { findExecutable, spawnExecutable } from "../../electron/executables";

const run = promisify(execFile);
const windows = process.platform === "win32";

describe("update feed", () => {
  it("only offers strictly newer releases", () => {
    expect(newerVersion("0.1.12", "0.1.9")).toBe(true);
    expect(newerVersion("0.2.0", "0.1.99")).toBe(true);
    expect(newerVersion("0.1.9", "0.1.9")).toBe(false);
    expect(newerVersion("0.1.8", "0.1.9")).toBe(false);
    expect(newerVersion("1.0.0", "0.9.9-dev")).toBe(true);
  });

  it("reads the feed the release script writes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "relay-release-"));
    for (const name of [
      "Relay-0.1.7-mac-arm64.zip",
      "Relay-0.1.7-mac-arm64.dmg",
      "Relay-0.1.7-win-x64.exe",
      "Relay-0.1.7-linux-x86_64.AppImage",
      "Relay-0.1.7-omarchy-x86_64.tar.gz",
      "Relay-Omarchy-x86_64.tar.gz",
    ])
      await writeFile(join(dir, name), name);
    await run(process.execPath, [
      "scripts/release-manifest.mjs",
      dir,
      "0.1.7",
      "lubomirmolin/relay-releases",
      'Fix "quotes" & more',
    ]);
    const manifest = manifestSchema.parse(
      JSON.parse(await readFile(join(dir, "latest.json"), "utf8")),
    );
    expect(Object.keys(manifest.files).sort()).toEqual([
      "linux-x64-appimage",
      "linux-x64-omarchy",
      "mac-arm64",
      "win-x64",
    ]);
    expect(manifest.files["linux-x64-omarchy"]?.name).toBe(
      "Relay-0.1.7-omarchy-x86_64.tar.gz",
    );
    expect(manifest.files["win-x64"]?.url).toBe(
      "https://github.com/lubomirmolin/relay-releases/releases/download/v0.1.7/Relay-0.1.7-win-x64.exe",
    );
  });

  it("accepts the manifest the release workflow writes and rejects insecure links", () => {
    const file = {
      name: "Relay-0.1.3-mac-arm64.zip",
      url: "https://github.com/lubomirmolin/relay-releases/releases/download/v0.1.3/Relay-0.1.3-mac-arm64.zip",
      sha512: "A".repeat(86) + "==",
      size: 1024,
    };
    expect(
      manifestSchema.parse({ version: "0.1.3", files: { "mac-arm64": file } })
        .files["mac-arm64"]?.name,
    ).toBe(file.name);
    expect(() =>
      manifestSchema.parse({
        version: "0.1.3",
        files: {
          "mac-arm64": { ...file, url: file.url.replace("https", "http") },
        },
      }),
    ).toThrow();
    expect(() =>
      manifestSchema.parse({
        version: "0.1.3",
        files: { "mac-arm64": { ...file, name: "../evil.zip" } },
      }),
    ).toThrow();
  });
});

const prompt = `Fix "this" in C:\\repo\\src\\ and 'that'\n\t$(nope) %PATH% & echo hi | more ✓\\`;

it("writes a PowerShell handoff that quotes paths literally", () => {
  const script = powershellScript(
    "C:\\Users\\o'brien\\repo",
    "C:\\data\\p.txt",
    "C:\\data\\p.ps1",
    "C:\\tools\\codex.exe",
    ["--cd", "C:\\Users\\o'brien\\repo"],
  );
  expect(script).toContain(
    "Set-Location -LiteralPath 'C:\\Users\\o''brien\\repo'",
  );
  expect(script).toContain(
    "& 'C:\\tools\\codex.exe' '--cd' 'C:\\Users\\o''brien\\repo' $prompt",
  );
});

describe.runIf(windows)("Windows", () => {
  it.each(["powershell.exe", "pwsh.exe"])(
    "%s delivers the prompt to the agent unchanged",
    async (shell) => {
      try {
        await run(shell, ["-NoProfile", "-Command", "exit 0"]);
      } catch {
        return; // pwsh isn't installed everywhere
      }
      const dir = await mkdtemp(join(tmpdir(), "relay-ps-"));
      const echo = join(dir, "echo.js"),
        out = join(dir, "out.json"),
        promptPath = join(dir, "prompt.txt"),
        scriptPath = join(dir, "handoff.ps1");
      await writeFile(
        echo,
        `require("fs").writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2)))`,
      );
      await writeFile(promptPath, prompt);
      await writeFile(
        scriptPath,
        powershellScript(dir, promptPath, scriptPath, echo, [
          "--flag",
          "two words",
        ]),
      );
      await run(shell, [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
      ]);
      expect(JSON.parse(await readFile(out, "utf8"))).toEqual([
        "--flag",
        "two words",
        // A trailing backslash gets a newline so no PowerShell version can swallow it.
        prompt + "\n",
      ]);
    },
    // Windows PowerShell's first launch on a fresh CI runner takes seconds.
    30_000,
  );

  it("resolves npm .cmd shims and runs their JavaScript entry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "relay-shim-"));
    const entry = join(dir, "node_modules", "tool", "bin");
    await mkdir(entry, { recursive: true });
    await writeFile(join(entry, "tool.js"), "console.log(process.argv[2])");
    await writeFile(
      join(dir, "relaytool.cmd"),
      `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%_prog%"  "%dp0%\\node_modules\\tool\\bin\\tool.js" %*\r\n`,
    );
    const previous = process.env.PATH;
    process.env.PATH = `${dir};${previous}`;
    try {
      const found = await findExecutable("relaytool");
      expect(found).toBe(join(entry, "tool.js"));
      const child = spawnExecutable(found, ["hello"], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      let output = "";
      child.stdout!.on("data", (d) => (output += d));
      await new Promise((r) => child.on("close", r));
      expect(output.trim()).toBe("hello");
    } finally {
      process.env.PATH = previous;
    }
  });
});
