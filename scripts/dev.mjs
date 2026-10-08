import { spawn } from "node:child_process";
import {
  readFileSync,
  renameSync,
  rmSync,
  watch,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve, sep } from "node:path";
import { context } from "esbuild";
import electronPath from "electron";
import { bundles } from "./electron-bundles.mjs";
import { stopDevServer } from "./dev-process.mjs";
// Moved up by a worktree's offset, like vite.config.ts.
const url = `http://127.0.0.1:${5177 + (Number(process.env.RELAY_PORT_OFFSET) || 0)}`;
let vite, electron;
let stopping = false;
let ready = false;
let finishing = false;
const finish = async (code = 0) => {
  if (finishing) return;
  finishing = true;
  try {
    if (vite) await stopDevServer(vite);
  } catch (error) {
    console.error("Could not stop the dev server:", error);
    code = 1;
  }
  process.exit(code);
};
const stop = () => {
  stopping = true;
  // Before Electron is ready, launch() or its ready message handles this.
  // Leave Vite up if the app's unsaved-edits prompt cancels the request.
  if (ready && electron?.connected) electron.send({ type: "relay:dev-stop" });
};
// Relay exits with this to be built and started again (electron/app/dev-build.ts).
const RESTART = 75;
// Where the bundles behind their sources are named for the running Relay.
const staleFile = join(tmpdir(), `relay-dev-stale-${process.pid}.json`);
process.on("exit", () => rmSync(staleFile, { force: true }));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("message", (message) => {
  if (message?.type === "relay:dev-stop") stop();
});
process.send?.({ type: "relay:dev-ready" });
async function run() {
  await import("./build-electron.mjs");
  if (stopping) await finish();
  // Direct executables avoid npm/.cmd wrappers and keep cleanup to Vite's tree.
  vite = spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"],
    {
      stdio: ["ignore", "inherit", "inherit"],
      detached: true,
      windowsHide: true,
    },
  );
  vite.on("error", (error) => {
    console.error("Could not start the dev server:", error);
    void finish(1);
  });
  vite.on("exit", () => {
    if (finishing) return;
    console.error("The dev server stopped.");
    if (electron) stop();
    else void finish(1);
  });
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(url);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  // npm run puts every ancestor's node_modules/.bin first on PATH; a stray
  // ~/node_modules/.bin/claude would then win over the user's real CLI.
  const PATH = (process.env.PATH ?? "")
    .split(delimiter)
    .filter((dir) => !/[\\/]node_modules[\\/]\.bin$/.test(dir))
    .join(delimiter);

  // The bundles are rebuilt in memory as their sources change, and written only
  // when Relay restarts: a running Relay spawns workers and agent hosts from
  // dist-electron, and a host whose file changed under it would never match
  // the version Relay expects.
  const loaded = new Map(),
    latest = new Map(),
    stale = new Set();
  const readLoaded = () => {
    for (const { name, options } of bundles)
      loaded.set(name, readFileSync(options.outfile));
  };
  const report = () => {
    // Renamed into place, so Relay never reads half of it.
    if (stale.size) {
      writeFileSync(`${staleFile}.tmp`, JSON.stringify([...stale]));
      renameSync(`${staleFile}.tmp`, staleFile);
    } else rmSync(staleFile, { force: true });
  };
  readLoaded();
  const builds = [];
  for (const { name, options } of bundles) {
    const outfile = resolve(options.outfile);
    const entry = { inputs: new Set(), queue: Promise.resolve() };
    entry.ctx = await context({
      ...options,
      write: false,
      metafile: true,
      plugins: [
        ...(options.plugins ?? []),
        {
          name: "relay-stale",
          setup(build) {
            build.onEnd(({ errors, outputFiles, metafile }) => {
              if (errors.length || !outputFiles) return;
              entry.inputs = new Set(Object.keys(metafile.inputs));
              const out = outputFiles.find((f) => f.path === outfile);
              latest.set(name, outputFiles);
              const was = stale.size;
              if (out && Buffer.from(out.contents).equals(loaded.get(name)))
                stale.delete(name);
              else stale.add(name);
              if (stale.size !== was) report();
            });
          },
        },
      ],
    });
    builds.push(entry);
  }
  // esbuild's own watch polls, about a fifth of a core for these bundles; one
  // recursive watch of the checkout costs nothing while idle. A file a bundle
  // starts importing is seen from the edit that imports it.
  const rebuild = (entry) =>
    (entry.queue = entry.queue.then(() => entry.ctx.rebuild()).catch(() => {}));
  builds.forEach(rebuild);
  const touched = new Set();
  let settle;
  watch(".", { recursive: true }, (_, file) => {
    if (!file) return;
    const path = file.split(sep).join("/");
    for (const entry of builds) if (entry.inputs.has(path)) touched.add(entry);
    if (!touched.size) return;
    clearTimeout(settle);
    settle = setTimeout(() => {
      for (const entry of touched) rebuild(entry);
      touched.clear();
    }, 100);
  });

  const launch = () => {
    ready = false;
    electron = spawn(electronPath, ["."], {
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      detached: true,
      windowsHide: true,
      env: {
        ...process.env,
        PATH,
        RELAY_DEV_URL: url,
        RELAY_DEV_STALE: staleFile,
      },
    });
    electron.on("message", (message) => {
      if (message?.type === "relay:dev-ready") {
        ready = true;
        if (stopping) stop();
      } else if (message?.type === "relay:dev-cancelled") {
        stopping = false;
        process.send?.(message);
      }
    });
    electron.on("error", async (error) => {
      console.error("Could not start Electron:", error);
      await finish(1);
    });
    electron.on("exit", async (code) => {
      if (code !== RESTART || stopping) return finish(code ?? 1);
      for (const name of stale)
        for (const file of latest.get(name) ?? [])
          writeFileSync(file.path, file.contents);
      readLoaded();
      stale.clear();
      report();
      launch();
    });
  };
  if (stopping) await finish();
  else launch();
}
await run().catch(async (error) => {
  console.error("Dev startup failed:", error);
  await finish(1);
});
