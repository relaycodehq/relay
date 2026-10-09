import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, Platform } from "react-native";
import { RemoteClient, type RemoteStatus } from "../../../shared/remote-client";
import {
  remoteBridgeVersion,
  type PairingLink,
  type RemoteCredentials,
  type RemoteEvent,
  type RemoteOverview,
} from "../../../shared/remote";
import { newerVersion } from "../../../shared/phone-app";
import {
  clearCredentials,
  loadPaired,
  savePaired,
  saveCredentials,
} from "./credentials";
import { cameBack } from "./computer-update";
import { newModelConnection } from "./model-catalogs";
import {
  dropLooseCopy,
  forgetOffline,
  loadOverview,
  saveOverview,
  setOfflineComputer,
} from "./offline";
import { runningVersion } from "./self-update";

type MessageEvent = Extract<RemoteEvent, { kind: "message" }>;

/** A paired computer, by its bridge's public key. */
export interface PairedComputer {
  id: string;
  name: string;
}

interface Remote {
  /** Saved credentials have been read. */
  ready: boolean;
  paired: boolean;
  status: RemoteStatus;
  detail?: string;
  /** The computer's name. */
  name: string;
  overview?: RemoteOverview;
  refresh(): Promise<void>;
  call: RemoteClient["call"];
  /** The desktop's own calls on the phone's allowlist. */
  desktop: RemoteClient["desktop"];
  /** The desktop runs an older bridge than this app needs. */
  outdated: boolean;
  /** The desktop runs an older Relay than this app. */
  behind: boolean;
  /** Every paired computer, in pairing order; the phone talks to one at a time. */
  computers: PairedComputer[];
  /** The one it talks to. */
  active?: string;
  switchTo(id: string): Promise<void>;
  /** Pairs another computer, or the same one again, and switches to it. */
  pair(link: PairingLink): Promise<void>;
  /** Forgets one computer, the active one by default, and moves on to the next. */
  forget(id?: string): Promise<void>;
  onMessage(chatId: string, listener: (e: MessageEvent) => void): () => void;
  /** Every thread's message events, e.g. to tell of finished answers. */
  onAnyMessage(listener: (e: MessageEvent) => void): () => void;
}

const Context = createContext<Remote | null>(null);

export function useRemote() {
  const remote = useContext(Context);
  if (!remote) throw new Error("useRemote outside RemoteProvider");
  return remote;
}

/** "Pixel 7", or the platform when the model isn't known. */
function deviceName() {
  const constants = Platform.constants as { Model?: string };
  return (
    constants.Model || (Platform.OS === "ios" ? "iPhone" : "Android phone")
  );
}

/**
 * The one live connection. It sits outside React so that a provider replaced
 * during development (a fast refresh) closes its client instead of leaving it
 * connected beside the new one, reporting a status that isn't true any more.
 */
const live = globalThis as typeof globalThis & { relayClient?: RemoteClient };
const pairingTimeout = 15_000;

