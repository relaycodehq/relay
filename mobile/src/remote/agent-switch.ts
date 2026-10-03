import { Alert } from "react-native";
import { agentName, type AgentProvider } from "../../../shared/agents";
import { takesOver } from "../../../shared/recipient";

/**
 * The desktop's switch warning: another agent taking over from the one holding
 * the thread's context loses its session. Resolves to whether to go on.
 */
export function confirmAgentSwitch(
  to: AgentProvider | undefined,
  holder: AgentProvider | undefined,
): Promise<boolean> {
  if (!takesOver(to, holder) || !holder) return Promise.resolve(true);
  const from = agentName(holder);
  const next = agentName(to);
  return new Promise((resolve) =>
    Alert.alert(
      `Switch to ${next}?`,
      `${from} has been working in this thread. ${next} cannot see its session, tool results, or the files it read.\n\n${from} will write a handoff note first. ${next} continues from that note and the recent messages, so expect some context to be lost.`,
      [
        { text: `Keep ${from}`, style: "cancel", onPress: () => resolve(false) },
        { text: `Switch to ${next}`, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}
