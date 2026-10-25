import { readText, writeText } from "../../lib/persisted-store";
const HIDDEN_KEY = "relay-agent-switch-notice";

/** The person asked not to see the switch warning again. */
export function agentSwitchNoticeHidden() {
  return readText(HIDDEN_KEY) === "hidden";
}

export function hideAgentSwitchNotice() {
  writeText(HIDDEN_KEY, "hidden");
}
