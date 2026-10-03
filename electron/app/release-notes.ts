import { net } from "electron";
import { releaseNotesFrom, releasesApi } from "../../shared/updates";

/** Every published release's notes, straight from the releases repo. */
export async function fetchReleaseNotes() {
  const response = await net
    .fetch(releasesApi, {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(20_000),
    })
    .catch((error) => {
      throw new Error("Couldn't reach GitHub for the changelog.", {
        cause: error,
      });
    });
  if (!response.ok)
    throw new Error(
      response.status === 403 || response.status === 429
        ? "GitHub is rate limiting the changelog; try again in a while."
        : `GitHub answered ${response.status} for the changelog.`,
    );
  return releaseNotesFrom(await response.json());
}
