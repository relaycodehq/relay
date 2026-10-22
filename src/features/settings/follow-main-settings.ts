import type { QueryClient } from "@tanstack/react-query";

/**
 * What the main process reads from settings.json, by the queries that show it.
 * Each preference in electron/settings/app-prefs.ts needs its query here.
 */
export const mainSettings = [
  ["keep-awake"],
  ["usage-ping"],
  ["auto-settle-days"],
  ["worktree-cleanup-days"],
  ["watch-threads"],
];

/** A script, an editor or `relay settings` changed the file; show what it says now. */
export function followMainSettings(client: QueryClient) {
  window.relay.onSettingsFile(() => {
    for (const queryKey of mainSettings)
      void client.invalidateQueries({ queryKey });
  });
}
