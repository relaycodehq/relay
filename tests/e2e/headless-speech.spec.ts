import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parsePairingUrl, type PhoneReadAloudAudio } from "../../shared/remote";
import { RemoteClient } from "../../shared/remote-client";

const freePort = () =>
  new Promise<number>((done) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => done(port));
    });
  });

test("a headless Relay reads answers aloud to a phone, its engine run in a worker over Node's IPC", async () => {
  test.setTimeout(120_000);
  execFileSync(process.execPath, ["scripts/build-headless.mjs", "9.9.9"]);
  const root = await realpath(
      await mkdtemp(join(tmpdir(), "relay-headless-speech-")),
    ),
    home = join(root, "home"),
    log = join(root, "engine.log");
  // The engine as `relay settings` would have downloaded it, from this checkout's copy.
  const manifest = JSON.parse(
    await readFile("dist-headless/speech-runtime.json", "utf8"),
  );
  const platform = `${process.platform}/${process.arch}`;
  test.skip(
    !manifest.onnxruntime.platforms.includes(platform),
    `No onnxruntime for ${platform}.`,
  );
  const runtime = join(home, "runtime", "onnxruntime");
  await cp(
    join("node_modules/onnxruntime-node/bin/napi-v6", platform),
    join(runtime, "bin", "napi-v6", platform),
    { recursive: true },
  );
  await writeFile(
    join(runtime, "VERSION"),
    `${manifest.onnxruntime.version}\n`,
  );
  // The stand-in voice, already downloaded.
  const model = Buffer.concat([
    Buffer.from("fake model"),
    Buffer.alloc(1000, 7),
  ]);
  const sha256 = createHash("sha256").update(model).digest("hex");
  const voice = join(home, "models", "test-tone");
  await mkdir(voice, { recursive: true });
  await writeFile(join(voice, "tone.bin"), model);
  await writeFile(join(voice, "verified.json"), JSON.stringify([sha256]));

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
        RELAY_TEST_READ_ALOUD_ENGINE: resolve(
          "tests/fixtures/read-aloud-engine.cjs",
        ),
        RELAY_TEST_READ_ALOUD_FILES: JSON.stringify([
          {
            name: "tone.bin",
            url: "http://127.0.0.1:9/tone.bin",
            size: model.length,
            sha256,
          },
        ]),
        RELAY_TEST_READ_ALOUD_LOG: log,
      },
    });
  let phone: RemoteClient | undefined;
  try {
    relay("start", "--port", String(await freePort()));
    const settings = JSON.parse(relay("settings", "--json"));
    expect(settings.speech.voice).toMatchObject({
      supported: true,
      engine: true,
    });
    expect(settings.speech.dictation.engine).toBe(false);

    const { url } = JSON.parse(relay("pair", "--json"));
    phone = new RemoteClient({
      start: { link: parsePairingUrl(url)!, device: "Test phone" },
    });
    phone.start();
    await expect.poll(() => phone!.status).toBe("online");
    expect((await phone.call("overview")).readAloud).toBe(true);

    await phone.call("readAloud", {
      type: "start",
      id: 1,
      markdown: "# Done\n\nThe flaky test **passes** now.",
    });
    const pulls: PhoneReadAloudAudio[] = [];
    for (let i = 0; i < 400; i++) {
      const audio = await phone.call("readAloud", { type: "pull", id: 1 });
      pulls.push(audio);
      if (audio.done) break;
      if (!audio.pcm) await new Promise((r) => setTimeout(r, 50));
    }
    expect(pulls.at(-1)?.done).toBe(true);
    expect(pulls.every((p) => p.sampleRate === 24000)).toBe(true);
    const pcm = Buffer.concat(pulls.map((p) => Buffer.from(p.pcm, "base64")));
    const words = (await readFile(log, "utf8"))
      .split("\n")
      .filter((l) => l.startsWith("speak low "))
      .reduce(
        (sum, l) => sum + l.slice("speak low ".length).split(/\s+/).length,
        0,
      );
    expect(words).toBeGreaterThan(0);
    // 16-bit samples: a tenth of a second of tone per word.
    expect(pcm.length / 2).toBe(words * 2400);

    // Dictation isn't set up: the phone is told where to set it up.
    await expect(
      phone.call("dictate", { type: "start", id: 1 }),
    ).rejects.toThrow(/Set up dictation/);
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
