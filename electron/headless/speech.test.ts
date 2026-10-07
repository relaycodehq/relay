import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
import { SpeechRuntime, type SpeechRuntimeManifest } from "./speech";

const sherpa = `${process.platform === "win32" ? "win" : process.platform}-${process.arch}`;

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

it("downloads the speech engines it's asked for, checked against the lockfile's hashes", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "relay-speech-")));
  const served = new Map<string, Buffer>();
  const server = createServer((req, res) => {
    const bytes = served.get(req.url ?? "");
    res.writeHead(bytes ? 200 : 404, { "content-length": bytes?.length ?? 0 });
    res.end(bytes);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const node = await tarball(dir, "sherpa-onnx-node", {
      "addon.js": "addon",
    });
    const native = await tarball(dir, `sherpa-onnx-${sherpa}`, {
      "sherpa-onnx.node": "native",
    });
    const ort = await tarball(dir, "onnxruntime-node", {
      [`bin/napi-v6/${process.platform}/${process.arch}/onnxruntime_binding.node`]:
        "ort",
      "bin/napi-v6/elsewhere/x64/onnxruntime_binding.node": "other",
    });
    served.set("/node.tgz", node.bytes);
    served.set("/native.tgz", native.bytes);
    served.set("/ort.tgz", ort.bytes);
    const pkg = (name: string, url: string, integrity: string) => ({
      name,
      version: "1.0.0",
      url: base + url,
      integrity,
    });
    const manifest: SpeechRuntimeManifest = {
      sherpa: {
        node: pkg("sherpa-onnx-node", "/node.tgz", node.integrity),
        platforms: {
          [sherpa]: pkg(
            `sherpa-onnx-${sherpa}`,
            "/native.tgz",
            native.integrity,
          ),
        },
      },
      onnxruntime: {
        ...pkg("onnxruntime-node", "/ort.tgz", ort.integrity),
        platforms: [`${process.platform}/${process.arch}`],
      },
    };
    const lib = join(dir, "lib"),
      home = join(dir, "home");
    await mkdir(join(lib, "onnxruntime", "dist"), { recursive: true });
    await writeFile(join(lib, "onnxruntime", "dist", "index.cjs"), "js");
    await writeFile(join(lib, "speech-runtime.json"), JSON.stringify(manifest));

    const runtime = new SpeechRuntime(home, lib);
    expect(runtime.supports("dictation")).toBe(true);
    expect(runtime.installed("dictation")).toBe(false);
    await runtime.install("dictation");
    expect(runtime.installed("dictation")).toBe(true);
    // Side by side, as sherpa-onnx-node looks for its addon.
    expect(
      await readFile(
        join(runtime.sherpaDir, "sherpa-onnx-node", "addon.js"),
        "utf8",
      ),
    ).toBe("addon");
    expect(
      await readFile(
        join(runtime.sherpaDir, `sherpa-onnx-${sherpa}`, "sherpa-onnx.node"),
        "utf8",
      ),
    ).toBe("native");

    await runtime.install("voice");
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

    // A download that isn't what the lockfile pinned is refused, and what was there stays.
    served.set("/node.tgz", Buffer.from("tampered"));
    await runtime.remove("dictation");
    await expect(runtime.install("dictation")).rejects.toThrow(/doesn't match/);
    expect(runtime.installed("dictation")).toBe(false);
    expect(runtime.installed("voice")).toBe(true);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
