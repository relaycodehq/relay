import { realpath } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * The permission profile a helper job runs Codex under. Helpers get everything
 * in their prompt, so the project stays out of reach.
 *
 * Codex 0.162 reads AGENTS.md through a helper that re-runs its own binary
 * inside this profile, and fails the thread when it can't: so the profile
 * reads Codex's install (the link on PATH and the version folder it points
 * to). The folder it runs in is the empty one its caller gives, never the
 * denied project.
 */
export async function codexHelperSandbox(
  executable: string,
  project: string,
  images: readonly { path: string }[] = [],
) {
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
  return { filesystem };
}
