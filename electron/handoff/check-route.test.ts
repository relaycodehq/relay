import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  checkRoute,
  pairingLink,
  routeCommand,
  routeShell,
} from "./pipe-route";

const run = promisify(execFile);

const box = { kind: "ssh", host: "box" } as const;

/** Runs the line here, as ssh would there, with `home` as its home folder and nothing else on PATH. */
async function at(relay?: string) {
  const home = await mkdtemp(join(tmpdir(), "relay-check-"));
  if (relay !== undefined) {
    await mkdir(join(home, ".local/bin"), { recursive: true });
    await writeFile(join(home, ".local/bin/relay"), `#!/bin/sh\n${relay}\n`, {
      mode: 0o755,
    });
  }
  return (_route: unknown, line: string): [string, string[]] => [
    "/bin/sh",
    ["-c", `HOME='${home}'; PATH=/usr/bin:/bin; ${line}`],
  ];
}

it("says which Relay is there", async () => {
  const found = await checkRoute(
    box,
    await at('echo "Welcome!" >&2; echo 0.18.0'),
  );
  expect(found.relay).toBe("0.18.0");
  expect(found.ms).toBeGreaterThanOrEqual(0);
});

it("says when there's none", async () => {
  expect((await checkRoute(box, await at())).relay).toBeNull();
});

it("tells a Relay that doesn't start from one that isn't there", async () => {
  const found = await checkRoute(
    box,
    await at(
      'echo "Relay needs Node.js 22 or newer: https://nodejs.org" >&2; exit 1',
    ),
  );
  expect(found).toMatchObject({
    relay: "",
    broken: "Relay needs Node.js 22 or newer: https://nodejs.org",
  });
});

it("reads the answer past what a shell startup file printed", async () => {
  const shell = await at("echo 0.18.0");
  const noisy = (route: unknown, line: string) =>
    shell(route, `echo "Have a nice day"; ${line}`);
  expect((await checkRoute(box, noisy)).relay).toBe("0.18.0");
});

it("fails in words when the route itself does", async () => {
  const refused = (): [string, string[]] => [
    "/bin/sh",
    ["-c", "echo 'Host key verification failed.' >&2; exit 255"],
  ];
  await expect(checkRoute(box, refused)).rejects.toThrow(
    "This computer doesn't know box's host key yet",
  );
  const gone = (): [string, string[]] => ["relay-no-such-ssh", []];
  await expect(checkRoute(box, gone)).rejects.toThrow("There's no ssh");
});

// fish isn't here to try, but takes the same quoting: '…', \' and \\ outside them.
const loginShells = ["/bin/sh", "/bin/bash", "/bin/zsh", "/bin/csh"].filter(
  (shell) => existsSync(shell),
);

it.each(loginShells)(
  "hands the line to sh intact past a %s login shell",
  async (shell) => {
    const line = `printf '%s\\n' "a'b" 'c\\d' "$(echo e)"; if true; then echo f; fi`;
    const [, args] = routeShell(box, line);
    const { stdout } = await run(shell, ["-c", args.at(-1)!]);
    expect(stdout).toBe("a'b\nc\\d\ne\nf\n");
  },
);

it("runs the same Relay it found, in RELAY_BIN or on the PATH", async () => {
  const home = await mkdtemp(join(tmpdir(), "relay-route-"));
  const bin = join(home, "elsewhere");
  await mkdir(bin);
  await writeFile(join(bin, "relay"), '#!/bin/sh\necho "ran $*"\n', {
    mode: 0o755,
  });
  const [, args] = routeCommand(box, ["pair", "--json"]);
  const at = (env: Record<string, string>) =>
    run("/bin/sh", ["-c", args.at(-1)!], {
      env: { HOME: home, PATH: "/usr/bin:/bin", ...env },
    });
  expect((await at({ PATH: `${bin}:/usr/bin:/bin` })).stdout).toBe(
    "ran pair --json\n",
  );
  expect((await at({ RELAY_BIN: bin })).stdout).toBe("ran pair --json\n");
  await expect(at({})).rejects.toMatchObject({
    stderr: expect.stringMatching(/relay: (not found|No such file)/),
  });
});

it("reads the pairing link past what a shell startup file printed", async () => {
  const noisy = (): [string, string[]] => [
    "/bin/sh",
    [
      "-c",
      `echo "{ Welcome to box }"; printf '{\\n  "url": "relay://pair"\\n}\\n'`,
    ],
  ];
  expect(await pairingLink(box, noisy)).toBe("relay://pair");
});
