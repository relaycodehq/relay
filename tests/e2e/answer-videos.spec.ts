import { test, expect, _electron as electron } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

const ffmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

test("an answer plays the local video it embeds, and seeks in it", async () => {
  test.skip(!ffmpeg, "needs ffmpeg to make a clip");
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-videos-"))),
    data = join(root, "data"),
    bin = join(root, "bin"),
    clip = join(root, "demo run.mp4");
  await mkdir(bin);
  // What an agent's screen recording usually is: H.264 in an MP4.
  execFileSync("ffmpeg", [
    ...["-loglevel", "error", "-f", "lavfi"],
    ...["-i", "testsrc=duration=3:size=320x240:rate=15"],
    ...["-c:v", "libx264", "-pix_fmt", "yuv420p", clip],
  ]);
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
    await page.keyboard.press("ControlOrMeta+Shift+N");
    await page
      .getByLabel("Message project")
      .fill(
        `fixture echo: Here it is: ![the demo](<${clip}>) and ![](${join(root, "gone.mp4")}) done.`,
      );
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();

    const answer = page.locator(".project-message.assistant");
    await expect(answer).toContainText("done.");
    const video = answer.getByLabel("the demo");
    await expect(video).toBeVisible();
    // A missing file leaves nothing, not even an empty player.
    await expect(answer.locator("video")).toHaveCount(1);

    const state = await video.evaluate(async (v: HTMLVideoElement) => {
      if (v.readyState < 1)
        await new Promise((r) => v.addEventListener("loadedmetadata", r));
      const seeked = new Promise((r) => v.addEventListener("seeked", r));
      v.currentTime = 2;
      await seeked;
      v.muted = true;
      await v.play();
      await new Promise((r) => setTimeout(r, 300));
      v.pause();
      return {
        duration: v.duration,
        width: v.videoWidth,
        time: v.currentTime,
        error: v.error?.message,
      };
    });
    expect(state.error).toBeUndefined();
    expect(state.duration).toBeCloseTo(3, 0);
    expect(state.width).toBe(320);
    expect(state.time).toBeGreaterThan(2);
    await page.screenshot({ path: join(tmpdir(), "relay-answer-videos.png") });

    // Make the media pipeline fail, rather than dispatching a synthetic event.
    // Exhausting retries must keep the player and its space in the answer.
    const before = await video.boundingBox();
    const source = await video.getAttribute("src");
    for (let attempt = 0; attempt < 3; attempt++) {
      await video.evaluate((v: HTMLVideoElement) => {
        v.src = "data:video/mp4;base64,AA==";
      });
      if (attempt < 2) {
        await expect(video).toHaveAttribute("src", source!);
        await expect
          .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
          .toBeGreaterThanOrEqual(1);
      }
    }
    const retry = answer.getByRole("button", { name: "Retry video" });
    await expect(retry).toBeVisible();
    await expect(video).toBeVisible();
    expect(await video.boundingBox()).toEqual(before);
    await page.screenshot({
      path: join(tmpdir(), "relay-answer-video-error.png"),
    });
    await retry.click();
    await expect(retry).toHaveCount(0);
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
      .toBeGreaterThanOrEqual(1);
    expect(
      await video.evaluate(async (v: HTMLVideoElement) => {
        v.currentTime = 0;
        await v.play();
        return v.error;
      }),
    ).toBeNull();

    // Only a checked file has an address; a made-up one plays nothing.
    const status = await app.evaluate(({ session }) =>
      session.defaultSession
        .fetch("relay-media://file/not-a-token/x.mp4")
        .then((r) => r.status),
    );
    expect(status).toBe(404);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
