import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { Gitea } from "../../electron/gitea";
import type { RoomProject } from "../../shared/rooms";
import type { RepositoryVerifier } from "../../server/repository-access";
// Deterministic identity fixture. Real credential verification is covered by repository-access.test.ts.
export const roomVerifier: RepositoryVerifier = {
  verify: async (project, credential) => {
    if (!["alice", "bob"].includes(credential))
      throw new Error("Invalid fixture credential");
    return {
      userId: credential === "alice" ? 1 : 2,
      login: credential,
      name: credential,
      repositoryId: 7,
      server: project.server,
    };
  },
};
export function roomClient(project: RoomProject, login = "alice") {
  return {
    account: { id: login, server: project.server, user: { login } },
    repo: () => `/repos/${project.owner}/${project.name}`,
    request: async () => ({ id: 7 }),
    withRepositoryCredential: async (send: (key: string) => unknown) =>
      send(login),
    pull: async () => ({ title: "Fixture PR" }),
  } as unknown as Gitea;
}
export async function roomClone(dir: string, project: RoomProject) {
  await mkdir(dir, { recursive: true });
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  git(
    "remote",
    "add",
    "origin",
    `${project.server}/${project.owner}/${project.name}.git`,
  );
  await writeFile(join(dir, "README.md"), "Fixture");
  git("add", ".");
  git("commit", "-qm", "Base");
  return dir;
}
