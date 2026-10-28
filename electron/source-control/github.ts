import {
  parseGhAuth,
  sourceControlNames,
  type SourceControlProvider,
} from "../../shared/source-control";
import { runExecutable } from "../platform/executables";
import { cliFields, probeCli, probeTimeout } from "./clis";

export const installGh =
  process.platform === "darwin"
    ? "Install it with `brew install gh`."
    : process.platform === "win32"
      ? "Install it with `winget install -e --id GitHub.cli`."
      : "Install it from https://cli.github.com.";

/** GitHub through the `gh` CLI and whoever it is logged in as. */
export async function github(enabled: boolean): Promise<SourceControlProvider> {
  const cli = await probeCli("github");
  const base = {
    kind: "github",
    name: sourceControlNames.github,
    cli: "gh",
    enabled,
    ...cliFields(cli),
  } as const;
  if (!cli.path)
    return {
      ...base,
      signIn: "unknown",
      fix: "link",
      detail: cli.error ?? installGh,
    };
  if (!cli.version) return { ...base, signIn: "unknown", detail: cli.error };
  const auth = await runExecutable(
    cli.path,
    ["auth", "status", "--hostname", "github.com"],
    probeTimeout,
  );
  return {
    ...base,
    ...(auth.timedOut
      ? { signIn: "unknown", detail: "`gh` didn't answer in time." }
      : parseGhAuth(auth.output, auth.code)),
  };
}
