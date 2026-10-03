import {
  credentialPassword,
  parseTeaLogins,
  type TeaLogin,
  type TeaSetup,
} from "../../shared/source-control";
import { findExecutable, runExecutable, spawnExecutable } from "../platform/executables";
import { cliFields, plain, probeCli, probeTimeout as timeout } from "./clis";

/** The `tea` CLI and the servers it is logged in to. */
export async function teaSetup(): Promise<TeaSetup> {
  const cli = await probeCli("gitea");
  const found = { ...cliFields(cli), logins: [] };
  if (!cli.path || !cli.version)
    return cli.error ? { ...found, error: cli.error } : found;
  const list = await runExecutable(
    cli.path,
    ["logins", "list", "--output", "json"],
    timeout,
  );
  return {
    ...found,
    logins: parseTeaLogins(list.stdout),
    ...(list.code !== 0
      ? {
          error:
            plain(list.output).trim().slice(-300) ||
            "tea couldn't list its logins.",
        }
      : {}),
  };
}

/** Asks tea for the token of `login` the way git does, through its credential helper. */
export async function teaToken(login: TeaLogin): Promise<string> {
  const path = await findExecutable("tea");
  const url = new URL(login.url);
  const request = [
    `protocol=${url.protocol.slice(0, -1)}`,
    `host=${url.host}`,
    ...(login.user ? [`username=${login.user}`] : []),
    "",
    "",
  ].join("\n");
  const child = spawnExecutable(path, ["logins", "helper", "get"], {
    env: process.env,
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
  });
  let stdout = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    if (stdout.length < 10_000) stdout += chunk.toString();
  });
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("tea didn't answer in time."));
    }, timeout);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  child.stdin?.on("error", () => {});
  child.stdin?.end(request);
  await done;
  const token = credentialPassword(stdout);
  if (!token)
    throw new Error(
      `tea has no token for ${login.name}. Run \`tea login add\` with a token for ${url.host}.`,
    );
  return token;
}
