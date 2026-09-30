import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import {
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
import {
  parsePairingUrl,
  type PhoneDictationHeard,
} from "../../shared/remote";
import { RemoteClient } from "../../shared/remote-client";

// The real speech model is a 670 MB download, so this runs only when pointed
// at one: RELAY_DICTATION_MODEL=<folder with the files in shared/dictation.ts>.
const modelDir = process.env.RELAY_DICTATION_MODEL;

const freePort = () =>
  new Promise<number>((done) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => done(port));
    });
  });

test("a phone dictates with the desktop's speech engine", async () => {
  test.skip(
    !modelDir,
    "Set RELAY_DICTATION_MODEL to a downloaded model folder",
  );
  test.setTimeout(90000);
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-phone-dictation-")),
  );
  const data = join(root, "data"),
    model = join(data, "models", dictationModel.id);
  let app: ElectronApplication | undefined;
  let phone: RemoteClient | undefined;
  try {
    await mkdir(model, { recursive: true });
    for (const file of dictationModel.files)
      await symlink(join(modelDir!, file.name), join(model, file.name));
    await writeFile(
      join(model, "verified.json"),
      JSON.stringify(dictationModel.files.map((file) => file.sha256)),
    );
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
        // No Tailscale here: loopback stands in for the tailnet.
        RELAY_REMOTE_TAILNET: "127.0.0.1",
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
    expect((await phone.call("overview")).dictation).toBe("ready");

    // The clip is 16 kHz mono 16-bit, as the phone's microphone records.
    const wav = await readFile("tests/fixtures/dictation-speech.wav");
    const pcm = wav.subarray(wav.indexOf("data") + 8);
    const chunk = 1280 * 2;
    const chunks: string[] = [];
    for (let at = 0; at < pcm.length; at += chunk)
      chunks.push(pcm.subarray(at, at + chunk).toString("base64"));
    // A second of quiet after the speech, as a phone keeps listening.
    const quiet = Buffer.alloc(chunk).toString("base64");
    chunks.push(...Array(12).fill(quiet));

    const heard: PhoneDictationHeard[] = [];
    await phone.call("dictate", { type: "start", id: 1 });
    for (const pcm of chunks) {
      heard.push(await phone.call("dictate", { type: "audio", id: 1, pcm }));
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    // Words come back while the phone is still listening, not only at the end.
    expect(
      heard.some((h) =>
        /flaky test/i.test(`${h.settled} ${h.tentative}`),
      ),
    ).toBe(true);
    const final = await phone.call("dictate", { type: "stop", id: 1 });
    expect(final.settled).toMatch(/^Fix the flaky test\./i);
    expect(final.settled).toMatch(/pull request/i);
    expect(final.tentative).toBe("");

    // A cancelled session is gone; its late audio is refused.
    await phone.call("dictate", { type: "start", id: 2 });
    await phone.call("dictate", { type: "audio", id: 2, pcm: chunks[0] });
    await phone.call("dictate", { type: "cancel", id: 2 });
    await expect(
      phone.call("dictate", { type: "audio", id: 2, pcm: chunks[1] }),
    ).rejects.toThrow(/Dictation ended/);
    // Only PCM gets through.
    await phone.call("dictate", { type: "start", id: 3 });
    await expect(
      phone.call("dictate", { type: "audio", id: 3, pcm: "<script>" }),
    ).rejects.toThrow();
  } finally {
    phone?.close();
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
