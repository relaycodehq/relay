// What a deep review covers, on its card in place of the thread's branch.
import { useLayoutEffect, useRef, useState } from "react";
import { GitBranch } from "lucide-react";
import type { ReviewCard } from "../../../shared/deep-review";
import "../../ui/middle-truncate.css";

export function ReviewedChanges({ card }: { card: ReviewCard }) {
  if (!card.branches)
    return (
      <span className="sb-thread-ref" title={card.label}>
        <span className="sb-ref-branch">{card.label}</span>
      </span>
    );
  const { head, base } = card.branches;
  return (
    <span className="sb-thread-ref" title={`${head} → ${base}`}>
      <GitBranch size={11} aria-hidden />
      <FoldingBranch name={head} />
      <span className="sb-reviewed-base">→ {base}</span>
    </span>
  );
}

/** A branch that, short of room, folds its folders into `…/` before its own name loses its end. */
function FoldingBranch({ name }: { name: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const [folded, setFolded] = useState(false);
  const slash = name.lastIndexOf("/");
  useLayoutEffect(() => {
    const element = box.current;
    const full = element?.firstElementChild;
    if (!element || !full || slash < 0) {
      setFolded(false);
      return;
    }
    // The hidden full name sizes the box, so it says whether the whole fits.
    const fit = () => setFolded(full.scrollWidth > full.clientWidth);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [name, slash]);
  return (
    <span ref={box} className="middle-truncate sb-reviewed-head">
      <span className="middle-truncate-full" data-text={name} aria-hidden />
      <span>{folded ? `…/${name.slice(slash + 1)}` : name}</span>
    </span>
  );
}
