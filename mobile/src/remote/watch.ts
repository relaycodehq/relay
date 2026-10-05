// Following the computer with the app in your pocket. Android's foreground
// service keeps the connection (and read aloud) going with the screen off,
// and a thread that finishes, fails or needs you posts a notification.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { AppRegistry, AppState } from "react-native";
import { requireOptionalNativeModule } from "expo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RemoteChatSummary } from "../../../shared/remote";
import { threadNews, threadsRead, type LastAnswer } from "../../../shared/thread-news";
import { useRemote } from "./RemoteProvider";

/** modules/relay-watch; missing in Expo Go, on iOS, and in APKs from before notifications. */
interface RelayWatch {
  requestPermission(): Promise<{ granted: boolean }>;
  enabled(): boolean;
  /** Throws from the background: Android only lets an app on screen start it. */
  start(title: string, text: string): void;
  update(title: string, text: string): void;
  stop(): void;
  notify(tag: string, title: string, body: string, url: string): void;
  clear(tag: string): void;
}
const native = requireOptionalNativeModule<RelayWatch>("RelayWatch");
export const phoneCanWatch = !!native;

// The task only has to exist: while it runs, React Native keeps timers going
// in the background. The module ends it natively when the service stops.
if (native) AppRegistry.registerHeadlessTask("RelayWatch", () => () => new Promise<void>(() => {}));

type Reason = "watch" | "read";
const notices: Record<Reason, { title: string; text: string }> = {
  watch: { title: "Relay", text: "" },
  read: { title: "Reading aloud", text: "Relay keeps reading with the screen off." },
};
const holding = new Set<Reason>();
let running = false;

function notice() {
  // Reading says so while it lasts; otherwise who the phone follows.
  return notices[holding.has("read") ? "read" : "watch"];
}

/** Keeps the app in the foreground for `reason` until released; a no-op without the module. */
export function hold(reason: Reason, title?: string, text?: string) {
  if (!native) return;
  if (title !== undefined) notices[reason] = { title, text: text ?? "" };
  holding.add(reason);
  const { title: shownTitle, text: shownText } = notice();
  if (running) return native.update(shownTitle, shownText);
  if (AppState.currentState !== "active") return;
  try {
    native.start(shownTitle, shownText);
    running = true;
  } catch {}
}

export function release(reason: Reason) {
  if (!native || !holding.delete(reason) || !running) return;
  if (holding.size) {
    const { title, text } = notice();
    return native.update(title, text);
  }
  running = false;
  native.stop();
}

/** Puts away a thread's notification, once it's open on the phone. */
export const clearThreadNotice = (chatId: string) => native?.clear(chatId);

const prefKey = "relay-notifications";
let notify = true;
let loaded = false;
const listeners = new Set<() => void>();
void AsyncStorage.getItem(prefKey)
  .then((saved) => {
    notify = saved !== "off";
    loaded = true;
    listeners.forEach((l) => l());
  })
  .catch(() => {});

/** Whether threads notify while the app is away; on unless turned off. */
export function useNotifyPreference() {
  const on = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => notify,
  );
  return [on, setNotify] as const;
}

async function setNotify(on: boolean) {
  if (on && native && !(await native.requestPermission()).granted) return false;
  notify = on;
  listeners.forEach((l) => l());
  await AsyncStorage.setItem(prefKey, on ? "on" : "off");
  return true;
}

/** Android 13 asks once; after two refusals it stops showing the prompt by itself. */
const askedKey = "relay-notifications-asked";
async function askOnce() {
  if (!native || native.enabled() || (await AsyncStorage.getItem(askedKey))) return;
  await AsyncStorage.setItem(askedKey, "1");
  await native.requestPermission().catch(() => {});
}

/** Holds the connection in the background and turns thread changes into notifications. */
export function useThreadNotifications() {
  const { status, overview, name, active, paired, onAnyMessage } = useRemote();
  const on = useNotifyPreference()[0];
  const enabled = phoneCanWatch && paired && on && loaded;
  const before = useRef(new Map<string, RemoteChatSummary>());
  const answers = useRef(new Map<string, LastAnswer & { created: number }>());

  useEffect(() => {
    if (!enabled) return;
    void askOnce();
  }, [enabled]);

  // Starts once connected with the app on screen; kept through reconnects so
  // a dropped link can come back in the background.
  const [online, offline] = [status === "online", status === "offline"];
  useEffect(() => {
    if (!enabled) {
      release("watch");
      return;
    }
    const text = online
      ? "Tells you when a thread finishes or needs you."
      : offline
        ? "Reconnecting…"
        : "";
    if (online || running) hold("watch", `Connected to ${name}`, text);
  }, [enabled, online, offline, name]);
  useEffect(() => () => release("watch"), []);

  // Another computer's threads aren't news about this one's.
  useEffect(() => {
    before.current = new Map();
    answers.current = new Map();
  }, [active]);

  useEffect(
    () =>
      onAnyMessage(({ chatId, message: m }) => {
        if (m.role !== "assistant" || m.parentId || m.compaction || m.handoff || m.reload) return;
        const last = answers.current.get(chatId);
        if (last && last.created > m.created) return;
        answers.current.set(chatId, {
          status: m.status,
          body: m.body,
          error: m.error,
          provider: m.provider,
          created: m.created,
        });
      }),
    [onAnyMessage],
  );

  const chats = overview?.chats;
  useEffect(() => {
    if (!chats) return;
    const was = before.current;
    before.current = new Map(chats.map((c) => [c.id, c]));
    if (!native || !enabled || !was.size) return;
    for (const id of threadsRead(was, chats)) native.clear(id);
    // On screen the app shows it already.
    if (AppState.currentState === "active") return;
    for (const news of threadNews(was, chats, answers.current))
      native.notify(news.chatId, news.title, news.body, `relay-remote://chat/${news.chatId}`);
  }, [chats, enabled]);
}
