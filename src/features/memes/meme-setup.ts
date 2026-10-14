import type { AgentProvider } from "../../../shared/agents";
import {
  memeAgents,
  memeSetupAgent,
  memeSetupPrompt,
} from "../../../shared/memes";
import type { LinkedFolder } from "../../../shared/projects/links";
import type { ModelChoice } from "../../../shared/settings";
import { api } from "../../lib/api";

/** A thread's first message as written for it, with the folders and agent it needs. */
export interface PreparedDraft {
  text: string;
  links: LinkedFolder[];
  provider: AgentProvider;
  choice: ModelChoice;
}

/**
 * The draft of a thread that gets the memes without a picture downloaded:
 * the meme folder linked to write in, on the agent signed in here.
 */
export async function memeSetupDraft(): Promise<PreparedDraft> {
  const [state, accounts] = await Promise.all([
    api.prepareMemes(),
    api.agentAccounts().catch((e) => {
      console.warn("Could not read the agent accounts:", e);
      return undefined;
    }),
  ]);
  const agent = memeAgents[memeSetupAgent(accounts)];
  return {
    text: memeSetupPrompt(state),
    links: [
      {
        path: state.folder,
        access: "write",
        note: "Relay's meme folder: memes.json and one picture per meme",
      },
    ],
    provider: agent.provider,
    choice: agent.choice,
  };
}
