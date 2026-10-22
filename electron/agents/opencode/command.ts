import { parseVersion } from "../../../shared/agent-updates";
import {
  findExecutable,
  installStamp,
  runExecutable,
} from "../../platform/executables";
import { memoByKey } from "../../util/memo";

const supported = memoByKey(
  async (stamp) => {
    const { stdout } = await runExecutable(
      stamp.split("\0")[0],
      ["--version"],
      10_000,
    );
    const major = Number(parseVersion(stdout)?.split(".")[0]);
    if (!(major >= 2))
      throw new Error(
        "Relay requires OpenCode 2 or later. Update OpenCode in Settings → AI & agents → Agents, then try again.",
      );
  },
  { ttl: 10 * 60_000, max: 4 },
);

/** Check the installed CLI again after an upgrade, without retaining an old runtime. */
export async function openCodeCommand() {
  const command = await findExecutable("opencode");
  await supported(await installStamp(command));
  return { command, args: ["acp"] };
}
