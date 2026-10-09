// The agents' model lists, held for the whole connection like the desktop's
// query cache instead of asked again by every thread's composer.
import type { AgentProvider } from "../../../shared/agents";
import type { ModelCatalogs } from "../../../shared/composer-commands";
import type { RemoteClient } from "../../../shared/remote-client";
import { loadModels, saveModels } from "./offline";

type Desktop = RemoteClient["desktop"];
type Held = {
  lists: ModelCatalogs;
  asking: Map<AgentProvider, Promise<void>>;
  /** The last lists saved for this computer, until the connection's own arrive. */
  saved: ModelCatalogs;
  read: Promise<void>;
  connection: number;
};
// `desktop` lasts as long as its client, which reconnects by itself, so the
// lists are dropped per connection rather than per `desktop`.
const held = new WeakMap<Desktop, Held>();
let connection = 0;

/** A (re)connect: the lists are asked again, so models a CLI update brought show up. */
export function newModelConnection() {
  connection++;
}

function heldFor(desktop: Desktop): Held {
  let h = held.get(desktop);
  if (!h) {
    const fresh: Held = { lists: {}, asking: new Map(), saved: {}, read: Promise.resolve(), connection };
    fresh.read = loadModels().then((saved) => {
      fresh.saved = { ...saved, ...fresh.saved };
    });
    held.set(desktop, (h = fresh));
  }
  if (h.connection !== connection) {
    h.connection = connection;
    h.lists = {};
    h.asking = new Map();
  }
  return h;
}

/** What is known of each agent's list now: this connection's, else the saved copy. */
export function knownModels(desktop: Desktop): ModelCatalogs {
  const h = heldFor(desktop);
  return { ...h.saved, ...h.lists };
}

/** Resolves once the saved copy is read, for a first render that had none. */
export const savedModelsRead = (desktop: Desktop) => heldFor(desktop).read;

/**
 * Asks for the lists this connection hasn't got. One the desktop couldn't
 * list, or listed empty while its CLI starts, is asked again next time.
 */
export async function loadModelLists(
  desktop: Desktop,
  wanted: readonly AgentProvider[],
): Promise<ModelCatalogs> {
  const h = heldFor(desktop);
  const requestedOn = connection;
  await Promise.all(
    wanted
      .filter((p) => !h.lists[p])
      .map((p) => {
        const { asking: pending } = h;
        const asking =
          pending.get(p) ??
          desktop("agentModels", p)
            .then(
              (list) => {
                // A previous connection can finish after its replacement,
                // including before heldFor has reset this entry.
                if (requestedOn !== connection || !list.length) return;
                h.lists[p] = list;
                h.saved = { ...h.saved, [p]: list };
                saveModels(h.saved);
              },
              () => {},
            )
            .finally(() => pending.delete(p));
        pending.set(p, asking);
        return asking;
      }),
  );
  return knownModels(desktop);
}
