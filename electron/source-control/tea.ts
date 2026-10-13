import {
  credentialPassword,
  parseTeaLogins,
  type TeaLogin,
  type TeaSetup,
} from "../../shared/source-control";
import type { Account } from "../../shared/types";
import { normalizeServer } from "../../shared/validation";
import {
  findExecutable,
  runExecutable,
  spawnExecutable,
} from "../platform/executables";
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

/** A token from the tea login for `account`'s server and user. */
export async function teaTokenFor(account: Account): Promise<string> {
  const user = account.user.login.toLowerCase();
  const login = (await teaSetup()).logins.find(
    (l) =>
      serverOf(l.url) === account.server &&
      (!l.user || l.user.toLowerCase() === user),
  );
  if (!login)
    throw new Error(
      `tea has no login for ${account.user.login} on ${new URL(account.server).host}.`,
    );
  return teaToken(login);
}

const serverOf = (url: string) => {
  try {
    return normalizeServer(url);
  } catch {
    return null;
  }
};

/**
 * Asks tea for the token of `login` the way git does, through its credential
 * helper, which first refreshes an OAuth token that is about to expire.
 */
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
  // --login (tea 0.12) picks the login itself; older tea goes by host alone.
  const token =
    credentialPassword(
      await credentialHelper(path, ["--login", login.name], request),
    ) ?? credentialPassword(await credentialHelper(path, [], request));
  if (!token)
    throw new Error(
      `tea has no token for ${login.name}. Run \`tea login add\` with a token for ${url.host}.`,
    );
  return token;
}

async function credentialHelper(
  path: string,
  args: string[],
  request: string,
): Promise<string> {
  const child = spawnExecutable(path, ["logins", "helper", "get", ...args], {
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
  return stdout;
}
