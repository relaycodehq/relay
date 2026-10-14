import { mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * The permission profile and folder a helper job runs Codex in. Helpers get
 * everything in their prompt, so the project stays out of reach.
 *
 * Codex 0.162 reads AGENTS.md through a helper that re-runs its own binary
 * inside this profile, and fails the thread when it can't: so the profile
 * reads Codex's install (the link on PATH and the version folder it points
 * to), and the thread runs in an empty folder of Relay's instead of the
 * denied project.
 */
export async function codexHelperSandbox(
  executable: string,
  project: string,
  images: readonly { path: string }[] = [],
) {
  const cwd = join(tmpdir(), "relay-codex-helper");
  await mkdir(cwd, { recursive: true });
  const installed = await realpath(executable).catch(() => executable);
  const filesystem: Record<string, string> = {
    ":root": "deny",
    ":minimal": "read",
    [dirname(executable)]: "read",
    // npm's codex.js starts a binary in the package's vendor folder.
    [dirname(dirname(installed))]: "read",
    [project]: "deny",
  };
  for (const image of images) filesystem[image.path] = "read";
  return { cwd: await realpath(cwd), filesystem };
}
