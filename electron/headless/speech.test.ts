import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Dictation } from "../dictation/service";
import type { ReadAloud } from "../read-aloud";
import {
  HeadlessSpeech,
  SpeechRuntime,
  type SpeechRuntimeManifest,
} from "./speech";

/** An npm-style tarball: its files under package/. */
async function tarball(
  dir: string,
  name: string,
  files: Record<string, string>,
) {
  const root = join(dir, "src", name);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, "package", path, ".."), { recursive: true });
    await writeFile(join(root, "package", path), text);
  }
  const file = join(dir, `${name}.tgz`);
  execFileSync("tar", ["-czf", file, "-C", root, "package"]);
  const bytes = await readFile(file);
  return {
    bytes,
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
  };
}

/**
 * A headless Relay's folders, beside a registry serving onnxruntime-node as
 * the lockfile pinned it, with this platform's binaries and another's.
 */
async function registry() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "relay-speech-")));
  const served = new Map<string, Buffer>();
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    const bytes = served.get(req.url ?? "");
    res.writeHead(bytes ? 200 : 404, { "content-length": bytes?.length ?? 0 });
    res.end(bytes);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const ort = await tarball(dir, "onnxruntime-node", {
    [`bin/napi-v6/${process.platform}/${process.arch}/onnxruntime_binding.node`]:
      "ort",
    "bin/napi-v6/elsewhere/x64/onnxruntime_binding.node": "other",
  });
  served.set("/ort.tgz", ort.bytes);
  const manifest: SpeechRuntimeManifest = {
    onnxruntime: {
      name: "onnxruntime-node",
      version: "1.0.0",
      url: `${base}/ort.tgz`,
      integrity: ort.integrity,
      platforms: [`${process.platform}/${process.arch}`],
    },
  };
  const lib = join(dir, "lib"),
    home = join(dir, "home");
  await mkdir(join(lib, "onnxruntime", "dist"), { recursive: true });
  await writeFile(join(lib, "onnxruntime", "dist", "index.cjs"), "js");
  await writeFile(join(lib, "speech-runtime.json"), JSON.stringify(manifest));
  return {
    home,
    lib,
    served,
    requests: () => requests,
    async close() {
      server.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

it("downloads the speech engine once for both, checked against the lockfile's hash", async () => {
  const { home, lib, served, requests, close } = await registry();
  try {
    // What dictation used to run on goes.
    await mkdir(join(home, "runtime", "sherpa"), { recursive: true });

    const runtime = new SpeechRuntime(home, lib);
    await runtime.prepare();
    expect(existsSync(join(home, "runtime", "sherpa"))).toBe(false);
    expect(runtime.supported).toBe(true);
    expect(runtime.installed).toBe(false);
    await Promise.all([runtime.install("dictation"), runtime.install("voice")]);
    expect(runtime.installed).toBe(true);
    expect(requests()).toBe(1);
    expect(
      await readFile(
        join(
          runtime.ortDir,
          "bin",
          "napi-v6",
          process.platform,
          process.arch,
          "onnxruntime_binding.node",
        ),
        "utf8",
      ),
    ).toBe("ort");
    expect(
      await readFile(join(runtime.ortDir, "dist", "index.cjs"), "utf8"),
    ).toBe("js");
    // Only this platform's binaries stay.
    await expect(
      readFile(
        join(
          runtime.ortDir,
          "bin",
          "napi-v6",
          "elsewhere",
          "x64",
          "onnxruntime_binding.node",
        ),
      ),
    ).rejects.toThrow();

    // A download that isn't what the lockfile pinned is refused.
    served.set("/ort.tgz", Buffer.from("tampered"));
    await runtime.remove();
    await expect(runtime.install("voice")).rejects.toThrow(/doesn't match/);
    expect(runtime.installed).toBe(false);
  } finally {
    await close();
  }
});

it("fetches the engine after an update when dictation's model outlived the one it ran on", async () => {
  const { home, lib, requests, close } = await registry();
  try {
    let model = false,
      refreshed = 0;
    const dictation = {
      hasModel: async () => model,
      refresh: async () => void refreshed++,
    } as unknown as Dictation;
    const runtime = new SpeechRuntime(home, lib);
    const speech = new HeadlessSpeech(runtime, dictation, {} as ReadAloud);

    // Nothing was set up: nothing to fetch.
    await speech.catchUp();
    expect(requests()).toBe(0);

    // Set up on sherpa-onnx, which the update removed.
    model = true;
    await speech.catchUp();
    expect(runtime.installed).toBe(true);
    expect(requests()).toBe(1);
    expect(refreshed).toBe(1);

    await speech.catchUp();
    expect(requests()).toBe(1);
  } finally {
    await close();
  }
});
