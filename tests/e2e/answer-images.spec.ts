import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fakeCli, pathWith } from "../fixtures/fake-cli";
import type { ChatMessage, ProjectChat } from "../../shared/projects";

test("an answer shows the local images it embeds and drops the ones that don't load", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-images-"))),
    data = join(root, "data"),
    bin = join(root, "bin");
  await mkdir(bin);
  await fakeCli(
    join(bin, "codex"),
    await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
      ...pathWith(env, bin),
      RELAY_TEST_DATA: data,
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
    },
  });
  try {
    const page = await app.firstWindow();
    await expect(
      page.getByText("Your project. Your conversation."),
    ).toBeVisible();
    const shot = join(root, "after.png");
    await writeFile(shot, await page.screenshot());
    await writeFile(join(root, "fake.png"), "not an image");

    await page.keyboard.press("ControlOrMeta+Shift+N");
    await page
      .getByLabel("Message project")
      .fill(
        [
          `fixture echo: Before ![](${join(root, "missing.png")}) after:`,
          `![the welcome screen](file://${shot})`,
          `Broken ![](${join(root, "fake.png")}) and remote ![logo](https://example.com/logo.png) done.`,
        ].join("\n\n"),
      );
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();

    const answer = page.locator(".project-message.assistant");
    await expect(answer).toContainText("done.");
    const image = answer.getByRole("img", { name: "the welcome screen" });
    await expect(image).toBeVisible();
    expect(
      await image.evaluate((img: HTMLImageElement) => img.naturalWidth),
    ).toBeGreaterThan(100);
    // The missing and non-image files leave nothing, not even a placeholder.
    await expect(answer.locator("img")).toHaveCount(1);
    await expect(answer).not.toContainText("[Image");
    await expect(answer.getByRole("link", { name: "logo" })).toBeVisible();
    // Shown in the text, so not again in the strip below it.
    await expect(answer.locator(".message-images")).toHaveCount(0);
    await page.screenshot({ path: join(tmpdir(), "relay-answer-images.png") });

    // Dragged into the composer, it attaches like a pasted screenshot.
    await image.dragTo(page.getByLabel("Message project"));
    await expect(page.locator(".composer-image")).toHaveCount(1);
    await expect(
      page.locator(".composer-image").getByRole("img"),
    ).toHaveJSProperty("complete", true);

    await image.click();
    await expect(
      page.getByRole("dialog").getByRole("img", { name: "after.png" }),
    ).toBeVisible();
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("inspected images start folded and remember the thread's choice after reopening", async () => {
  const root = await realpath(
      await mkdtemp(join(tmpdir(), "relay-image-fold-")),
    ),
    data = join(root, "data"),
    repo = join(root, "project"),
    bin = join(root, "bin");
  let app: ElectronApplication | undefined;
  try {
    await mkdir(repo);
    await mkdir(bin);
    await fakeCli(
      join(bin, "codex"),
      await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
    );
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    await mkdir(join(data, "project-chats"), { recursive: true });
    const projectId = randomUUID();
    const paths = ["before.png", "after.png", "detail.png"].map((name) =>
      join(repo, name),
    );
    const message = (
      body: string,
      extra: Partial<ChatMessage> = {},
    ): ChatMessage => ({
      id: randomUUID(),
      body,
      role: "assistant",
      status: "complete",
      provider: "codex",
      created: 1,
      version: 1,
      ...extra,
    });
    const reads = paths.map((label, i) => ({
      id: `read-${i}`,
      kind: "read" as const,
      label,
      status: "complete" as const,
    }));
    const chats: ProjectChat[] = ["Screenshots", "Other thread"].map(
      (title) => ({
        id: randomUUID(),
        projectId,
        title,
        scope: { kind: "project" },
        created: 1,
        updated: 1,
        messages: [
          message("Check these sample screens.", {
            role: "user",
          }),
          message("I checked the sample screens.", {
            activity: reads,
          }),
          message("I also checked the detail.", {
            activity: [reads[2]!],
          }),
        ],
      }),
    );
    for (const chat of chats)
      await writeFile(
        join(data, "project-chats", `${chat.id}.json`),
        JSON.stringify(chat),
      );
    await writeFile(
      join(data, "state.json"),
      JSON.stringify({
        version: 1,
        folders: {},
        progress: {},
        projects: [
          {
            id: projectId,
            path: repo,
            name: "project",
            repository: null,
            added: 1,
          },
        ],
        chats: chats.map((chat) => ({ ...chat, messages: undefined })),
      }),
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
        ...pathWith(env, bin),
        RELAY_TEST_DATA: data,
        RELAY_TEST_HEADED: "0",
        RELAY_TEST_NATIVE_STORAGE: "0",
      },
    });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1200, height: 900 });
    // Draw sample screenshots without reading any of the user's images.
    const samples = await page.evaluate(async () => {
      return Promise.all(
        ["#5c74ce", "#3c9478", "#b07944"].map(async (color, i) => {
          const canvas = new OffscreenCanvas(600, 400);
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = "#202126";
          ctx.fillRect(0, 0, 600, 400);
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 600, 40);
          ctx.fillRect(24, 108, 552, 170);
          ctx.fillStyle = "#eee";
          ctx.font = "20px sans-serif";
          ctx.fillText(`Sample screen ${i + 1}`, 24, 80);
          const blob = await canvas.convertToBlob({ type: "image/png" });
          return Array.from(new Uint8Array(await blob.arrayBuffer()));
        }),
      );
    });
    for (const [i, path] of paths.entries())
      await writeFile(path, Buffer.from(samples[i]!));

    const openThread = (title: string) =>
      page.locator(".sb-thread", { hasText: title }).click();
    const gallery = page.getByRole("button", {
      name: "Agent looked at 3 images",
      exact: true,
    });
    const detail = page.getByRole("button", {
      name: "Agent looked at 1 image",
      exact: true,
    });
    await openThread("Screenshots");
    await expect(gallery).toHaveAttribute("aria-expanded", "false");
    await expect(detail).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".message-image")).toHaveCount(0);
    await page.screenshot({
      path: join(tmpdir(), "relay-images-collapsed.png"),
    });

    await gallery.press("Enter");
    await expect(gallery).toHaveAttribute("aria-expanded", "true");
    await expect(detail).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".message-image img")).toHaveCount(4);
    await expect(page.locator(".message-image img").first()).toHaveJSProperty(
      "naturalWidth",
      600,
    );
    await page.screenshot({
      path: join(tmpdir(), "relay-images-expanded.png"),
    });
    await page
      .getByRole("button", { name: "Open before.png", exact: true })
      .click();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("img", { name: "before.png", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    await openThread("Other thread");
    await expect(gallery).toHaveAttribute("aria-expanded", "false");
    await openThread("Screenshots");
    await expect(gallery).toHaveAttribute("aria-expanded", "true");
    await page.reload();
    await expect(gallery).toHaveAttribute("aria-expanded", "true");
    await detail.click();
    await expect(gallery).toHaveAttribute("aria-expanded", "false");
    await page.reload();
    await expect(gallery).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".message-image")).toHaveCount(0);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
