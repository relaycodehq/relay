import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dictationModel } from "../../shared/dictation";

// The real speech model is a 670 MB download, so this runs only when pointed
// at one: RELAY_DICTATION_MODEL=<folder with the files in shared/dictation.ts>.
const modelDir = process.env.RELAY_DICTATION_MODEL;

test("dictates a spoken clip into the composer with the real speech engine", async () => {
  test.skip(
    !modelDir,
    "Set RELAY_DICTATION_MODEL to a downloaded model folder",
  );
  test.setTimeout(90000);
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-dictation-")),
  );
  const data = join(root, "data"),
    model = join(data, "models", dictationModel.id);
  let app: ElectronApplication | undefined;
  try {
    await mkdir(model, { recursive: true });
    for (const file of dictationModel.files)
      await symlink(join(modelDir!, file.name), join(model, file.name));
    await writeFile(
      join(model, "verified.json"),
      JSON.stringify(dictationModel.files.map((file) => file.sha256)),
    );
    const repo = join(root, "notes");
    await mkdir(repo);
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
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
      },
    });
    await app.evaluate(({ dialog, systemPreferences }, repo) => {
      systemPreferences.getMediaAccessStatus = () => "granted";
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [repo],
      });
    }, repo);
    const page = await app.firstWindow();
    await page.evaluate(() => window.relay.addProject());
    await page.reload();
    // A recorded clip stands in for the microphone. (Chromium's fake capture
    // device can't read a file from inside its sandbox.)
    const clip = (
      await readFile("tests/fixtures/dictation-speech.wav")
    ).toString("base64");
    await page.evaluate((clip) => {
      navigator.mediaDevices.getUserMedia = async () => {
        const context = new AudioContext();
        const bytes = Uint8Array.from(atob(clip), (c) => c.charCodeAt(0));
        const source = context.createBufferSource();
        source.buffer = await context.decodeAudioData(bytes.buffer);
        const out = context.createMediaStreamDestination();
        source.connect(out);
        source.start();
        return out.stream;
      };
    }, clip);
    await page
      .getByRole("button", { name: "New thread in Notes", exact: true })
      .click();
    const input = page.locator(".composer-prompt-input");
    await input.click();
    await input.pressSequentially("Please ");

    const mic = page.getByRole("button", { name: /^Dictate/ });
    await mic.click();
    await expect(page.locator(".dictation-mic[data-live]")).toBeVisible();
    // Words arrive while the clip is still playing, before finishing.
    await expect(input).toContainText(/flaky test/i, { timeout: 20000 });
    await expect(input).toContainText(/pull request/i, { timeout: 20000 });
    await page.getByRole("button", { name: "Finish dictation" }).click();
    await expect(page.locator(".dictation-mic[data-live]")).toHaveCount(0);
    await expect(
      page.locator(".dictation-tentative, .dictation-caret"),
    ).toHaveCount(0);
    const text = await input.innerText();
    expect(text).toMatch(/^Please fix the flaky test\./i);
    // The whole dictation is one undo step; the typed words stay.
    await input.press("ControlOrMeta+z");
    await expect(input).toHaveText("Please ");
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
