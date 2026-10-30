import {
  agentMentionPattern,
  type AgentProvider,
} from "../../../shared/agents";
import { formatTokens } from "../../../shared/tokens";
import { mac } from "../../lib/mod-key";
import { sendKeyLabel, type SendKey } from "../../lib/send-key";
import { COMPACT_PICKS } from "../../lib/thread-storage";
import { useStoredFlag } from "../../lib/useStoredFlag";
import { useAutoCompactSaved } from "../agents/auto-compact";
import type { ComposerSubmitOptions } from "./composer-keys";
import type { ComposerSendOptions } from "./useComposerSend";

type CompactOffer = { provider: AgentProvider; tokens: number };

export type CompactFirst = ReturnType<typeof useCompactFirst>;

/**
 * The "Compact first" box by Send, offered on a cold cache. Every send
 * carries the box's pick, ⌥ the opposite of it.
 */
export function useCompactFirst({
  draftKey,
  draftText,
  offered,
  to,
  running,
  send,
}: {
  draftKey: string;
  draftText: string;
  offered: CompactOffer | undefined;
  to: string;
  running: boolean;
  send: (options: ComposerSendOptions) => Promise<void>;
}) {
  // The box starts as Settings say, so it waits to know them.
  const sendCompacts = useAutoCompactSaved()?.cold;
  // Ticked or unticked for the draft being written, kept while you're away
  // from it, or the box would tick itself again under the same draft.
  // Sending it lets go.
  const [ticked, setTicked, forgetPick] = useStoredFlag(
    COMPACT_PICKS + draftKey,
    sendCompacts,
  );
  // A command means what it says, after an @mention too; the server sends it as is.
  const offer =
    sendCompacts !== undefined &&
    !running &&
    offered?.provider === to &&
    !/^\s*\//.test(draftText.trim().replace(agentMentionPattern, ""))
      ? offered
      : undefined;
  return {
    offer,
    ticked,
    setTicked,
    /** The tokens Send compacts before the message, when it will. */
    tokens: offer && ticked ? offer.tokens : undefined,
    send({
      steer,
      sendAt,
      after,
      flipCompact = false,
    }: ComposerSubmitOptions = {}) {
      const pick = offer ? ticked !== flipCompact : undefined;
      return send({
        steer,
        sendAt,
        after: () => {
          forgetPick();
          after?.();
        },
        compact: pick === sendCompacts ? undefined : pick,
      });
    },
  };
}

export function CompactFirstBox({
  compact,
  sendKey,
}: {
  compact: CompactFirst;
  sendKey: SendKey;
}) {
  const { offer } = compact;
  if (!offer) return null;
  return (
    <label
      className="composer-compact-first"
      title={`Compact ${formatTokens(offer.tokens)} tokens before this message, as the cache went cold · ${mac ? "⌥" : "Alt+"}${sendKeyLabel(sendKey)} sends the other way`}
    >
      <input
        type="checkbox"
        checked={compact.ticked}
        onChange={(e) => compact.setTicked(e.target.checked)}
      />
      Compact {formatTokens(offer.tokens)} first
    </label>
  );
}
