import { Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronDown, FolderGit2, GitBranch, NotebookPen } from "lucide-react-native";
import type { ChatWorkspace } from "../../../shared/projects";
import type { RemoteProject } from "../../../shared/remote";
import type { Where } from "../remote/new-thread";
import { ProjectIcon } from "./ProjectIcon";
import { MenuSheet } from "./Sheet";
import { type, useTheme } from "./theme";

export type WhereSheet = "project" | "workspace";

const workspaces: { value: ChatWorkspace; label: string; hint: string }[] = [
  {
    value: "checkout",
    label: "Project folder",
    hint: "Works in the checkout, on whatever branch it has.",
  },
  {
    value: "worktree",
    label: "Its own worktree",
    hint: "A branch and folder of its own, made from the checkout with the first message. Your checkout stays as it is.",
  },
];
const scratchHint = "A chat of its own, outside your projects";

/**
 * Over a new thread's composer, in reach of the thumb: the project it starts
 * in and, for a Git project, where it works. Each opens a sheet, so choosing
 * never needs the keyboard or competes with it for room.
 */
export function WhereLine({
  project,
  picked,
  workspace,
  onOpen,
}: {
  project?: RemoteProject;
  picked?: Where;
  workspace: ChatWorkspace;
  onOpen: (sheet: WhereSheet) => void;
}) {
  const t = useTheme();
  const name = picked === "scratch" ? "Scratchpad" : (project?.name ?? "Projects…");
  return (
    <View style={styles.line}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Project: ${name}`}
        accessibilityHint="Choose where the thread starts"
        hitSlop={{ top: 6, bottom: 4 }}
        onPress={() => onOpen("project")}
        style={({ pressed }) => [styles.target, styles.project, pressed && { backgroundColor: t.hover }]}
      >
        {picked === "scratch" ? (
          <NotebookPen size={15} color={t.muted} />
        ) : project ? (
          <ProjectIcon project={project} size={15} />
        ) : null}
        <Text numberOfLines={1} style={[styles.name, { color: t.text }]}>
          {name}
        </Text>
        <ChevronDown size={13} color={t.faint} />
      </Pressable>
      {project && !project.plain && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Works in: ${workspaceLabel(workspace)}`}
          hitSlop={{ top: 6, bottom: 4 }}
          onPress={() => onOpen("workspace")}
          style={({ pressed }) => [styles.target, pressed && { backgroundColor: t.hover }]}
        >
          {workspace === "worktree" ? (
            <GitBranch size={14} color={t.muted} />
          ) : (
            <FolderGit2 size={14} color={t.muted} />
          )}
          <Text numberOfLines={1} style={[styles.small, { color: t.muted }]}>
            {workspace === "worktree" ? "Own worktree" : "Project folder"}
          </Text>
          <ChevronDown size={12} color={t.faint} />
        </Pressable>
      )}
    </View>
  );
}

/** What the picks above mean, in the room the keyboard leaves; tapping it changes the project. */
export function WhereIntro({
  project,
  picked,
  workspace,
  scratchError,
  onOpen,
  onRetryScratch,
}: {
  project?: RemoteProject;
  picked?: Where;
  workspace: ChatWorkspace;
  scratchError?: string;
  onOpen: (sheet: WhereSheet) => void;
  onRetryScratch: () => void;
}) {
  const t = useTheme();
  if (!picked) return null;
  const scratch = picked === "scratch";
  const failed = scratch && !!scratchError;
  const hint = scratch
    ? (scratchError ?? scratchHint)
    : project?.plain
      ? undefined
      : workspaces.find((w) => w.value === workspace)?.hint;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={failed ? "Asks your computer again" : "Choose where the thread starts"}
      onPress={failed ? onRetryScratch : () => onOpen("project")}
      style={styles.intro}
    >
      {scratch ? (
        <NotebookPen size={28} color={t.muted} />
      ) : project ? (
        <ProjectIcon project={project} size={28} />
      ) : null}
      <Text numberOfLines={1} style={[styles.introTitle, { color: t.text }]}>
        {scratch ? "Scratchpad" : project?.name}
      </Text>
      {!scratch && !!project?.folder && (
        <Text numberOfLines={1} style={[styles.small, { color: t.faint }]}>
          {project.folder}
        </Text>
      )}
      {!!hint && (
        <Text style={[styles.introHint, { color: failed ? t.danger : t.muted }]}>
          {failed ? `${hint} Tap to try again.` : hint}
        </Text>
      )}
    </Pressable>
  );
}

/** The project list and the workspace choice, as sheets over the screen. */
export function WhereSheets({
  open,
  projects,
  picked,
  workspace,
  onPick,
  onWorkspace,
  onClose,
}: {
  open?: WhereSheet;
  projects: RemoteProject[];
  picked?: Where;
  workspace: ChatWorkspace;
  onPick: (where: Where) => void;
  onWorkspace: (workspace: ChatWorkspace) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  return (
    <>
      <MenuSheet
        open={open === "project"}
        title="Start in"
        onClose={onClose}
        items={[
          {
            label: "Scratchpad",
            hint: scratchHint,
            icon: <NotebookPen size={17} color={t.muted} />,
            checked: picked === "scratch",
            onPress: () => onPick("scratch"),
          },
          ...projects.map((p) => ({
            label: p.name,
            hint: p.folder,
            icon: <ProjectIcon project={p} />,
            checked: p.id === picked,
            onPress: () => onPick(p.id),
          })),
        ]}
      />
      <MenuSheet
        open={open === "workspace"}
        title="Where it works"
        onClose={onClose}
        items={workspaces.map((w) => ({
          label: w.label,
          hint: w.hint,
          icon:
            w.value === "worktree" ? (
              <GitBranch size={17} color={t.muted} />
            ) : (
              <FolderGit2 size={17} color={t.muted} />
            ),
          checked: w.value === workspace,
          onPress: () => onWorkspace(w.value),
        }))}
      />
    </>
  );
}

const workspaceLabel = (w: ChatWorkspace) => workspaces.find((o) => o.value === w)?.label ?? w;

const styles = StyleSheet.create({
  line: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 2 },
  target: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 34,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  project: { flexShrink: 1 },
  name: { fontSize: type.small, fontWeight: "600", flexShrink: 1 },
  small: { fontSize: type.tiny },
  intro: {
    flex: 1,
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 32,
    paddingBottom: 20,
    overflow: "hidden",
  },
  introTitle: { fontSize: type.title, fontWeight: "600", marginTop: 4 },
  introHint: { fontSize: type.small, lineHeight: 19, textAlign: "center", marginTop: 4 },
});
