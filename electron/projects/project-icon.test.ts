import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  findProjectIcon,
  iconHref,
  imageInfo,
} from "./project-icon";

let root: string, outside: string;
const put = async (path: string, contents: string | Buffer) => {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), contents);
};
/** A PNG header is all the resolver reads for size. */
const png = (width: number, height = width, padding = 0) => {
  const bytes = Buffer.alloc(33 + padding);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
};
const svg = (label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><title>${label}</title></svg>`;
const found = async () =>
  (await findProjectIcon(root))?.path.slice(root.length + 1) ?? null;

beforeEach(async () => {
  // macOS tmpdir is behind a symlink; the resolver reports real paths.
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-icon-")));
  outside = await mkdtemp(join(tmpdir(), "relay-icon-outside-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe("imageInfo", () => {
  it("reads PNG, ICO and SVG sizes", () => {
    expect(imageInfo(png(48, 40), ".png")).toEqual({
      type: "raster",
      width: 48,
      height: 40,
    });
    const ico = Buffer.alloc(6 + 32);
    ico.writeUInt16LE(1, 2);
    ico.writeUInt16LE(2, 4);
    ico[6] = 16;
    ico[7] = 16;
    ico[22] = 0; // 0 means 256
    ico[23] = 0;
    expect(imageInfo(ico, ".ico")).toMatchObject({ width: 256, height: 256 });
    expect(
      imageInfo(Buffer.from('<svg width="100%" viewBox="0 0 120 30">'), ".svg"),
    ).toMatchObject({ type: "svg", width: 120, height: 30 });
    expect(imageInfo(Buffer.from("not an image"), ".png")).toBeNull();
  });
});

describe("iconHref", () => {
  it("finds icon links in either attribute order and in route metadata", () => {
    expect(
      iconHref('<link href="/brand.svg" rel="icon" type="image/svg+xml">'),
    ).toBe("/brand.svg");
    expect(
      iconHref(
        '<link rel="stylesheet" href="a.css"><link rel="shortcut icon" href="%PUBLIC_URL%/b.ico">',
      ),
    ).toBe("%PUBLIC_URL%/b.ico");
    expect(
      iconHref(
        `links: [{ rel: "stylesheet", href: css }, { rel: "icon", href: "/c.png" }]`,
      ),
    ).toBe("/c.png");
    expect(iconHref("<html></html>")).toBeNull();
  });
});

describe("findProjectIcon", () => {
  it("keeps the folder icon when the project has no icon", async () => {
    await put("README.md", "# Nothing here");
    expect(await findProjectIcon(root)).toBeNull();
  });

  it("prefers the JetBrains project icon over everything else", async () => {
    await put("public/favicon.svg", svg("favicon"));
    await put(".idea/icon.svg", svg("idea"));
    expect(await found()).toBe(".idea/icon.svg");
  });

  it("uses the source image beside an electron-builder .icns", async () => {
    await put(
      "package.json",
      JSON.stringify({ build: { mac: { icon: "assets/icon.icns" } } }),
    );
    await put("assets/icon.icns", "icns");
    await put("assets/icon.svg", svg("app"));
    expect(await found()).toBe("assets/icon.svg");
  });

  it("takes the largest icon from a web manifest", async () => {
    await put(
      "public/manifest.json",
      JSON.stringify({
        icons: [{ src: "/icon-64.png" }, { src: "icon-192.png?v=2" }],
      }),
    );
    await put("public/icon-64.png", png(64));
    await put("public/icon-192.png", png(192));
    expect(await found()).toBe("public/icon-192.png");
  });

  it("follows the icon link in index.html", async () => {
    await put(
      "public/index.html",
      '<link rel="icon" href="%PUBLIC_URL%/brand.png">',
    );
    await put("public/brand.png", png(64));
    expect(await found()).toBe("public/brand.png");
  });

  it("skips template icons and moves on to the project's own", async () => {
    await put("index.html", '<link rel="icon" href="/vite.svg">');
    await put("public/vite.svg", svg("vite"));
    expect(await findProjectIcon(root)).toBeNull();
    await put(
      "src/assets/favicon.ico",
      Buffer.concat([
        Buffer.from([0, 0, 1, 0, 1, 0, 64, 64]),
        Buffer.alloc(14),
      ]),
    );
    expect(await found()).toBe("src/assets/favicon.ico");
  });

  it("rejects tiny, wide, empty and oversized images", async () => {
    await put("favicon.png", png(16));
    await put("public/favicon.svg", '<svg viewBox="0 0 400 80"></svg>');
    await put("public/favicon.ico", "");
    await put("app/icon.png", png(512, 512, 300 * 1024));
    expect(await findProjectIcon(root)).toBeNull();
  });

  it("shrinks oversized PNGs when it can", async () => {
    await put("icon.png", png(2048, 2048, 300 * 1024));
    const icon = await findProjectIcon(root, () => "data:image/png;base64,x");
    expect(icon?.dataUrl).toBe("data:image/png;base64,x");
  });

  it("never decodes an image too large to hold in memory", async () => {
    // A few MB of compressed PNG can claim 20000 × 20000 pixels: 1.6 GB decoded.
    await put("favicon.png", png(20000));
    await put("icon.png", png(20000, 20000, 300 * 1024));
    const shrink = vi.fn(() => "data:image/png;base64,x");
    expect(await findProjectIcon(root, shrink)).toBeNull();
    expect(shrink).not.toHaveBeenCalled();
  });

  it("does not follow links out of the project", async () => {
    await writeFile(join(outside, "icon.svg"), svg("outside"));
    await symlink(join(outside, "icon.svg"), join(root, "favicon.svg"));
    expect(await findProjectIcon(root)).toBeNull();
  });

  it("picks a small size from an iOS app icon set", async () => {
    const set = "ios/App/Assets.xcassets/AppIcon.appiconset";
    await put(
      `${set}/Contents.json`,
      JSON.stringify({
        images: [
          { filename: "40.png" },
          { filename: "120.png" },
          { filename: "180.png" },
        ],
      }),
    );
    await put(`${set}/40.png`, png(40));
    await put(`${set}/120.png`, png(120));
    await put(`${set}/180.png`, png(180));
    expect(await found()).toBe(`${set}/120.png`);
  });

  it("looks inside monorepo apps and frontend folders", async () => {
    await put("apps/web/public/favicon.svg", svg("web"));
    expect(await found()).toBe("apps/web/public/favicon.svg");
    await put("frontend/public/favicon.svg", svg("frontend"));
    expect(await found()).toBe("frontend/public/favicon.svg");
  });
});
