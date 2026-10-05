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
};
/** By connection: a new one asks again, so models a CLI update brought show up. */
const held = new WeakMap<Desktop, Held>();

function heldFor(desktop: Desktop): Held {
  let h = held.get(desktop);
  if (!h) {
    const fresh: Held = { lists: {}, asking: new Map(), saved: {}, read: Promise.resolve() };
    fresh.read = loadModels().then((saved) => {
      fresh.saved = { ...saved, ...fresh.saved };
    });
    held.set(desktop, (h = fresh));
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

/** Asks for the lists this connection hasn't got; one the desktop couldn't list is asked again next time. */
export async function loadModelLists(
  desktop: Desktop,
  wanted: readonly AgentProvider[],
): Promise<ModelCatalogs> {
  const h = heldFor(desktop);
  await Promise.all(
    wanted
      .filter((p) => !h.lists[p])
      .map((p) => {
        const asking =
          h.asking.get(p) ??
          desktop("agentModels", p)
            .then(
              (list) => {
                h.lists[p] = list;
                if (list.length) {
                  h.saved = { ...h.saved, [p]: list };
                  saveModels(h.saved);
                }
              },
              () => {},
            )
            .finally(() => h.asking.delete(p));
        h.asking.set(p, asking);
        return asking;
      }),
  );
  return knownModels(desktop);
}
