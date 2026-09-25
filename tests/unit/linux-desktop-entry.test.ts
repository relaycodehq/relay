import {
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  desktopId,
  escapeExecArgument,
  writeAppImageEntry,
} from "../../electron/linux-desktop-entry";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "relay-entry-"));
  const iconSource = join(root, "source.png");
  writeFileSync(iconSource, "png");
  const input = {
    appImage: join(root, "My Apps/Relay $1.AppImage"),
    iconSource,
    iconDir: join(root, "userData"),
    env: { XDG_DATA_HOME: join(root, "data") },
  };
  return { input, entry: join(root, "data/applications", desktopId) };
}

describe("AppImage desktop entry", () => {
  it("escapes the AppImage path for both Exec unescaping passes", () => {
    expect(escapeExecArgument('/a b/$x"%.AppImage')).toBe(
      '"/a b/\\\\$x\\\\"%%.AppImage"',
    );
  });

  it("writes a launcher that opens the AppImage itself", () => {
    const { input, entry } = setup();
    expect(writeAppImageEntry(input)).toBe(true);
    const content = readFileSync(entry, "utf8");
    expect(content).toContain(`Exec=${escapeExecArgument(input.appImage)} %U`);
    expect(content).toContain("MimeType=x-scheme-handler/relay-room;");
    expect(content).toContain("StartupWMClass=relay-experimental\n");
    expect(content).not.toContain("NoDisplay");
    expect(readFileSync(join(input.iconDir, "icon.png"), "utf8")).toBe("png");
  });

  it("leaves an unchanged entry alone", () => {
    const { input, entry } = setup();
    writeAppImageEntry(input);
    const before = statSync(entry).mtimeMs;
    writeAppImageEntry(input);
    expect(statSync(entry).mtimeMs).toBe(before);
  });

  it("never repoints the installer's launcher", () => {
    const { input, entry } = setup();
    mkdirSync(join(entry, ".."), { recursive: true });
    const installed =
      "[Desktop Entry]\nX-Relay-Experimental-Installer=1\n";
    writeFileSync(entry, installed);
    expect(writeAppImageEntry(input)).toBe(false);
    expect(readFileSync(entry, "utf8")).toBe(installed);
  });
});
