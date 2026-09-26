import { useLocalSearchParams } from "expo-router";
import { Thread } from "../../../../screens/Thread";

/** A side conversation: a reply's root and everything under it. */
export default function RepliesScreen() {
  const { id, root } = useLocalSearchParams<{ id: string; root: string }>();
  return <Thread id={id} rootId={root} />;
}
