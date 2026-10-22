import type { KeyCombo } from "../../../shared/shortcuts";
import { mac } from "../../lib/mod-key";
import { modifiersLabel } from "../../lib/shortcuts";

/** A numbered Activity card's hint while the shortcut modifiers are held. */
export function CardShortcut({
  binding,
  index,
}: {
  binding: KeyCombo | undefined;
  index: number;
}) {
  if (!binding || index < 0 || index >= 9) return null;
  return (
    <kbd className="sb-card-shortcut" aria-hidden>
      <span className={mac ? "glyph" : undefined}>
        {modifiersLabel(binding)}
      </span>
      {index + 1}
    </kbd>
  );
}
