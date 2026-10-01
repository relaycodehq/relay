import { screenshot } from "../fixtures/screenshot";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  realpath,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fixtureServer } from "../fixtures/gitea";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

/** Pastes a screenshot of the given width, drawn as a mock window. */
function pasteShot(
  page: Page,
  width: number,
  color: string,
  name = "image.png",
) {
  return page.getByLabel("Message project").evaluate(
    async (element, { width, color, name }) => {
      const canvas = new OffscreenCanvas(width, 300);
      const g = canvas.getContext("2d")!;
      g.fillStyle = "#f4f4f5";
      g.fillRect(0, 0, width, 300);
      g.fillStyle = color;
      g.fillRect(0, 0, width, 36);
      g.fillRect(24, 70, width * 0.6, 18);
      g.fillRect(24, 110, width * 0.4, 18);
      const blob = await canvas.convertToBlob({ type: "image/png" });
      const clipboard = new DataTransfer();
      clipboard.items.add(new File([blob], name, { type: "image/png" }));
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: clipboard,
        }),
      );
    },
    { width, color, name },
  );
}

/** The `[Image #n]` each pill stands for, in order. */
const numbers = (pills: Locator) =>
  pills.evaluateAll((all) =>
    all.map((pill) => (pill as HTMLElement).dataset.n),
  );

const pngWidth = async (path: string) =>
  (await readFile(path)).readUInt32BE(16);

test("puts pasted screenshots in the message as numbered pills", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-images-")));
  const fixture = await fixtureServer();
  const bin = join(root, "bin"),
    repo = join(root, "web-store"),
    capture = join(root, "capture.jsonl");
  let app: ElectronApplication | undefined;
  try {
    await mkdir(bin);
    await fakeCli(
      join(bin, "codex"),
      await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
    );
    await mkdir(repo);
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    await writeFile(join(repo, "README.md"), "# Fixture project\n");
    execFileSync("git", ["-C", repo, "add", "."]);
    execFileSync("git", [
      "-C",
      repo,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "Initial",
    ]);
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
      ),
    ) as Record<string, string>;
    app = await electron.launch({
      args: ["tests/fixtures/launch.cjs"],
      env: {
        ...env,
        ...pathWith(env, bin),
        RELAY_TEST_DATA: join(root, "data"),
        RELAY_TEST_HEADED: "0",
        RELAY_TEST_NATIVE_STORAGE: "0",
        RELAY_AGENT_CAPTURE: capture,
      },
    });
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, repo) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [repo],
      });
    }, repo);
    await page.evaluate(async (url) => {
      await window.relay.connect(url, "test-token");
      await window.relay.addProject();
    }, fixture.serverUrl);
    await page.reload();
    await page
      .locator(".sb-project-row")
      .getByRole("button", { name: "Web Store", exact: true })
      .click();
    const input = page.getByLabel("Message project");
    const pills = input.locator(".composer-image-chip");
    const strip = page.getByLabel("Attachments").locator(".composer-image");
    await input.click();
    await input.pressSequentially("Make ");
    await pasteShot(page, 400, "#e5484d");
    await expect(pills).toHaveCount(1);
    await page.keyboard.type("look like ");
    await pasteShot(
      page,
      500,
      "#3e63dd",
      "Screenshot 2026-10-01 at 13.42.10.png",
    );
    // The pill shows the file's name; the number is what the agent reads.
    await expect(pills).toHaveText([
      /^image\.png\s*[\d.]+ K?B$/,
      /^Screenshot 2026…2\.10\.png/,
    ]);
    expect(await numbers(pills)).toEqual(["1", "2"]);
    await expect(strip).toHaveCount(2);
    await screenshot(page.locator(".project-composer"), {
      path: "test-results/screenshots/59-image-pills.png",
      animations: "disabled",
    });

    // Deleting a pill takes its screenshot out of the message; undo puts both back.
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await expect(pills).toHaveCount(1);
    await expect(strip).toHaveCount(1);
    await page.keyboard.press("Meta+z");
    await expect(pills).toHaveCount(2);
    await expect(strip).toHaveCount(2);

    // Removing a screenshot from the strip takes its pill out of the text.
    await strip
      .first()
      .getByRole("button", { name: "Remove image.png" })
      .click();
    await expect(pills).toHaveCount(1);
    expect(await numbers(pills)).toEqual(["2"]);
    await expect(input).toHaveText(/^Make look like Screenshot 2026…/);

    await pills.first().click();
    const sketch = page.getByRole("dialog", {
      name: "Draw on Screenshot 2026-10-01 at 13.42.10.png",
    });
    // Escape only closes the editor once the screenshot has loaded.
    await expect(sketch.getByLabel("Drawing layer")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sketch).toHaveCount(0);

    // A new screenshot numbers past the removed one, then sending renumbers.
    await input.focus();
    await page.keyboard.press("End");
    await page.keyboard.type("and ");
    await pasteShot(page, 300, "#30a46c");
    await expect(pills).toHaveCount(2);
    expect(await numbers(pills)).toEqual(["2", "3"]);
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByText("The cache guard prevents duplicate requests.", {
        exact: true,
      }),
    ).toBeVisible();
    const turn = (await readFile(capture, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((c) => c.turn)
      .map(
        (c) => c.turn.input as { type: string; text?: string; path?: string }[],
      )
      .filter((input) => !input[0].text?.startsWith("Generate a short title"))
      .at(-1)!;
    expect(turn[0].text).toContain("Make look like [Image #1] and [Image #2]");
    const sent = turn.filter((item) => item.type === "localImage");
    expect(await Promise.all(sent.map((item) => pngWidth(item.path!)))).toEqual(
      [500, 300],
    );
  } finally {
    await app?.close();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
