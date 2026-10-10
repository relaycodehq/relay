import { localSwitch } from "../../lib/local-switch";
import { persistedStore } from "../../lib/persisted-store";
import { parseMemory, type TipMemory } from "./tips";

const memory = persistedStore<TipMemory>(
  "relay-tips",
  (saved) => {
    try {
      return parseMemory(saved === null ? undefined : JSON.parse(saved));
    } catch {
      return parseMemory(undefined);
    }
  },
  (m) => JSON.stringify(m),
);

export const tipMemory = memory.get;
export const useTipMemory = memory.use;

export function updateTipMemory(change: (m: TipMemory) => TipMemory) {
  memory.set(change(memory.get()));
}

/** Settings → Appearance: Clip and his tips, on until turned off. */
const shown = localSwitch("relay-tips-shown");
export const useTipsShown = shown.use;
export const setTipsShown = shown.set;
