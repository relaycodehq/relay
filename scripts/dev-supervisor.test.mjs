import { execFile, execFileSync, spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const exec = promisify(execFile);
const scripts = fileURLToPath(new URL(".", import.meta.url));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
async function waitFor(check) {
  for (const until = Date.now() + 20_000; Date.now() < until;) {
    try {
      if (check()) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Fixture did not reach the expected state");
}

it("runs the real runner through cancellation, switch, fallback, restore and shutdown", async () => {
  const scratch = realpathSync(
    mkdtempSync(join(tmpdir(), "relay-dev-supervisor-test-")),
  );
  const repo = join(scratch, "main checkout ž"),
    away = join(scratch, "worktree ž");
  const data = join(scratch, "data"),
    temp = join(scratch, "tmp");
  for (const path of [repo, data, temp]) mkdirSync(path);
  const userData = join(
    data,
    ...(process.platform === "darwin"
      ? ["Library", "Application Support"]
      : []),
    "Relay Experimental",
  );
  mkdirSync(userData, { recursive: true });
  writeFileSync(join(userData, "state.json"), "baseline");
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const env = {
    ...process.env,
    HOME: data,
    USERPROFILE: data,
    APPDATA: data,
    XDG_CONFIG_HOME: data,
    TMPDIR: temp,
    TMP: temp,
    TEMP: temp,
    RELAY_PORT_OFFSET: String(port - 5177),
  };
  for (const key of [
    "RELAY_TEST_DATA",
    "RELAY_DEV_HOME",
    "RELAY_DEV_RUNNING",
    "ELECTRON_RUN_AS_NODE",
  ])
    delete env[key];
  mkdirSync(join(repo, "scripts"));
  for (const name of [
    "dev.mjs",
    "dev-home.mjs",
    "dev-switch.mjs",
    "dev-supervisor.mjs",
    "dev-supervisor-probe.mjs",
    "dev-process.mjs",
  ])
    cpSync(join(scripts, name), join(repo, "scripts", name));
  const fixtureHome = join(repo, "scripts/dev-home.mjs");
  writeFileSync(
    fixtureHome,
    readFileSync(fixtureHome, "utf8").replace(
      "const items = readdirSync(userData).filter(kept);",
      `if (process.env.RELAY_FIXTURE_HOLD_COPY) {
      delete process.env.RELAY_FIXTURE_HOLD_COPY;
      process.send?.({ type: "fixture:copying" });
      while (!existsSync("release-copy"))
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
    const items = readdirSync(userData).filter(kept);`,
    ),
  );
  writeFileSync(
    join(repo, "scripts/build-electron.mjs"),
    "await new Promise(r => { if (!process.env.RELAY_FIXTURE_HANG_BUILD) setTimeout(r, 50); });",
  );
  writeFileSync(
    join(repo, "scripts/electron-bundles.mjs"),
    "export const bundles = process.env.RELAY_FIXTURE_BAD_BUNDLE ? [{name:'main',options:{outfile:'missing-bundle'}}] : process.env.RELAY_FIXTURE_HANG_CONTEXT ? [{name:'main',options:{outfile:'bundle'}}] : [];",
  );
  writeFileSync(
    join(repo, "package.json"),
    JSON.stringify({ main: "app.cjs" }),
  );
  writeFileSync(
    join(repo, "app.cjs"),
    `
    const {existsSync,writeFileSync}=require('node:fs');
    writeFileSync('app-pid', String(process.pid));
    process.send({type:'relay:dev-ready',restore:!process.env.RELAY_FIXTURE_NO_RESTORE});
    process.on('message', m => {
      if(m.type!=='relay:dev-stop') return;
      writeFileSync('stop-mode', String(m.detach));
      if(existsSync('cancel-quit')) process.send({type:'relay:dev-cancelled'});
      else process.exit(0);
    });
    setInterval(()=>{},1000);
  `,
  );
  const git = (...args) =>
    execFileSync("git", args, { cwd: repo, env, stdio: "pipe" });
  git("init", "-q");
  git("add", ".");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-qm",
    "Fixture",
  );
  git("worktree", "add", "-qb", "away", away);
  for (const root of [repo, away]) {
    for (const pkg of ["esbuild", "electron", "vite/bin"])
      mkdirSync(join(root, "node_modules", pkg), { recursive: true });
    writeFileSync(
      join(root, "node_modules/esbuild/package.json"),
      '{"type":"module","exports":"./index.js"}',
    );
    writeFileSync(
      join(root, "node_modules/esbuild/index.js"),
      "import {writeFileSync} from 'node:fs'; export async function context() { if(!process.env.RELAY_FIXTURE_HANG_CONTEXT) throw Error('No bundles in this fixture'); writeFileSync('context-started',''); await new Promise(()=>{}); }",
    );
    writeFileSync(
      join(root, "node_modules/electron/package.json"),
      '{"main":"index.cjs"}',
    );
    writeFileSync(
      join(root, "node_modules/electron/index.cjs"),
      "module.exports=process.execPath",
    );
    writeFileSync(join(root, "node_modules/electron/cli.js"), "");
    writeFileSync(join(root, "bundle"), "fixture");
    writeFileSync(
      join(root, "node_modules/vite/bin/vite.js"),
      `const {createServer}=require('node:http');const {writeFileSync}=require('node:fs');writeFileSync('vite-pid',String(process.pid));createServer((_,res)=>{writeFileSync('vite-request','');if(!process.env.RELAY_FIXTURE_HANG_VITE)res.end('fixture');}).listen(${port},'127.0.0.1');`,
    );
  }
  const child = spawn(process.execPath, ["scripts/dev-supervisor.mjs"], {
    cwd: repo,
    env: { ...env, RELAY_FIXTURE_HOLD_COPY: "1" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const extraChildren = [];
  let output = "";
  child.stdout.on("data", (b) => (output += b));
  child.stderr.on("data", (b) => (output += b));
  const control = join(
    data,
    ...(process.platform === "darwin"
      ? ["Library", "Application Support"]
      : []),
    "Relay dev",
  );
  const record = join(control, "supervisor.json");
  const ask = (...args) =>
    exec(process.execPath, ["scripts/dev-switch.mjs", ...args], {
      cwd: repo,
      env,
      timeout: 30_000,
    });
  try {
    await waitFor(() => existsSync(join(repo, "app-pid")));
    const appPid = Number(readFileSync(join(repo, "app-pid"))),
      vitePid = Number(readFileSync(join(repo, "vite-pid")));
    writeFileSync(join(repo, "cancel-quit"), "");
    await expect(ask("away")).rejects.toMatchObject({
      stderr: expect.stringContaining("quit was cancelled"),
    });
    expect(alive(appPid)).toBe(true);
    expect(alive(vitePid)).toBe(true);
    expect(read(record).running).toBe(repo);
    rmSync(join(repo, "cancel-quit"));
    const requestFile = join(control, "request.json");
    writeFileSync(
      requestFile,
      JSON.stringify({ to: repo, id: "same-target" }),
      { mode: 0o600 },
    );
    await waitFor(() => read(record).completed === "same-target");
    expect(alive(appPid)).toBe(true);
    for (const restore of ["../../../outside", "missing"]) {
      writeFileSync(requestFile, JSON.stringify({ restore, id: "invalid" }), {
        mode: 0o600,
      });
      await waitFor(() => read(record).rejected === "invalid");
      expect(read(record).error).toContain("Not a snapshot");
      expect(alive(appPid)).toBe(true);
    }
    writeFileSync(
      requestFile,
      JSON.stringify({ to: away, restore: "../../../outside", id: "mixed" }),
      { mode: 0o600 },
    );
    await waitFor(() => read(record).rejected === "mixed");
    expect(read(record).error).toContain("exactly one");
    expect(alive(appPid)).toBe(true);
    const copying = new Promise((resolve) => {
      child.on("message", (message) => {
        if (message?.type === "fixture:copying") resolve();
      });
    });
    const switching = ask("away");
    switching.catch(() => {});
    await copying;
    const status = await ask("--json");
    expect(JSON.parse(status.stdout).running).toBe(repo);
    writeFileSync(join(repo, "release-copy"), "");
    await switching;
    expect(readFileSync(join(repo, "stop-mode"), "utf8")).toBe("true");
    await waitFor(() => existsSync(join(away, "app-pid")));
    expect(read(record).running).toBe(away);
    expect(alive(appPid)).toBe(false);
    expect(alive(vitePid)).toBe(false);
    // A worktree's app quits by itself: the supervisor comes back to main.
    rmSync(join(repo, "app-pid"));
    process.kill(Number(readFileSync(join(away, "app-pid"))));
    await waitFor(
      () => existsSync(join(repo, "app-pid")) && read(record).running === repo,
    );
    await ask("--restore");
    expect(readFileSync(join(repo, "stop-mode"), "utf8")).toBe("false");
    await waitFor(() => alive(Number(readFileSync(join(repo, "app-pid")))));
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.send({ type: "relay:dev-stop" });
    await exited;
    expect(existsSync(record)).toBe(false);
    for (const root of [repo, away])
      for (const file of ["app-pid", "vite-pid"])
        expect(alive(Number(readFileSync(join(root, file))))).toBe(false);
    for (const file of ["app-pid", "vite-pid"]) rmSync(join(repo, file));
    const startup = spawn(process.execPath, ["scripts/dev-supervisor.mjs"], {
      cwd: repo,
      env: { ...env, RELAY_FIXTURE_HANG_BUILD: "1" },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    extraChildren.push(startup);
    await waitFor(() => existsSync(record));
    const startupExited = new Promise((resolve) =>
      startup.once("exit", resolve),
    );
    startup.send({ type: "relay:dev-stop" });
    await startupExited;
    expect(existsSync(join(repo, "app-pid"))).toBe(false);
    expect(existsSync(join(repo, "vite-pid"))).toBe(false);
    for (const [flag, marker] of [
      ["RELAY_FIXTURE_HANG_VITE", "vite-request"],
      ["RELAY_FIXTURE_HANG_CONTEXT", "context-started"],
    ]) {
      for (const file of [
        "app-pid",
        "vite-pid",
        "vite-request",
        "context-started",
      ])
        rmSync(join(repo, file), { force: true });
      const duringSetup = spawn(
        process.execPath,
        ["scripts/dev-supervisor.mjs"],
        {
          cwd: repo,
          env: { ...env, [flag]: "1" },
          stdio: ["ignore", "ignore", "ignore", "ipc"],
        },
      );
      extraChildren.push(duringSetup);
      await waitFor(() => existsSync(join(repo, marker)));
      const setupExited = new Promise((resolve) =>
        duringSetup.once("exit", resolve),
      );
      // What it hangs in never finishes, so exiting proves stop didn't wait for it.
      duringSetup.send({ type: "relay:dev-stop" });
      await setupExited;
      expect(existsSync(join(repo, "app-pid"))).toBe(false);
      expect(alive(Number(readFileSync(join(repo, "vite-pid"))))).toBe(false);
      expect(existsSync(record)).toBe(false);
    }
    // Older worktrees and apps still building cannot safely close detached hosts.
    for (const flag of [
      "RELAY_FIXTURE_HANG_BUILD",
      "RELAY_FIXTURE_NO_RESTORE",
    ]) {
      rmSync(join(repo, "app-pid"), { force: true });
      const unsupported = spawn(
        process.execPath,
        ["scripts/dev-supervisor.mjs"],
        {
          cwd: repo,
          env: { ...env, [flag]: "1" },
          stdio: ["ignore", "ignore", "ignore", "ipc"],
        },
      );
      extraChildren.push(unsupported);
      await waitFor(() => existsSync(record));
      if (flag === "RELAY_FIXTURE_NO_RESTORE")
        await waitFor(() => existsSync(join(repo, "app-pid")));
      const restore = readdirSync(join(userData, "Dev snapshots"))[0];
      writeFileSync(
        join(control, "request.json"),
        JSON.stringify({ restore, id: "unsupported-restore" }),
        { mode: 0o600 },
      );
      await waitFor(() => read(record).rejected === "unsupported-restore");
      expect(read(record).error).toContain("not ready to restore");
      const unsupportedExited = new Promise((resolve) =>
        unsupported.once("exit", resolve),
      );
      unsupported.send({ type: "relay:dev-stop" });
      await unsupportedExited;
      expect(existsSync(record)).toBe(false);
    }
    for (const file of ["app-pid", "vite-pid"])
      rmSync(join(repo, file), { force: true });
    const failed = spawn(process.execPath, ["scripts/dev-supervisor.mjs"], {
      cwd: repo,
      env: { ...env, RELAY_FIXTURE_BAD_BUNDLE: "1" },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    extraChildren.push(failed);
    expect(await new Promise((resolve) => failed.once("exit", resolve))).toBe(
      1,
    );
    expect(existsSync(record)).toBe(false);
    expect(existsSync(join(repo, "app-pid"))).toBe(false);
    expect(alive(Number(readFileSync(join(repo, "vite-pid"))))).toBe(false);
  } catch (error) {
    error.message += `\nSupervisor output:\n${output}`;
    throw error;
  } finally {
    for (const root of [repo, away])
      for (const file of ["app-pid", "vite-pid"]) {
        const path = join(root, file);
        if (existsSync(path)) {
          try {
            process.kill(Number(readFileSync(path)), "SIGKILL");
          } catch {}
        }
      }
    if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
    for (const extra of extraChildren)
      if (extra.exitCode === null && !extra.signalCode) extra.kill("SIGKILL");
    rmSync(scratch, { recursive: true, force: true });
  }
});
