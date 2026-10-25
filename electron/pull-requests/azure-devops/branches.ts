import type { Repo } from "../../../shared/types";
import type { AzureDevOps } from "./client";
import { VERSION } from "./shapes";

/** The repository's branches whose names start with `filter`, every page of them. */
export async function branchRefs(azure: AzureDevOps, r: Repo, filter: string) {
  const refs: { name: string; objectId: string }[] = [];
  let continuation = "";
  for (let page = 0; page < 100; page++) {
    const query = new URLSearchParams({
      filter: `heads/${filter}`,
      $top: "1000",
      ...(continuation ? { continuationToken: continuation } : {}),
    });
    const { data, headers } = await azure.request<{
      value: { name: string; objectId: string }[];
    }>(`${azure.repoPath(r)}/refs?${query}&${VERSION}`);
    refs.push(...data.value);
    continuation = headers.get("x-ms-continuationtoken") ?? "";
    if (!continuation) return refs;
  }
  throw new Error(
    "This repository has too many branches to load safely. Open the PR in Azure DevOps.",
  );
}
