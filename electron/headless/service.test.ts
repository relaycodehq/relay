import { expect, it } from "vitest";
import {
  launchdPlist,
  serviceFile,
  serviceHome,
  stableNode,
  systemdService,
  windowsLauncher,
} from "./service";

const spec = {
  node: "/opt/node 22/bin/node",
  script: "/opt/relay/lib/relay.cjs",
  home: '/Users/me/R&D "relay"',
  path: "/opt/homebrew/bin:/usr/bin",
};

it("writes a launchd agent that starts at login and again only after a crash", () => {
  const plist = launchdPlist(spec);
  expect(plist).toContain("<string>/opt/node 22/bin/node</string>");
  expect(plist).toContain(
    "<string>run</string>\n    <string>--background</string>",
  );
  expect(plist).toContain(
    "<string>/Users/me/R&amp;D &quot;relay&quot;</string>",
  );
  expect(plist).toMatch(/<key>SuccessfulExit<\/key>\s*<false\/>/);
  // The agent host outlives a restart.
  expect(plist).toMatch(/<key>AbandonProcessGroup<\/key>\s*<true\/>/);
  // So Relay knows to exit for a restart rather than start itself again.
  expect(plist).toMatch(
    /<key>RELAY_SERVICE<\/key>\s*<string>launchd<\/string>/,
  );
});

it("writes a systemd unit that leaves the agent host running", () => {
  const unit = systemdService(spec);
  expect(unit).toContain(
    'ExecStart="/opt/node 22/bin/node" "/opt/relay/lib/relay.cjs" "run" "--background"',
  );
  expect(unit).toContain('Environment="RELAY_HOME=/Users/me/R&D \\"relay\\""');
  expect(unit).toContain("KillMode=process");
  expect(unit).toContain("Restart=on-failure");
  expect(unit).toContain("Environment=RELAY_SERVICE=systemd");
});

it("starts Relay with the node on PATH rather than a versioned path behind it", async () => {
  const { mkdtemp, mkdir, realpath, rm, symlink, writeFile } =
    await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  if (process.platform === "win32") return;
  const dir = await realpath(await mkdtemp(join(tmpdir(), "relay-node-")));
  try {
    const cellar = join(dir, "Cellar", "node", "26.1.0", "bin");
    await mkdir(cellar, { recursive: true });
    await mkdir(join(dir, "bin"));
    await writeFile(join(cellar, "node"), "", { mode: 0o755 });
    await symlink(join(cellar, "node"), join(dir, "bin", "node"));
    expect(
      stableNode(join(cellar, "node"), `/nowhere:${join(dir, "bin")}`),
    ).toBe(join(dir, "bin", "node"));
    // Another node on PATH isn't this one.
    expect(stableNode(join(cellar, "node"), "/usr/bin")).toBe(
      join(cellar, "node"),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("writes a Windows Startup script that starts Relay hidden and supervised", async () => {
  const { mkdtemp, readFile, realpath, rm, writeFile } =
    await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const windows = {
    node: "C:\\Program Files\\nodejs\\node.exe",
    script: "C:\\Users\\Zoë\\AppData\\Local\\Programs\\Relay\\lib\\relay.cjs",
    home: 'C:\\Users\\Zoë\\.relay "x"',
    path: "C:\\Windows\\System32;C:\\Program Files\\nodejs",
  };
  const script = windowsLauncher(windows);
  expect(script).toContain(
    'shell.Run """C:\\Program Files\\nodejs\\node.exe"" ""C:\\Users\\Zoë\\AppData\\Local\\Programs\\Relay\\lib\\relay.cjs"" run --background --supervise", 0, False',
  );
  expect(script).toContain(
    'env("RELAY_HOME") = "C:\\Users\\Zoë\\.relay ""x"""',
  );
  expect(script).toContain('env("RELAY_SERVICE") = "windows"');
  expect(
    serviceFile("windows", "C:\\Users\\Zoë", { APPDATA: "C:\\Roaming" }),
  ).toMatch(
    /Roaming[\\/]Microsoft[\\/]Windows[\\/]Start Menu[\\/]Programs[\\/]Startup[\\/]Relay\.vbs$/,
  );
  // The home it runs reads back from the script as written, UTF-16 and all.
  const dir = await realpath(await mkdtemp(join(tmpdir(), "relay-vbs-")));
  try {
    const appData = join(dir, "Roaming");
    const file = serviceFile("windows", dir, { APPDATA: appData });
    await (
      await import("node:fs/promises")
    ).mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, Buffer.from(`\ufeff${script}`, "utf16le"));
    expect((await readFile(file)).subarray(0, 2)).toEqual(
      Buffer.from([0xff, 0xfe]),
    );
    const saved = process.env.APPDATA;
    process.env.APPDATA = appData;
    try {
      expect(await serviceHome("windows")).toBe(windows.home);
    } finally {
      if (saved === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = saved;
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
