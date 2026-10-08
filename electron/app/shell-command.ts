// Relay → Install "relay" Command: a `relay` in ~/.local/bin that opens
// folders in this app (`relay .`) and hands everything else to the headless
// Relay when it's installed beside it.
import { app, dialog } from "electron";
import { existsSync } from "node:fs";
import {
  appendFile,
  chmod,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { relayCommands } from "./open-folder";

/** install.sh leaves a file carrying this alone, so the headless install keeps the shim. */
const marker = "relay-desktop-command";
const installOneLiner = "curl -fsSL https://relaycode.io/install.sh | sh";

export const shellCommandSupported =
  process.platform === "darwin" || process.platform === "linux";

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The shim, opening folders with `open` on macOS or by launching `app` elsewhere. */
export function shimScript(
  platform: NodeJS.Platform,
  appId: string,
  appPath: string,
) {
  const open =
    platform === "darwin"
      ? `exec open -b ${quote(appId)} "$@"`
      : `nohup ${quote(appPath)} "$@" >/dev/null 2>&1 &\n  exit 0`;
  return `#!/bin/sh
# ${marker}: written by Relay (Relay → Install "relay" Command).
# A folder, or nothing, opens in the app; anything else goes to the headless Relay.
headless="\${RELAY_INSTALL:-$HOME/.local/share/relay}/bin/relay"
case "\${1-}" in
  ${relayCommands.join("|")}|-*) ;;
  *)
    if [ $# -eq 0 ] || { [ $# -eq 1 ] && [ -d "$1" ]; }; then
      [ $# -eq 0 ] || set -- "$(cd "$1" && pwd -P)"
      ${open}
    fi
    ;;
esac
[ -x "$headless" ] && exec "$headless" "$@"
echo "That's a command of the headless Relay, which isn't installed. Install it with:" >&2
echo "  ${installOneLiner}" >&2
exit 1
`;
}

/** Where the user's shell reads its PATH from, and the line that adds `dir` to it. */
function shellStartup(dir: string, home = homedir()) {
  const export_ = `export PATH="${dir}:$PATH"`;
  switch (basename(process.env.SHELL ?? "sh")) {
    case "zsh":
      return { rc: join(process.env.ZDOTDIR ?? home, ".zshrc"), line: export_ };
    case "bash":
      return {
        rc: join(
          home,
          process.platform === "darwin" ? ".bash_profile" : ".bashrc",
        ),
        line: export_,
      };
    case "fish":
      return {
        rc: join(home, ".config/fish/conf.d/relay.fish"),
        line: `fish_add_path ${dir}`,
      };
    default:
      return { rc: join(home, ".profile"), line: export_ };
  }
}

async function addToPath(dir: string) {
  // The app's PATH comes from the login shell, so this sees what terminals see.
  if ((process.env.PATH ?? "").split(":").includes(dir)) return undefined;
  const { rc, line } = shellStartup(dir);
  const now = await readFile(rc, "utf8").catch(() => "");
  if (!now.includes(line)) {
    await mkdir(dirname(rc), { recursive: true });
    await appendFile(rc, `\n# Relay\n${line}\n`);
  }
  return rc;
}

export async function installShellCommand() {
  const bin = join(homedir(), ".local", "bin");
  const target = join(bin, "relay");
  try {
    await mkdir(bin, { recursive: true });
    // It may be a link into the headless install; writing through it would replace that.
    await rm(target, { force: true });
    await writeFile(
      target,
      shimScript(
        process.platform,
        "dev.relay.experimental",
        process.env.APPIMAGE ?? app.getPath("exe"),
      ),
    );
    await chmod(target, 0o755);
    const rc = await addToPath(bin);
    const headless = existsSync(
      join(homedir(), ".local/share/relay/bin/relay"),
    );
    await dialog.showMessageBox({
      type: "info",
      message: "The relay command is installed",
      detail: [
        `Run relay . in a project folder to open it here.${rc ? ` Open a new terminal first; ${rc} now puts ${bin} on your PATH.` : ""}`,
        headless
          ? "Its other commands go to the headless Relay installed on this computer."
          : `To run Relay with no screen, like on a server, install the headless Relay:\n${installOneLiner}`,
      ].join("\n\n"),
    });
  } catch (e) {
    await dialog.showMessageBox({
      type: "error",
      message: "Couldn't install the relay command",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}
