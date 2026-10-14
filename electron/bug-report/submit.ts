import { execFile } from "node:child_process";
import { ApiError } from "../pull-requests/gitea";
import type { GitHub } from "../pull-requests/github";

export interface CreatedIssue {
  number: number;
  url: string;
}

/** What a report needs from GitHub, as the `gh` login. */
export interface IssueHost {
  login: string;
  createIssue(repo: string, title: string, body: string): Promise<CreatedIssue>;
  /** The issue this login opened since `since` whose body holds `marker`. */
  findIssue(
    repo: string,
    marker: string,
    since: number,
  ): Promise<CreatedIssue | null>;
  visibility(repo: string): Promise<"public" | "private">;
}

export function issueHost(client: GitHub): IssueHost {
  const login = client.account.user.login;
  return {
    login,
    async createIssue(repo, title, body) {
      const { data } = await client.request<{
        number: number;
        html_url: string;
      }>(`/repos/${repo}/issues`, { method: "POST", body: { title, body } });
      return { number: data.number, url: data.html_url };
    },
    async findIssue(repo, marker, since) {
      const query = new URLSearchParams({
        creator: login,
        state: "all",
        since: new Date(since).toISOString(),
        sort: "created",
        direction: "desc",
        per_page: "100",
      });
      const { data } = await client.request<
        { number: number; html_url: string; body: string | null }[]
      >(`/repos/${repo}/issues?${query}`);
      const issue = data.find((i) => i.body?.includes(marker));
      return issue ? { number: issue.number, url: issue.html_url } : null;
    },
    async visibility(repo) {
      const { data } = await client.request<{ private: boolean }>(
        `/repos/${repo}`,
      );
      return data.private ? "private" : "public";
    },
  };
}

/**
 * GitHub answered and refused, so nothing was posted. Anything else (a
 * dropped connection, a timeout, a 5xx) may have posted the issue anyway.
 */
export const surelyNotPosted = (error: unknown) =>
  error instanceof ApiError && error.status < 500;

export type Exec = (
  file: string,
  args: string[],
  options: { cwd: string; timeout: number },
) => Promise<{ code: number; stdout: string; stderr: string }>;

export const execGh: Exec = (file, args, options) =>
  new Promise((resolve) =>
    execFile(
      file,
      args,
      { ...options, encoding: "utf8", maxBuffer: 1 << 20 },
      (error, stdout, stderr) =>
        resolve({
          code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          stdout,
          stderr: stderr || (error && !stdout ? error.message : ""),
        }),
    ),
  );

/** `gh` can upload images with a new issue since `--attach` came in. */
export async function ghCanAttach(gh: string, exec: Exec, cwd: string) {
  const { stdout } = await exec(gh, ["issue", "create", "--help"], {
    cwd,
    timeout: 5000,
  });
  return /--attach\b/.test(stdout);
}

export type GhResult =
  | { status: "sent"; issue: CreatedIssue; screenshots: "attached" | "partial" }
  /** `gh` needs a login (its exit code 4), so it posted nothing. */
  | { status: "refused"; error: string }
  /** No issue URL came back; one may still have been created. */
  | { status: "unknown"; error: string };

/**
 * Creates the issue with `gh`, which uploads the screenshots in `dir` and
 * points the body's `./screenshot-n.png` references at them. If some uploads
 * fail, `gh` still creates the issue, prints its URL and exits non-zero: the
 * URL, not the exit code, says whether the issue exists.
 */
export async function ghCreateIssue(
  gh: string,
  exec: Exec,
  input: {
    repo: string;
    title: string;
    bodyFile: string;
    dir: string;
    files: string[];
  },
): Promise<GhResult> {
  const { code, stdout, stderr } = await exec(
    gh,
    [
      "issue",
      "create",
      "--repo",
      input.repo,
      "--title",
      input.title,
      "--body-file",
      input.bodyFile,
      ...input.files.flatMap((file, i) => [
        "--attach",
        `./${file}#Screenshot ${i + 1}`,
      ]),
    ],
    { cwd: input.dir, timeout: 120_000 },
  );
  const issuePattern = new RegExp(
    `https://github\\.com/${input.repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/issues/(\\d+)`,
  );
  const match = issuePattern.exec(stdout);
  if (match)
    return {
      status: "sent",
      issue: { number: Number(match[1]), url: match[0] },
      screenshots: code === 0 ? "attached" : "partial",
    };
  const error =
    stderr.trim().split("\n").at(-1) ||
    `gh exited with code ${code} without an issue link.`;
  return { status: code === 4 ? "refused" : "unknown", error };
}
