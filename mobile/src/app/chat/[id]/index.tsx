import { useLocalSearchParams } from "expo-router";
import { Thread } from "../../../screens/Thread";

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Thread id={id} />;
}
