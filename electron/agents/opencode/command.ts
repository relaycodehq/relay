import { parseVersion } from "../../../shared/agent-updates";
import {
  findExecutable,
  installStamp,
  runExecutable,
} from "../../platform/executables";
import { memoByKey } from "../../util/memo";

/** The installed OpenCode's version, read again once its install changes. */
const versionOf = memoByKey(
  async (stamp) => {
    const { stdout } = await runExecutable(
      stamp.split("\0")[0],
      ["--version"],
      10_000,
    );
    const version = parseVersion(stdout);
    if (!(Number(version?.split(".")[0]) >= 2))
      throw new Error(
        "Relay requires OpenCode 2 or later. Update OpenCode in Settings → AI & agents → Agents, then try again.",
      );
    return version!;
  },
  { ttl: 10 * 60_000, max: 4 },
);

export async function openCodeVersion() {
  return versionOf(await installStamp(await findExecutable("opencode")));
}

/** Check the installed CLI again after an upgrade, without retaining an old runtime. */
export async function openCodeCommand() {
  const command = await findExecutable("opencode");
  await versionOf(await installStamp(command));
  return { command, args: ["acp"] };
}
