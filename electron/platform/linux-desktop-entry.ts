import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Shared with packaging/omarchy/install.py and package.json's desktopName.
export const desktopId = "relay-experimental.desktop";
const installerMarker = "X-Relay-Experimental-Installer=1";
const appImageMarker = "X-Relay-AppImage=1";

// Each table is applied in one pass, so the backslashes an escape adds are never escaped again.
/** The spec's string type: backslash, newline, carriage return and tab. */
const stringEscapes: Record<string, string> = {
  "\\": "\\\\",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
};
const escapeString = (value: string) =>
  value.replace(/[\\\n\r\t]/g, (c) => stringEscapes[c]);

/** Inside an Exec argument's double quotes; a bare `%` would start a field code. */
const quotedEscapes: Record<string, string> = {
  "\\": "\\\\",
  "`": "\\`",
  $: "\\$",
  '"': '\\"',
  "%": "%%",
};
const escapeQuoted = (value: string) =>
  value.replace(/[\\`$"%]/g, (c) => quotedEscapes[c]);

// Exec is unescaped twice: string rules first, then Exec quoting, so write in reverse.
export function escapeExecArgument(value: string) {
  return escapeString(`"${escapeQuoted(value)}"`);
}

function renderAppImageEntry(appImage: string, icon: string) {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Version=1.0",
    "Name=Relay",
    "Comment=Chat about projects, edit code and review pull requests",
    `Exec=${escapeExecArgument(appImage)} %U`,
    `Icon=${escapeString(icon)}`,
    "Terminal=false",
    "Categories=Development;",
    `StartupWMClass=${desktopId.replace(/\.desktop$/, "")}`,
    appImageMarker,
    "",
  ].join("\n");
}

const read = (path: string) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

/**
 * AppImages get no launcher on desktops without an integration tool (Omarchy has
 * none). Writes one pointing at the AppImage itself; the mounted execPath is a
 * transient /tmp/.mount_* path. Returns whether the entry was ours to write.
 */
export function writeAppImageEntry(input: {
  appImage: string;
  iconSource: string;
  iconDir: string;
  env: NodeJS.ProcessEnv;
}): boolean {
  const applications = join(
    input.env.XDG_DATA_HOME?.trim() || join(homedir(), ".local/share"),
    "applications",
  );
  const path = join(applications, desktopId);
  const existing = read(path);
  // The installer's copy owns this id; an AppImage run alongside must not repoint it.
  if (existing?.split("\n").includes(installerMarker)) return false;

  const icon = join(input.iconDir, "icon.png");
  const iconBytes = readFileSync(input.iconSource);
  mkdirSync(input.iconDir, { recursive: true });
  let current: Buffer | null = null;
  try {
    current = readFileSync(icon);
  } catch {}
  if (!current?.equals(iconBytes)) writeFileSync(icon, iconBytes);

  const content = renderAppImageEntry(input.appImage, icon);
  // Rewriting an unchanged entry would make launchers reload it on every start.
  if (existing !== content) {
    mkdirSync(applications, { recursive: true });
    writeFileSync(path, content, { mode: 0o644 });
    execFile("update-desktop-database", [applications], () => {});
  }
  return true;
}

/** Best effort: a read-only home must never block startup. */
export function registerAppImage(
  input: Parameters<typeof writeAppImageEntry>[0],
) {
  try {
    writeAppImageEntry(input);
  } catch (error) {
    console.warn("Could not write Relay's desktop entry:", error);
  }
}
