import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { asideNeedsAnswer, relayCommand } from "../../../shared/commands";
import { promptTitle } from "../../../shared/prompt-title";
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
import { availableWhere, madeHere, projectsByUse, startingWhere, type Made, type Where } from "../remote/new-thread";
import {
  sameModel,
  type NewThreadModels,
} from "../../../shared/new-thread-models";
import { Composer, type ComposerHandle, type Outgoing } from "../ui/Composer";
import { focusWithKeyboard, KeyboardAware, useKeyboardShown } from "../ui/KeyboardAware";
import {
  WhereIntro,
  WhereLine,
  WhereSheets,
  type WhereSheet,
} from "../ui/NewThreadWhere";

/**
 * Starts a thread the way the desktop's new-thread composer does, then opens
 * it. The composer has the keyboard from the start, on the project used last;
 * the project and workspace are picked in sheets from the line over it.
 */
export default function NewThread() {
  const { active } = useRemote();
  return <NewThreadComposer key={active} />;
}

function NewThreadComposer() {
  const asked = useLocalSearchParams<{ project?: string; scratch?: string }>();
  const remote = useRemote();
  const { desktop, status, overview, active } = remote;
  const composer = useRef<ComposerHandle>(null);
  // Settled once, so a thread moving on the computer doesn't swap the project under a thumb.
  const [picked, setPicked] = useState<Where | undefined>(() =>
    startingWhere(overview, asked),
  );
  const available = availableWhere(picked, overview, asked);
  if (picked !== available) setPicked(available);
  const projects = projectsByUse(
    overview?.projects ?? [],
    overview?.chats ?? [],
  );
  const chosen = projects.find((p) => p.id === picked);

  // The desktop's New chat: an unused Scratchpad folder, or a fresh one. One
  // ask per screen, shared with a send that comes before its answer; after a
  // failure only a send or a tap asks again, as each ask may make a folder.
  const [scratch, setScratch] = useState<{ id?: string; error?: string }>({});
  const scratchAsk = useRef<Promise<string>>(undefined);
  const askScratch = useCallback(() => {
    scratchAsk.current ??= desktop("createScratch").then(
      (p) => {
        setScratch({ id: p.id });
        return p.id;
      },
      (e: unknown) => {
        scratchAsk.current = undefined;
        const error = e instanceof Error ? e.message : String(e);
        setScratch({ error });
        throw new Error(error);
      },
    );
    return scratchAsk.current;
  }, [desktop]);
  const askedScratch = useRef(false);
  useEffect(() => {
    if (picked !== "scratch" || status !== "online" || askedScratch.current)
      return;
    askedScratch.current = true;
    askScratch().catch(() => {});
  }, [picked, status, askScratch]);
  const projectId = picked === "scratch" ? scratch.id : picked;

  // Each project starts where its settings say; a pick here holds for it.
  const [workspaces, setWorkspaces] = useState<Record<string, ChatWorkspace>>(
    {},
  );
  const workspace =
    (picked && workspaces[picked]) || chosen?.workspace || "checkout";

  // The composer is there at once, on what the computer said last time; its
  // answer replaces that unless a pick here came first.
  const [settings, setSettings] = useState<RemoteSettings>();
  const [models, setModels] = useState<NewThreadModels>({});
  const chose = useRef(false);
  useEffect(() => {
    let live = true;
    void loadNewThread(active).then((saved) => {
      if (!live) return;
      setSettings((s) => s ?? saved?.settings ?? newThreadSettings(undefined));
      if (saved) setModels((m) => (Object.keys(m).length ? m : saved.models));
    });
    return () => { live = false; };
  }, [active]);
  const askedDesktop = useRef(false);
  useEffect(() => {
    // Offline, each of its calls would fall back to a default.
    if (status !== "online" || askedDesktop.current) return;
    askedDesktop.current = true;
    let live = true;
    void desktopNewThread(desktop).then((s) => {
      if (!live) return;
      if (!chose.current) setSettings(s.settings);
      setModels(s.models);
      saveNewThread(s, active);
    });
    return () => {
      live = false;
      askedDesktop.current = false;
    };
  }, [desktop, status, active]);

  const focused = useRef(false);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    return () => { focused.current = false; };
  }, []));

  // A sheet takes the keyboard's room; it comes back after if it was up.
  const keyboard = useKeyboardShown();
  const [sheet, setSheet] = useState<WhereSheet>();
  const typing = useRef(false);
  const openSheet = (next: WhereSheet) => {
    typing.current = keyboard;
    Keyboard.dismiss();
    setSheet(next);
  };
  const closeSheet = () => {
    setSheet(undefined);
  };
  const restoreFocus = () => {
    const resume = typing.current;
    typing.current = false;
    const input = composer.current;
    if (resume && focused.current && input) focusWithKeyboard(input);
  };

  // A thread made for a scheduled message that then failed to go, used again on the next try.
  const made = useRef<{ key: string; chat: Made }>(undefined);
  const start = async ({ id: messageId, body, settings: using, images, sendAt }: Outgoing) => {
    if (relayCommand(body)?.name === "btw") throw new Error(asideNeedsAnswer);
    if (!picked)
      throw new Error("Wait for your computer to list its projects.");
    const where = picked === "scratch" ? await askScratch() : picked;
    const space = !chosen || chosen.plain ? undefined : workspace;
    const key = `${where}:${space ?? ""}`;
    const chat =
      made.current?.key === key
        ? made.current.chat
        : await desktop("createProjectChat", where, { kind: "project" }, space);
    const chatId = chat.id;
    made.current = { key, chat };
    const message = composeSend(using, body, {
      id: messageId,
      ...(sendAt ? { sendAt } : {}),
      images: images.map(({ name, mimeType, dataUrl }) => ({
        name,
        mimeType,
        dataUrl,
      })),
    });
    // A scheduled message goes to the desktop's queue, which the thread
    // shows; through the outbox it would also sit there as a pending send.
    // A plain one follows the thread, as making a worktree or carrying
    // images over a slow link can take a while.
    if (sendAt) await desktop("sendProjectChat", chatId, message);
    else deliver(desktop, remote.active ?? "", chatId, message);
    made.current = undefined;
    // Titled as the desktop titles it once the message is in.
    madeHere({ ...chat, title: sendAt ? chat.title : promptTitle(message.body) });
    void remote.refresh().catch(() => {});
    if (!focused.current) return;
    // Put away before the composer goes: beside the list, Android would hand
    // the keyboard to the list's search field, and the thread's composer
    // would open under it.
    Keyboard.dismiss();
    router.replace(`/chat/${chatId}`);
  };

  return (
    <KeyboardAware>
      <WhereIntro
        project={chosen}
        picked={picked}
        workspace={workspace}
        scratchError={picked === "scratch" ? scratch.error : undefined}
        onOpen={openSheet}
        onRetryScratch={() => void askScratch().catch(() => {})}
      />
      {settings && (
        <Composer
          ref={composer}
          autoFocus
          above={
            <WhereLine
              project={chosen}
              picked={picked}
              workspace={workspace}
              onOpen={openSheet}
            />
          }
          projectId={projectId ?? ""}
          sendTarget={`${picked ?? ""}:${workspace}`}
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
          disabled={status !== "online"}
          placeholder={
            picked === "scratch" ? "Ask anything" : "What should we work on?"
          }
          onSend={start}
          draftKey="new-thread"
          remembered={models}
        />
      )}
      <WhereSheets
        open={sheet}
        projects={projects}
        picked={picked}
        workspace={workspace}
        onPick={setPicked}
        onWorkspace={(next) => {
          if (picked) setWorkspaces((all) => ({ ...all, [picked]: next }));
        }}
        onClose={closeSheet}
        onDismiss={restoreFocus}
      />
    </KeyboardAware>
  );
}