export function RemoteProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [client, setClient] = useState<RemoteClient>();
  const [status, setStatus] = useState<RemoteStatus>("offline");
  const [detail, setDetail] = useState<string>();
  const [name, setName] = useState("Relay");
  const [overview, setOverview] = useState<RemoteOverview>();
  const [saved, setSaved] = useState<RemoteCredentials[]>([]);
  // Set before anything of the next computer arrives, so nothing of it is
  // saved as the last one's.
  const active = useRef<string>(undefined);
  const [activeId, setActiveId] = useState<string>();
  const listeners = useRef(new Map<string, Set<(e: MessageEvent) => void>>());
  const everyMessage = useRef(new Set<(e: MessageEvent) => void>());
  const pairing = useRef<{
    resolve: () => void;
    reject: (e: Error) => void;
  }>(undefined);

  const connect = useCallback(
    (start: ConstructorParameters<typeof RemoteClient>[0]["start"]) => {
      const current = () => live.relayClient === next;
      const next: RemoteClient = new RemoteClient({
        start,
        onStatus: (s, why) => {
          // A replaced client's last words don't describe this connection.
          if (!current()) return;
          setStatus(s);
          setDetail(why);
          if (s === "online") {
            newModelConnection();
            setName(next.name);
            pairing.current?.resolve();
            pairing.current = undefined;
            // Every (re)connect starts from a fresh overview.
            void next
              .call("overview")
              .then((o) => current() && setOverview(o))
              .catch(() => {});
          } else if (s === "denied" && pairing.current) {
            pairing.current.reject(new Error(why ?? "Relay said no."));
            pairing.current = undefined;
          }
        },
        onPaired: (credentials) => {
          if (!current()) return;
          void saveCredentials(credentials);
          setSaved((list) => [
            ...list.filter((c) => c.key !== credentials.key),
            credentials,
          ]);
        },
        onEvent: (event) => {
          if (!current()) return;
          if (event.kind === "chats")
            setOverview((o) => o && { ...o, chats: event.chats });
          else if (event.kind === "appearance")
            setOverview((o) => o && { ...o, appearance: event.appearance });
          else {
            for (const listener of listeners.current.get(event.chatId) ?? [])
              listener(event);
            for (const listener of everyMessage.current) listener(event);
          }
        },
      });
      const previous = live.relayClient;
      live.relayClient = next;
      previous?.close();
      setName(next.name);
      setClient(next);
      next.start();
      return next;
    },
    [],
  );

  /** Talks to this computer from now on, showing its last seen lists while it connects. */
  const attach = useCallback(
    async (
      id: string,
      start: ConstructorParameters<typeof RemoteClient>[0]["start"],
    ) => {
      // Last seen lists to read while it connects, or can't; never a wait.
      const cached = await loadOverview(id);
      // Retire in-flight model requests before changing the offline folder.
      newModelConnection();
      active.current = id;
      setActiveId(id);
      setOfflineComputer(id);
      setOverview(cached);
      connect(start);
    },
    [connect],
  );

  useEffect(() => {
    void loadPaired().then(async ({ paired, computers }) => {
      dropLooseCopy();
      setSaved(computers);
      const start = computers.find((c) => c.key === paired.active);
      if (start) await attach(start.key, start);
      setReady(true);
    });
  }, [attach]);

  // Kept to the list and the active one as they change, once read.
  useEffect(() => {
    if (!ready) return;
    const current = saved.find((c) => c.key === activeId);
    void savePaired(
      { ids: saved.map((c) => c.key), active: current?.key },
      current,
    );
  }, [ready, saved, activeId]);

  useEffect(() => {
    if (overview && active.current) {
      saveOverview(active.current, overview);
      cameBack(active.current, overview.version);
    }
  }, [overview]);

  // The client this one replaced is closed in connect(); this is for leaving.
  useEffect(
    () => () => {
      if (live.relayClient === client) {
        client?.close();
        live.relayClient = undefined;
      }
    },
    [client],
  );

  // Android drops sockets in the background; coming back reconnects at once.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") client?.wake();
    });
    return () => sub.remove();
  }, [client]);

  const refresh = useCallback(async () => {
    if (!client || client.status !== "online") return;
    const fresh = await client.call("overview");
    // Switched away while it came.
    if (live.relayClient === client) setOverview(fresh);
  }, [client]);

  // Stable for a connection, so screens fetch again on reconnects rather than
  // on every thread update.
  const call = useMemo(
    () =>
      client
        ? client.call.bind(client)
        : ((() =>
            Promise.reject(
              new Error("Pair with Relay first."),
            )) as RemoteClient["call"]),
    [client],
  );
  const desktop = useMemo(
    () =>
      client
        ? client.desktop.bind(client)
        : ((() =>
            Promise.reject(
              new Error("Pair with Relay first."),
            )) as RemoteClient["desktop"]),
    [client],
  );
  const onMessage = useCallback<Remote["onMessage"]>((chatId, listener) => {
    const set = listeners.current.get(chatId) ?? new Set();
    set.add(listener);
    listeners.current.set(chatId, set);
    return () => {
      set.delete(listener);
      if (!set.size) listeners.current.delete(chatId);
    };
  }, []);

  const onAnyMessage = useCallback<Remote["onAnyMessage"]>((listener) => {
    everyMessage.current.add(listener);
    return () => void everyMessage.current.delete(listener);
  }, []);

  const switchTo = useCallback(
    async (id: string) => {
      const credentials = saved.find((c) => c.key === id);
      if (credentials && id !== active.current) await attach(id, credentials);
    },
    [saved, attach],
  );

  const value = useMemo<Remote>(
    () => ({
      ready,
      paired: !!client,
      status,
      detail,
      name,
      overview,
      refresh,
      call,
      desktop,
      outdated: !!overview && (overview.bridge ?? 1) < remoteBridgeVersion,
      behind:
        !!overview?.version && newerVersion(runningVersion, overview.version),
      computers: saved.map((c) => ({ id: c.key, name: c.name })),
      active: activeId,
      switchTo,
      pair: (link) =>
        new Promise<void>((resolve, reject) => {
          // An unreachable computer never answers; the client would retry forever.
          const timer = setTimeout(() => {
            pairing.current = undefined;
            reject(
              new Error(
                `Couldn't reach ${link.name} at ${link.hosts.join(" or ")}:${link.port}. ` +
                  "Check that Relay is open there and the phone is on the same network, or both on Tailscale.",
              ),
            );
          }, pairingTimeout);
          pairing.current = {
            resolve: () => (clearTimeout(timer), resolve()),
            reject: (e) => (clearTimeout(timer), reject(e)),
          };
          void attach(link.key, { link, device: deviceName() });
        }).catch(async (e) => {
          // A failed pairing leaves the phone as it was.
          const before = saved.find((c) => c.key === activeId);
          if (before) await attach(before.key, before);
          else {
            active.current = undefined;
            setActiveId(undefined);
            setOverview(undefined);
            live.relayClient?.close();
            live.relayClient = undefined;
            setClient(undefined);
          }
          throw e;
        }),
      forget: async (id = activeId) => {
        if (!id) return;
        const rest = saved.filter((c) => c.key !== id);
        setSaved(rest);
        if (id === activeId) {
          const next = rest[0];
          if (next) await attach(next.key, next);
          else {
            active.current = undefined;
            setActiveId(undefined);
            client?.close();
            setClient(undefined);
            setOverview(undefined);
            setStatus("offline");
          }
        }
        forgetOffline(id);
        await clearCredentials(id);
      },
      onMessage,
      onAnyMessage,
    }),
    [
      ready,
      client,
      status,
      detail,
      name,
      overview,
      refresh,
      saved,
      activeId,
      attach,
      switchTo,
      call,
      desktop,
      onMessage,
      onAnyMessage,
    ],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
