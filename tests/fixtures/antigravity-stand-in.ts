import { findExecutable } from "../../electron/platform/executables";

/**
 * Antigravity is a server Relay downloads, not a CLI on the PATH; in a
 * scenario it's whatever `findExecutable("antigravity")` is mocked to, like
 * the other agents.
 */
async function standIn() {
  const command = await findExecutable("antigravity");
  return command ? { version: "replay", command, args: [] } : undefined;
}

export const antigravityStandIn = {
  currentAntigravity: standIn,
  ensureAntigravity: async () => {
    const found = await standIn();
    if (!found) throw new Error("No Antigravity stand-in.");
    return found;
  },
};
