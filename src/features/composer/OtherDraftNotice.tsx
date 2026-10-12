import { useState } from "react";
import { GitCompareArrows, X } from "lucide-react";
import { resolveOther, useSharedDraft } from "./draft-sync";

/**
 * The draft was edited here and on a phone at once: the later edit won, and
 * this offers the other one, or to let it go.
 */
export function OtherDraftNotice({ draftKey }: { draftKey: string }) {
  const other = useSharedDraft(draftKey)?.other;
  const [busy, setBusy] = useState(false);
  if (!other) return null;
  const theirs = other.by === "desktop" ? "this computer's" : "the phone's";
  const act = (drop: boolean) => {
    setBusy(true);
    void resolveOther(draftKey, drop)
      .catch((e) => console.warn("Couldn't switch the draft:", e))
      .finally(() => setBusy(false));
  };
  return (
    <div className="draft-other-notice" role="status">
      <GitCompareArrows size={14} aria-hidden />
      <span title={other.text}>Edited here and on your phone at once</span>
      <button type="button" disabled={busy} onClick={() => act(false)}>
        Use {theirs} version
      </button>
      <button
        type="button"
        className="icon"
        aria-label="Keep this version"
        title="Keep this version"
        disabled={busy}
        onClick={() => act(true)}
      >
        <X size={13} />
      </button>
    </div>
  );
}
