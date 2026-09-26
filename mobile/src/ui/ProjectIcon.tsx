import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Folder, NotebookPen } from "lucide-react-native";
import type { RemoteProject } from "../../../shared/remote";
import { useProjectIcon } from "../remote/project-icons";
import { useTheme } from "./theme";

/** The project's own icon, as the desktop's sidebar shows it; its folder otherwise. */
export function ProjectIcon({
  project,
  size = 17,
}: {
  project: Pick<RemoteProject, "id" | "scratch">;
  size?: number;
}) {
  const t = useTheme();
  const uri = useProjectIcon(project.id);
  // An icon the phone can't draw (some SVGs) falls back like a missing one.
  const [broken, setBroken] = useState<string>();
  if (project.scratch) return <NotebookPen size={size} color={t.muted} />;
  if (uri && uri !== broken)
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: 4 }}
        contentFit="contain"
        cachePolicy="memory"
        accessible={false}
        onError={() => setBroken(uri)}
      />
    );
  return <Folder size={size} color={t.muted} />;
}

/** Stable hue per project, as the desktop's cards pick it. */
function projectHue(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

/** The desktop's card badge: the project's icon, else its initial on its colour. */
export function ProjectBadge({
  project,
  size = 16,
}: {
  project: Pick<RemoteProject, "id" | "name">;
  size?: number;
}) {
  const uri = useProjectIcon(project.id);
  const [broken, setBroken] = useState<string>();
  const box = { width: size, height: size, borderRadius: size * 0.3 };
  if (uri && uri !== broken)
    return (
      <Image
        source={{ uri }}
        style={box}
        contentFit="contain"
        cachePolicy="memory"
        accessible={false}
        onError={() => setBroken(uri)}
      />
    );
  const hue = projectHue(project.name);
  return (
    <View
      style={[
        box,
        styles.letterBox,
        { backgroundColor: `hsl(${hue}, 45%, 48%)` },
      ]}
    >
      <Text
        style={[
          styles.letter,
          { fontSize: size * 0.6, color: `hsl(${hue}, 55%, 96%)` },
        ]}
      >
        {project.name.slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  letterBox: { alignItems: "center", justifyContent: "center" },
  letter: { fontWeight: "700" },
});
