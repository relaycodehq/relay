import { useLocalSearchParams } from "expo-router";
import { SubagentRun } from "../../../../screens/SubagentRun";

/** One of the thread's subagents: its brief, its run and what it reported. */
export default function SubagentScreen() {
  const { id, agent, root } = useLocalSearchParams<{
    id: string;
    agent: string;
    root?: string;
  }>();
  return <SubagentRun chatId={id} agentId={agent} root={root} />;
}
