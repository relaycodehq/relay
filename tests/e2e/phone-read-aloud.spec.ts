import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { createHash } from "node:crypto";
import {
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
import {
  parsePairingUrl,
  readAloudBridge,
  type PhoneReadAloudAudio,
} from "../../shared/remote";
import { RemoteClient } from "../../shared/remote-client";

const freePort = () =>
  new Promise<number>((done) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => done(port));
    });
  });

// The tone engine from read-aloud.spec, already downloaded.
test("a phone hears an answer in the desktop's voice", async () => {
  test.setTimeout(90000);
  const root = await realpath(
      await mkdtemp(join(tmpdir(), "relay-phone-read-")),
    ),
    data = join(root, "data"),
    log = join(root, "engine.log"),
    dir = join(data, "models", "test-tone");
  const model = Buffer.concat([
    Buffer.from("fake model"),
    Buffer.alloc(1000, 7),
  ]);
  const sha256 = createHash("sha256").update(model).digest("hex");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "tone.bin"), model);
  await writeFile(join(dir, "verified.json"), JSON.stringify([sha256]));
  let app: ElectronApplication | undefined;
  let phone: RemoteClient | undefined;
  const engineLog = () => readFile(log, "utf8").catch(() => "");
  try {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
      ),
    ) as Record<string, string>;
    app = await electron.launch({
      args: ["tests/fixtures/launch.cjs"],
      env: {
        ...env,
        RELAY_TEST_DATA: data,
        RELAY_TEST_HEADED: "0",
        RELAY_TEST_NATIVE_STORAGE: "0",
        RELAY_REMOTE_PORT: String(await freePort()),
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
    const page = await app.firstWindow();
    const pairing = await page.evaluate(async () => {
      await window.relay.setPhoneRemote(true);
      return window.relay.phonePairing();
    });
    phone = new RemoteClient({
      start: { link: parsePairingUrl(pairing.url)!, device: "Test phone" },
    });
    phone.start();
    await expect.poll(() => phone!.status).toBe("online");
    const overview = await phone.call("overview");
    expect(overview.bridge).toBeGreaterThanOrEqual(readAloudBridge);
    expect(overview.readAloud).toBe(true);

    // Pulled to the end, as the phone does while it plays.
    await phone.call("readAloud", {
      type: "start",
      id: 1,
      markdown:
        "# Done\n\nThe flaky test **passes** now.\n\n```ts\nconst x = 1;\n```",
    });
    const pulls: PhoneReadAloudAudio[] = [];
    for (let i = 0; i < 400; i++) {
      const audio = await phone.call("readAloud", { type: "pull", id: 1 });
      pulls.push(audio);
      if (audio.done) break;
      if (!audio.pcm) await new Promise((r) => setTimeout(r, 50));
    }
    expect(pulls.at(-1)?.done).toBe(true);
    const pcm = Buffer.concat(pulls.map((p) => Buffer.from(p.pcm, "base64")));
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
    const words = (await engineLog())
      .split("\n")
      .filter((l) => l.startsWith("speak low "))
      .reduce(
        (sum, l) => sum + l.slice("speak low ".length).split(/\s+/).length,
        0,
      );
    expect(words).toBeGreaterThan(0);
    expect(samples.length).toBe(words * 2400);
    expect(pulls.every((p) => p.sampleRate === 24000)).toBe(true);
    // The tone peaks at 0.3 of full scale.
    const peak = samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
    expect(peak).toBeGreaterThan(9000);
    expect(peak).toBeLessThan(10500);
    // A finished reading is gone.
    await expect(
      phone.call("readAloud", { type: "pull", id: 1 }),
    ).rejects.toThrow(/ended on the computer/);

    // Stopped part way, the engine stops too.
    await phone.call("readAloud", {
      type: "start",
      id: 2,
      markdown: Array(200).fill("word").join(" "),
    });
    await expect
      .poll(
        async () =>
          (await phone!.call("readAloud", { type: "pull", id: 2 })).pcm.length,
      )
      .toBeGreaterThan(0);
    await phone.call("readAloud", { type: "stop", id: 2 });
    await expect
      .poll(async () => (await engineLog()).includes("stopped"))
      .toBe(true);
    await expect(
      phone.call("readAloud", { type: "pull", id: 2 }),
    ).rejects.toThrow();

    // Only a strict request gets through.
    await expect(
      phone.call("readAloud", {
        type: "start",
        id: 3,
        markdown: "Hi",
        voice: "x",
      } as never),
    ).rejects.toThrow();
  } finally {
    phone?.close();
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
