import { expect, it, vi } from "vitest";
import { emptyProgress } from "../../shared/types";
import { apiContext, type Services } from "./context";
import { reviewHandlers } from "./reviews";

const github = "https://github.com";
const gitea = "https://git.example.com";

function setup() {
  const state = {
    progress: {} as Record<string, unknown>,
    projects: [],
    chats: [
      // A Gitea pull request's thread, read while signed out of Gitea.
      {
        id: "gitea-thread",
        projectId: "p1",
        scope: {
          kind: "pr",
          ref: { owner: "o", name: "r", number: 1, server: gitea },
        },
      },
      {
        id: "github-thread",
        projectId: "p2",
        scope: {
          kind: "pr",
          ref: { owner: "o", name: "r", number: 2, server: github },
        },
      },
    ],
  };
  const summariesChanged = vi.fn();
  const login = {
    client: null,
    require() {
      throw new Error("Connect your Gitea account first.");
    },
  };
  const services = {
    store: {
      get: () => state,
      update: async (change: (s: typeof state) => void) => change(state),
    },
    login,
    hosts: {
      accountKey: (server: string) =>
        server === github ? server : login.require(),
    },
    projectChats: { summariesChanged },
  } as unknown as Services;
  const handlers = reviewHandlers(apiContext(services));
  return { handlers, state, summariesChanged };
}

it("saves a review's progress while another host's thread can't be keyed", async () => {
  const { handlers, state, summariesChanged } = setup();
  const ref = { owner: "o", name: "r", number: 2, server: github };
  const progress = { ...emptyProgress(), read: { "a.ts": "sha" } };

  await expect(handlers.saveProgress([ref, progress])).resolves.toBeUndefined();

  expect(Object.values(state.progress)).toEqual([progress]);
  expect(summariesChanged).toHaveBeenCalledWith("p2");
});
