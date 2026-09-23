import { z } from "zod";
import type { RoomProject } from "../shared/rooms";
import { normalizeServer } from "../shared/validation";
import { readBounded, ResponseTooLarge } from "../shared/http";
import { HttpError } from "./database";
export interface RepositoryIdentity {
  userId: number;
  login: string;
  name: string;
  repositoryId: number;
  server: string;
}
export interface RepositoryVerifier {
  verify(project: RoomProject, credential: string): Promise<RepositoryIdentity>;
}
export const repositoryCredentialSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[\x21-\x7e]+$/);
/** Only operator-configured Gitea URLs may receive a credential or outbound request. */
export class GiteaRepositoryVerifier implements RepositoryVerifier {
  private servers: Set<string>;
  constructor(
    servers: string[],
    private network: typeof fetch = fetch,
  ) {
    this.servers = new Set(servers.map((s) => normalizeServer(s)));
  }
  async verify(
    project: RoomProject,
    credential: string,
  ): Promise<RepositoryIdentity> {
    repositoryCredentialSchema.parse(credential);
    const server = normalizeServer(project.server);
    if (!this.servers.has(server))
      throw new HttpError(
        403,
        "This Gitea server is not enabled by the room server administrator.",
      );
    const read = async (path: string) => {
      let response: Response;
      try {
        response = await this.network(server + "/api/v1" + path, {
          headers: {
            Authorization: "token " + credential,
            Accept: "application/json",
          },
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        });
      } catch {
        throw new HttpError(
          503,
          "The room server cannot reach Gitea to verify repository access.",
        );
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new HttpError(
          response.status === 401 ||
            response.status === 403 ||
            response.status === 404
            ? 403
            : 503,
          "Gitea could not verify your access to this repository.",
        );
      }
      if (!response.body)
        throw new HttpError(503, "Gitea returned no access-check response.");
      let text: string;
      try {
        text = await readBounded(response, 256000, "");
      } catch (error) {
        if (error instanceof ResponseTooLarge)
          throw new HttpError(503, "Gitea access-check response is too large.");
        throw error;
      }
      try {
        return JSON.parse(text);
      } catch {
        throw new HttpError(
          503,
          "Gitea returned an invalid access-check response.",
        );
      }
    };
    const [user, repo] = await Promise.all([
      read("/user"),
      read(
        `/repos/${encodeURIComponent(project.owner)}/${encodeURIComponent(project.name)}`,
      ),
    ]);
    if (
      !Number.isSafeInteger(user.id) ||
      user.id < 1 ||
      typeof user.login !== "string" ||
      !Number.isSafeInteger(repo.id) ||
      repo.id < 1 ||
      typeof repo.full_name !== "string" ||
      repo.full_name.toLowerCase() !==
        `${project.owner}/${project.name}`.toLowerCase() ||
      repo.permissions?.pull === false
    )
      throw new HttpError(
        403,
        "Gitea identity or repository access did not match.",
      );
    return {
      userId: user.id,
      login: user.login,
      name: String(user.full_name || user.login).slice(0, 80),
      repositoryId: repo.id,
      server,
    };
  }
}
export const denyRepositoryAccess: RepositoryVerifier = {
  verify: async () => {
    throw new HttpError(
      503,
      "The room server has no Gitea access verifier configured.",
    );
  },
};
