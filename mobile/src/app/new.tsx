import { useEffect, useRef, useState } from "react";
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { randomUUID } from "expo-crypto";
import { asideNeedsAnswer, relayCommand } from "../../../shared/commands";
import type { ChatWorkspace } from "../../../shared/projects";
import type { RemoteSettings } from "../../../shared/remote";
import { useRemote } from "../remote/RemoteProvider";
import {
  composeSend,
  desktopNewThread,
  newThreadSettings,
} from "../../../shared/remote-compose";
import { loadNewThread, saveNewThread } from "../remote/offline";
import { deliver } from "../remote/outbox";
import {
  sameModel,
  type NewThreadModels,
} from "../../../shared/new-thread-models";
import { NotebookPen } from "lucide-react-native";
import { Composer, type Outgoing } from "../ui/Composer";
import { ProjectIcon } from "../ui/ProjectIcon";
import { KeyboardAware } from "../ui/KeyboardAware";
import { Segmented } from "../ui/Rows";
import { type, useTheme } from "../ui/theme";

/** Starts a thread the way the desktop's new-thread composer does, then opens it. */
export default function NewThread() {
  const { project, scratch } = useLocalSearchParams<{
    project?: string;
    scratch?: string;
  }>();
  const remote = useRemote();
  const t = useTheme();
  const overview = remote.overview;
  const real = overview?.projects.filter((p) => !p.scratch) ?? [];
  const last = overview?.chats[0]?.projectId;
  const [picked, setPicked] = useState<string | "scratch" | undefined>(() =>
    scratch
      ? "scratch"
      : (project ??
        (real.some((p) => p.id === last) ? last : real[0]?.id) ??
        "scratch"),
  );
  // The desktop's New chat: an unused Scratchpad folder, or a fresh one.
  const [scratchId, setScratchId] = useState<string>();
  const [scratchError, setScratchError] = useState<string>();
  useEffect(() => {
    if (picked !== "scratch" || scratchId || remote.status !== "online") return;
    remote
      .desktop("createScratch")
      .then((p) => setScratchId(p.id))
      .catch((e) =>
        setScratchError(e instanceof Error ? e.message : String(e)),
      );
  }, [picked, scratchId, remote]);
  const projectId = picked === "scratch" ? scratchId : picked;
  const chosen = real.find((p) => p.id === picked);
  // Each project starts where its settings say; a pick here holds for it.
  const [workspaces, setWorkspaces] = useState<Record<string, ChatWorkspace>>(
    {},
  );
  const workspace =
    (picked && workspaces[picked]) || chosen?.workspace || "checkout";
  const setWorkspace = (next: ChatWorkspace) => {
    if (picked) setWorkspaces((all) => ({ ...all, [picked]: next }));
  };
  // The composer is there at once, on what the computer said last time; its
  // answer replaces that unless a pick here came first.
  const [settings, setSettings] = useState<RemoteSettings>();
  const [models, setModels] = useState<NewThreadModels>({});
  const chose = useRef(false);
  const { desktop, status } = remote;
  useEffect(() => {
    void loadNewThread().then((saved) => {
      setSettings((s) => s ?? saved?.settings ?? newThreadSettings(undefined));
      if (saved) setModels((m) => (Object.keys(m).length ? m : saved.models));
    });
  }, []);
  const asked = useRef(false);
  useEffect(() => {
    // Offline, each of its calls would fall back to a default.
    if (status !== "online" || asked.current) return;
    asked.current = true;
    void desktopNewThread(desktop).then((s) => {
      if (!chose.current) setSettings(s.settings);
      setModels(s.models);
      saveNewThread(s);
    });
  }, [desktop, status]);
  const start = async ({ body, settings: using, images, sendAt }: Outgoing) => {
    if (relayCommand(body)?.name === "btw") throw new Error(asideNeedsAnswer);
    const where =
      projectId ??
      (picked === "scratch"
        ? (await remote.desktop("createScratch")).id
        : undefined);
    if (!where) throw new Error("Pick a project first.");
    const chat = await remote.desktop(
      "createProjectChat",
      where,
      { kind: "project" },
      !chosen || chosen.plain ? undefined : workspace,
    );
    // The thread opens now; the message follows it there, as making a
    // worktree or carrying images over a slow link can take a while.
    deliver(
      remote.desktop,
      remote.active ?? "",
      chat.id,
      composeSend(using, body, {
        id: randomUUID(),
        ...(sendAt ? { sendAt } : {}),
        images: images.map(({ name, mimeType, dataUrl }) => ({
          name,
          mimeType,
          dataUrl,
        })),
      }),
    );
    void remote.refresh();
    router.replace(`/chat/${chat.id}`);
  };
  const choice = (on: boolean) => [
    styles.choice,
    { borderColor: on ? t.accent : t.border },
    on && { backgroundColor: t.accentSoft },
  ];
  return (
    <KeyboardAware>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onTouchStart={Keyboard.dismiss}
      >
        <Text style={[styles.label, { color: t.muted }]}>Where</Text>
        <View style={styles.group}>
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: picked === "scratch" }}
            onPress={() => setPicked("scratch")}
            style={choice(picked === "scratch")}
          >
            <View style={styles.choiceRow}>
              <NotebookPen size={17} color={t.muted} />
              <View style={styles.choiceBody}>
                <Text style={[styles.choiceText, { color: t.text }]}>
                  Scratchpad
                </Text>
                <Text style={[styles.hint, { color: t.muted }]}>
                  {scratchError ?? "A chat of its own, outside your projects"}
                </Text>
              </View>
            </View>
          </Pressable>
          {real.map((p) => (
            <Pressable
              key={p.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: p.id === picked }}
              onPress={() => setPicked(p.id)}
              style={choice(p.id === picked)}
            >
              <View style={styles.choiceRow}>
                <ProjectIcon project={p} />
                <View style={styles.choiceBody}>
                  <Text style={[styles.choiceText, { color: t.text }]}>
                    {p.name}
                  </Text>
                  {p.folder && (
                    <Text style={[styles.hint, { color: t.muted }]}>
                      {p.folder}
                    </Text>
                  )}
                </View>
              </View>
            </Pressable>
          ))}
        </View>
        {chosen && !chosen.plain && (
          <>
            <Text style={[styles.label, { color: t.muted }]}>
              Where it works
            </Text>
            <Segmented
              value={workspace}
              onChange={setWorkspace}
              options={[
                { value: "checkout", label: "Project folder" },
                { value: "worktree", label: "Its own worktree" },
              ]}
            />
            <Text style={[styles.hint, { color: t.muted }]}>
              {workspace === "worktree"
                ? "A branch and folder of its own, made from the checkout with the first message. Your checkout stays as it is."
                : "Works in the checkout, on whatever branch it has."}
            </Text>
          </>
        )}
      </ScrollView>
      {settings && (
        <Composer
          projectId={projectId ?? ""}
          settings={settings}
          onSettings={(s) => {
            // The next new thread, here or on the desktop, starts on it too.
            if (s.provider !== settings.provider)
              void desktop("saveNewThreadAgent", s.provider).catch(() => {});
            else if (!sameModel(s, settings))
              void desktop("saveNewThreadModel", s.provider, {
                choice: s.choice,
                ...(s.contextWindow ? { contextWindow: s.contextWindow } : {}),
              }).catch(() => {});
            chose.current = true;
            setSettings(s);
          }}
          running={false}
          disabled={remote.status !== "online"}
          placeholder={
            picked === "scratch" ? "Ask anything" : "What should we work on?"
          }
          onSend={start}
          draftKey="new-thread"
          remembered={models}
        />
      )}
    </KeyboardAware>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10, paddingBottom: 16 },
  label: { fontSize: type.tiny, fontWeight: "600", marginTop: 8 },
  group: { gap: 8 },
  choice: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 3,
  },
  choiceRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  choiceBody: { flex: 1, gap: 3 },
  choiceText: { fontSize: type.body },
  hint: { fontSize: type.tiny, lineHeight: 17 },
});
