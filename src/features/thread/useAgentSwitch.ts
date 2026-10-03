import { useState } from "react";
import type { AgentProvider } from "../../../shared/projects";
import { takesOver } from "../../../shared/recipient";
import { agentSwitchNoticeHidden } from "../composer/agent-switch-notice";

/** Taking over from the agent holding the thread's context loses its session: say so first. */
export function useAgentSwitch(active: AgentProvider | undefined) {
  const [asking, setAsking] = useState<{
    from: AgentProvider;
    to: AgentProvider;
    resolve: (proceed: boolean) => void;
  }>();
  /** Resolves to whether to go on with `to`; asks only when it takes over. */
  async function confirm(to: AgentProvider | undefined) {
    return (
      !takesOver(to, active) ||
      !active ||
      agentSwitchNoticeHidden() ||
      new Promise<boolean>((resolve) =>
        setAsking({ from: active, to, resolve }),
      )
    );
  }
  return {
    /** The switch waiting on an answer, while the dialog shows. */
    asking,
    confirm,
    decide(proceed: boolean) {
      setAsking(undefined);
      asking?.resolve(proceed);
    },
  };
}
