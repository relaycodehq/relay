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
  type RemoteEvent,
  type RemoteOverview,
} from "../../../shared/remote";
import {
  clearCredentials,
  loadCredentials,
  saveCredentials,
} from "./credentials";
import { forgetOffline, loadOverview, saveOverview } from "./offline";

type MessageEvent = Extract<RemoteEvent, { kind: "message" }>;

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
  /** The desktop runs an older bridge than this app needs; a restart of Relay updates it. */
  outdated: boolean;
  pair(link: PairingLink): Promise<void>;
  forget(): Promise<void>;
  onMessage(chatId: string, listener: (e: MessageEvent) => void): () => void;
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

export function RemoteProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [client, setClient] = useState<RemoteClient>();
  const [status, setStatus] = useState<RemoteStatus>("offline");
  const [detail, setDetail] = useState<string>();
  const [name, setName] = useState("Relay");
  const [overview, setOverview] = useState<RemoteOverview>();
  const listeners = useRef(new Map<string, Set<(e: MessageEvent) => void>>());
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
        onPaired: (credentials) => void saveCredentials(credentials),
        onEvent: (event) => {
          if (!current()) return;
          if (event.kind === "chats")
            setOverview((o) => o && { ...o, chats: event.chats });
          else if (event.kind === "appearance")
            setOverview((o) => o && { ...o, appearance: event.appearance });
          else
            for (const listener of listeners.current.get(event.chatId) ?? [])
              listener(event);
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

  useEffect(() => {
    void loadCredentials().then((saved) => {
      if (saved) {
        // Last seen lists to read while it connects, or can't; never a wait.
        void loadOverview().then(
          (cached) => cached && setOverview((live) => live ?? cached),
        );
        connect(saved);
      }
      setReady(true);
    });
  }, [connect]);

  useEffect(() => {
    if (overview) saveOverview(overview);
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
    setOverview(await client.call("overview"));
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
      pair: (link) =>
        new Promise<void>((resolve, reject) => {
          pairing.current = { resolve, reject };
          setOverview(undefined);
          connect({ link, device: deviceName() });
        }).catch(async (e) => {
          // A failed pairing leaves the phone as it was.
          const saved = await loadCredentials();
          if (saved) connect(saved);
          else setClient(undefined);
          throw e;
        }),
      forget: async () => {
        client?.close();
        setClient(undefined);
        setOverview(undefined);
        setStatus("offline");
        forgetOffline();
        await clearCredentials();
      },
      onMessage,
    }),
    [
      ready,
      client,
      status,
      detail,
      name,
      overview,
      refresh,
      connect,
      call,
      desktop,
      onMessage,
    ],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
