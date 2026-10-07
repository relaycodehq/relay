import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dictationModel } from "../../shared/dictation";
import { parsePairingUrl, type PhoneDictationHeard } from "../../shared/remote";
import { RemoteClient } from "../../shared/remote-client";

const modelDir = process.env.RELAY_DICTATION_MODEL;

const freePort = () =>
  new Promise<number>((done) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => done(port));
    });
  });

test("a phone dictates with a headless Relay's speech engine", async () => {
  test.skip(
    !modelDir,
    "Set RELAY_DICTATION_MODEL to a downloaded model folder",
  );
  test.setTimeout(120_000);
  execFileSync(process.execPath, ["scripts/build-headless.mjs", "9.9.9"]);
  const root = await realpath(
      await mkdtemp(join(tmpdir(), "relay-headless-dictation-")),
    ),
    home = join(root, "home");
  // The engine as `relay settings` would have downloaded it, from this checkout's copy.
  const manifest = JSON.parse(
    await readFile("dist-headless/speech-runtime.json", "utf8"),
  );
  const platform = `${process.platform === "win32" ? "win" : process.platform}-${process.arch}`;
  const native = manifest.sherpa.platforms[platform];
  test.skip(!native, `No speech engine for ${platform}.`);
  const sherpa = join(home, "runtime", "sherpa");
  for (const name of ["sherpa-onnx-node", native.name])
    await cp(join("node_modules", name), join(sherpa, name), {
      recursive: true,
    });
  await writeFile(join(sherpa, "VERSION"), `${native.version}\n`);
  const model = join(home, "models", dictationModel.id);
  await mkdir(model, { recursive: true });
  for (const file of dictationModel.files)
    await symlink(join(modelDir!, file.name), join(model, file.name));
  await writeFile(
    join(model, "verified.json"),
    JSON.stringify(dictationModel.files.map((file) => file.sha256)),
  );

  const env = Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== undefined),
  ) as Record<string, string>;
  const relay = (...args: string[]) =>
    execFileSync(process.execPath, ["dist-headless/relay.cjs", ...args], {
      encoding: "utf8",
      env: {
        ...env,
        RELAY_HOME: home,
        RELAY_TEST_DATA: home,
        RELAY_REMOTE_TAILNET: "127.0.0.1",
      },
    });
  let phone: RemoteClient | undefined;
  try {
    relay("start", "--port", String(await freePort()));
    const { url } = JSON.parse(relay("pair", "--json"));
    phone = new RemoteClient({
      start: { link: parsePairingUrl(url)!, device: "Test phone" },
    });
    phone.start();
    await expect.poll(() => phone!.status).toBe("online");
    expect((await phone.call("overview")).dictation).toBe("ready");

    // The clip in 80 ms chunks, as the phone's microphone sends them, then a little quiet.
    const wav = await readFile("tests/fixtures/dictation-speech.wav");
    const pcm = wav.subarray(wav.indexOf("data") + 8);
    const chunk = 1280 * 2;
    const chunks: string[] = [];
    for (let at = 0; at < pcm.length; at += chunk)
      chunks.push(pcm.subarray(at, at + chunk).toString("base64"));
    chunks.push(...Array(12).fill(Buffer.alloc(chunk).toString("base64")));

    const heard: PhoneDictationHeard[] = [];
    await phone.call("dictate", { type: "start", id: 1 });
    for (const audio of chunks) {
      heard.push(
        await phone.call("dictate", { type: "audio", id: 1, pcm: audio }),
      );
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    // Words came back while it was still speaking.
    expect(
      heard.some((h) => /flaky test/i.test(`${h.settled} ${h.tentative}`)),
    ).toBe(true);
    const final = await phone.call("dictate", { type: "stop", id: 1 });
    expect(final.settled).toMatch(/^Fix the flaky test\./i);
    expect(final.settled).toMatch(/pull request/i);
    relay("stop", "--force");
  } finally {
    phone?.close();
    try {
      relay("stop", "--force");
    } catch {
      // Already stopped.
    }
    await rm(root, { recursive: true, force: true, maxRetries: 10 });
  }
});
