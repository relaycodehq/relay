import { relayEnv, test, expect, _electron as electron } from "../fixtures/electron";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { deflateSync } from "node:zlib";
import { fakeCli, pathWith } from "../fixtures/fake-cli";
import { openSurface } from "../fixtures/navigation";
import { screenshot } from "../fixtures/screenshot";

/** A square PNG of one colour. */
function solidPng(size: number, [r, g, b]: [number, number, number]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [r, g, b]).flat())]);
  const pixels = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("a changed picture in Files shows before and after, and the file itself on request", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-media-changes-"))),
    repo = join(root, "app"),
    bin = join(root, "bin");
  await mkdir(repo, { recursive: true });
  await mkdir(bin);
  await writeFile(join(repo, "logo.png"), solidPng(64, [220, 60, 60]));
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.name", "Fixture Author");
  git("config", "user.email", "fixture@example.invalid");
  git("add", ".");
  git("commit", "-qm", "Base");
  await writeFile(join(repo, "logo.png"), solidPng(96, [60, 120, 220]));
  await fakeCli(join(bin, "codex"), await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"));
  const env = relayEnv();
  const app = await electron.launch({
    env: { ...env, ...pathWith(env, bin), RELAY_TEST_DATA: join(root, "data") },
  });
  try {
    const page = await app.firstWindow();
    page.on("dialog", () => {});
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, repo);
    await page.evaluate(() => window.relay.addProject());
    await page.reload();
    await page.getByLabel("Message project").fill("hello");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await openSurface(page, "Files");

    const sidebar = page.locator(".project-file-list");
    await sidebar.getByRole("tab", { name: /^Changes/ }).click();
    await sidebar.getByRole("button", { name: "Modified logo.png" }).click();

    // Opened from Changes, it shows both versions.
    const change = page.getByRole("region", { name: "Changes" });
    await expect(change.getByRole("img", { name: "HEAD" })).toBeVisible();
    await expect(change.getByRole("img", { name: "Now" })).toBeVisible();
    await expect(change.getByText("64 × 64")).toBeVisible();
    await expect(change.getByText("96 × 96")).toBeVisible();
    await screenshot(page, { path: "test-results/screenshots/editor-media-change.png" });

    // The file itself, and back.
    await change.getByRole("button", { name: "Show the file" }).click();
    const image = page.getByRole("region", { name: "Image" });
    await expect(image.getByRole("img", { name: "logo.png" })).toBeVisible();
    await image.getByRole("button", { name: "Show changes" }).click();
    await expect(change.getByRole("img", { name: "HEAD" })).toBeVisible();
  } finally {
    await app
      .evaluate(({ dialog }) => {
        dialog.showMessageBoxSync = () => 1;
      })
      .catch(() => {});
    await app.close().catch(() => {});
  }
});
