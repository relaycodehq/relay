import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PhoneAppFiles } from "./phone-app";
import { phoneAppChunk } from "../../shared/remote";

const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })),
);

function folder(
  files: Record<string, Buffer>,
  manifest?: (listed: object[]) => object,
) {
  const dir = mkdtempSync(join(tmpdir(), "phone-app-"));
  dirs.push(dir);
  const listed = Object.entries(files).map(([path, data]) => {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), data);
    return {
      path,
      size: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
    };
  });
  const body = manifest?.(listed) ?? {
    version: "0.9.12",
    runtime: "abc",
    bundle: "index.android.bundle",
    files: listed,
  };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(body));
  return new PhoneAppFiles(dir);
}

it("hands out a listed file in chunks, and nothing it doesn't list", async () => {
  const bundle = Buffer.alloc(phoneAppChunk + 10, 7);
  const app = folder({
    "index.android.bundle": bundle,
    "drawable-mdpi/back.png": Buffer.from("png"),
  });
  writeFileSync(join(dirs[0], "secret.txt"), "not for phones");

  expect((await app.release())?.version).toBe("0.9.12");
  const first = Buffer.from(
    await app.chunk("index.android.bundle", 0),
    "base64",
  );
  const rest = Buffer.from(
    await app.chunk("index.android.bundle", phoneAppChunk),
    "base64",
  );
  expect(first.length).toBe(phoneAppChunk);
  expect(Buffer.concat([first, rest]).equals(bundle)).toBe(true);
  expect(
    Buffer.from(
      await app.chunk("drawable-mdpi/back.png", 0),
      "base64",
    ).toString(),
  ).toBe("png");

  await expect(app.chunk("secret.txt", 0)).rejects.toThrow(
    "isn't part of the phone app",
  );
  await expect(app.chunk("manifest.json", 0)).rejects.toThrow(
    "isn't part of the phone app",
  );
});

it("offers nothing when the manifest names paths outside its folder", async () => {
  const app = folder(
    { "index.android.bundle": Buffer.from("js") },
    (listed) => ({
      version: "0.9.12",
      runtime: "abc",
      bundle: "index.android.bundle",
      files: [
        ...listed,
        { path: "../../.ssh/id_ed25519", size: 1, sha256: "0".repeat(64) },
      ],
    }),
  );
  expect(await app.release()).toBeUndefined();
  await expect(app.chunk("../../.ssh/id_ed25519", 0)).rejects.toThrow();
});

it("has nothing to offer in a build without the phone app", async () => {
  const app = new PhoneAppFiles(join(tmpdir(), "no-such-phone-app"));
  expect(await app.release()).toBeUndefined();
});
