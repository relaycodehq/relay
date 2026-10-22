import { useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { RotateCcw } from "lucide-react";
import type {
  ProviderUsage,
  SavedResets,
} from "../../../../shared/provider-usage";
import { errorMessage } from "../../../../shared/error-message";
import { api } from "../../../lib/api";
import {
  attemptAfter,
  expiryWords,
  firstToLapse,
  outcomeWords,
  type ResetAttempt,
} from "./saved-resets";
import "./reset-usage.css";

/** Shared by the picker and Usage page. Mount with the account's key. */
export function ResetUsage({
  accountId,
  accountName,
  resets,
  low,
  onUsage,
  container,
  compact = false,
}: {
  accountId: string;
  accountName: string;
  resets: SavedResets;
  low: boolean;
  onUsage: (usage: ProviderUsage) => Promise<void>;
  container?: HTMLElement;
  /** Just how many are saved ("2 resets"), for one-line footers. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Keep the same key AND credit after an ambiguous response. Retrying must
  // never spend the next reset, even if a poll has refreshed the list.
  const attempt = useRef<ResetAttempt | null>(null);
  const pending = useRef(false);
  const credit = firstToLapse(resets);
  const remaining = resets.count - 1;
  const expiry = expiryWords(resets);
  const resetUsage = async () => {
    if (pending.current) return;
    pending.current = true;
    const sent = attempt.current ?? {
      key: crypto.randomUUID(),
      creditId: credit?.id ?? null,
    };
    attempt.current = sent;
    setBusy(true);
    setNote(null);
    try {
      const { outcome, usage } = await api.redeemCodexReset(
        accountId,
        sent.creditId,
        sent.key,
      );
      attempt.current = attemptAfter(sent, outcome);
      await onUsage(usage);
      const words = outcomeWords(outcome);
      if (words) setNote(words);
      else setOpen(false);
    } catch (error) {
      setNote(
        `${errorMessage(error)} Trying again can’t spend a second reset.`,
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (pending.current) return;
        setOpen(next);
        if (next) setNote(null);
      }}
    >
      <Popover.Trigger
        type="button"
        className="usage-reset"
        data-low={low || undefined}
        disabled={resets.usable === 0 && !attempt.current}
        data-compact={compact || undefined}
        aria-label={
          compact
            ? `Reset usage, ${resets.count} saved ${resets.count === 1 ? "reset" : "resets"}`
            : undefined
        }
        title={
          resets.usable === 0
            ? "Codex says these limits don’t need a reset right now"
            : compact
              ? `Reset usage · ${resets.count} saved ${resets.count === 1 ? "reset" : "resets"}${expiry ? ` · ${expiry}` : ""}`
              : undefined
        }
      >
        <RotateCcw size={12} />
        {compact
          ? `${resets.count} ${resets.count === 1 ? "reset" : "resets"}`
          : "Reset usage…"}
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Positioner
          className="usage-reset-positioner"
          side="top"
          align="end"
          sideOffset={6}
        >
          <Popover.Popup
            className="usage-reset-ask"
            aria-label="Use one saved reset?"
            aria-busy={busy || undefined}
          >
            <strong>Use one saved reset?</strong>
            <p>
              Reset usage for <strong>{accountName}</strong>? This spends one
              saved reset.{" "}
              {remaining > 0
                ? `${remaining} ${remaining === 1 ? "reset will" : "resets will"} remain.`
                : "This is the last saved reset."}
              {credit?.expiresAt != null && (
                <small>
                  Uses the reset that expires{" "}
                  {new Date(credit.expiresAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                  .
                </small>
              )}
            </p>
            {note && (
              <p className="usage-reset-note" role="alert">
                {note}
              </p>
            )}
            <div className="usage-reset-ask-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void resetUsage()}
              >
                {busy ? "Resetting…" : "Use 1 reset"}
              </button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
