const HIDDEN_KEY = "relay-agent-switch-notice";

/** The person asked not to see the switch warning again. */
export function agentSwitchNoticeHidden() {
  try {
    return localStorage.getItem(HIDDEN_KEY) === "hidden";
  } catch {
    return false;
  }
}

export function hideAgentSwitchNotice() {
  try {
    localStorage.setItem(HIDDEN_KEY, "hidden");
  } catch {
    // Private mode or blocked storage: the notice simply shows again.
  }
}
