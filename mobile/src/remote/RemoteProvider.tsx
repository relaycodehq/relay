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
import {
  RemoteClient,
  type RemoteStatus,
} from "../../../shared/remote-client";
import type {
  PairingLink,
  RemoteEvent,
  RemoteOverview,
} from "../../../shared/remote";
import {
  clearCredentials,
  loadCredentials,
  saveCredentials,
} from "./credentials";

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
  return constants.Model || (Platform.OS === "ios" ? "iPhone" : "Android phone");
}

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
      const next = new RemoteClient({
        start,
        onStatus: (s, why) => {
          setStatus(s);
          setDetail(why);
          if (s === "online") {
            setName(next.name);
            pairing.current?.resolve();
            pairing.current = undefined;
          } else if (s === "denied" && pairing.current) {
            pairing.current.reject(new Error(why ?? "Relay said no."));
            pairing.current = undefined;
          }
        },
        onPaired: (credentials) => void saveCredentials(credentials),
        onEvent: (event) => {
          if (event.kind === "chats")
            setOverview((o) => o && { ...o, chats: event.chats });
          else
            for (const listener of listeners.current.get(event.chatId) ?? [])
              listener(event);
        },
      });
      setName(next.name);
      // The effect below closes the client this one replaces.
      setClient(next);
      next.start();
      return next;
    },
    [],
  );

  useEffect(() => {
    void loadCredentials().then((saved) => {
      if (saved) connect(saved);
      setReady(true);
    });
  }, [connect]);

  useEffect(() => () => client?.close(), [client]);

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

  useEffect(() => {
    if (status === "online") void refresh().catch(() => {});
  }, [status, refresh]);

  const value = useMemo<Remote>(
    () => ({
      ready,
      paired: !!client,
      status,
      detail,
      name,
      overview,
      refresh,
      call: client
        ? client.call.bind(client)
        : ((() =>
            Promise.reject(
              new Error("Pair with Relay first."),
            )) as RemoteClient["call"]),
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
        await clearCredentials();
      },
      onMessage: (chatId, listener) => {
        const set = listeners.current.get(chatId) ?? new Set();
        set.add(listener);
        listeners.current.set(chatId, set);
        return () => {
          set.delete(listener);
          if (!set.size) listeners.current.delete(chatId);
        };
      },
    }),
    [ready, client, status, detail, name, overview, refresh, connect],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
