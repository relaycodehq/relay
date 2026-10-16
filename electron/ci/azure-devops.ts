import type { CiRun, CiState } from "../../shared/ci";
import type { AzureDevOps } from "../pull-requests/azure-devops/client";
import type { CiReading } from "./index";

/** A repository in an Azure DevOps organization, its project as `owner`. */
export interface AzureCiRepo {
  server: string;
  owner: string;
  name: string;
}

interface AzBuild {
  definition: { id: number; name: string };
  status: string;
  result?: string;
  sourceVersion: string;
  queueTime?: string;
  startTime?: string;
  finishTime?: string;
  _links?: { web?: { href?: string } };
  triggerInfo?: Record<string, string>;
  requestedFor?: { displayName?: string };
}

const repositories = new Map<
  string,
  { id: string; branch: string; at: number }
>();

/** Builds ask for the repository's id, not its name; both change rarely. */
async function repository(client: AzureDevOps, repo: AzureCiRepo) {
  const key = `${repo.server} ${repo.owner}/${repo.name}`.toLowerCase();
  const known = repositories.get(key);
  if (known && Date.now() - known.at < 10 * 60_000) return known;
  const { data } = await client.request<{ id: string; defaultBranch?: string }>(
    `${repo.server}/${encodeURIComponent(repo.owner)}/_apis/git/repositories/${encodeURIComponent(repo.name)}?api-version=7.1`,
  );
  const found = {
    id: data.id,
    branch: (data.defaultBranch ?? "refs/heads/main").replace(
      /^refs\/heads\//,
      "",
    ),
    at: Date.now(),
  };
  repositories.set(key, found);
  return found;
}

export const azureDefaultBranch = async (
  client: AzureDevOps,
  repo: AzureCiRepo,
) => (await repository(client, repo)).branch;

export function azureBuildState(
  build: Pick<AzBuild, "status" | "result">,
): CiState {
  if (build.status !== "completed") return "running";
  switch (build.result) {
    case "succeeded":
    case "partiallySucceeded":
      return "success";
    case "failed":
      return "failure";
    default:
      return "skipped";
  }
}

/**
 * Azure Pipelines on the branch: the commit the newest build ran on, and the
 * latest build of each pipeline there. Newest first, so the first build per
 * pipeline is the current one.
 */
export function latestAzureBuilds(builds: AzBuild[]): CiReading | null {
  const head = builds[0];
  if (!head) return null;
  const seen = new Set<number>();
  const runs: CiRun[] = [];
  for (const b of builds) {
    if (b.sourceVersion !== head.sourceVersion || seen.has(b.definition.id))
      continue;
    seen.add(b.definition.id);
    runs.push({
      workflow: b.definition.name,
      state: azureBuildState(b),
      url: b._links?.web?.href ?? "",
      at:
        Date.parse(b.finishTime ?? b.startTime ?? b.queueTime ?? "") ||
        Date.now(),
    });
  }
  return {
    commit: {
      sha: head.sourceVersion.toLowerCase(),
      message: head.triggerInfo?.["ci.message"]?.split("\n")[0],
      author: head.requestedFor?.displayName,
    },
    runs,
  };
}

export async function readAzure(
  client: AzureDevOps,
  repo: AzureCiRepo,
  branch: string,
): Promise<CiReading | null> {
  const { id } = await repository(client, repo);
  const query = new URLSearchParams({
    repositoryId: id,
    repositoryType: "TfsGit",
    branchName: `refs/heads/${branch}`,
    queryOrder: "queueTimeDescending",
    $top: "50",
  });
  const { data } = await client.request<{ value: AzBuild[] }>(
    `${repo.server}/${encodeURIComponent(repo.owner)}/_apis/build/builds?${query}&api-version=7.1`,
  );
  return latestAzureBuilds(data.value);
}
