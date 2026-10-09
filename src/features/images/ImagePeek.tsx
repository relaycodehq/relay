import { PreviewCard } from "@base-ui/react/preview-card";
import "../agents/composer-model-picker.css";
import { CopyImageMenu } from "./CopyImageMenu";

/** How long a pointer rests on a screenshot pill before its picture grows. */
export const PEEK_DELAY = 80;

/**
 * A screenshot pill's picture, grown above it on hover like a colour swatch.
 * Portalled so neither the thread nor the composer clips it. Goes inside a
 * `PreviewCard.Root`; `anchor` places it when there is no trigger. Right-click
 * on it copies the picture; a click calls `onOpen`, for the full viewer.
 */
export function ImagePeek({
  src,
  anchor,
  onOpen,
}: {
  src: string;
  anchor?: Element;
  onOpen?: () => void;
}) {
  return (
    <PreviewCard.Portal>
      <PreviewCard.Positioner
        className="composer-popup-positioner"
        anchor={anchor}
        side="top"
        align="start"
        sideOffset={6}
        collisionPadding={8}
      >
        <PreviewCard.Popup className="image-chip-peek" aria-hidden>
          <CopyImageMenu
            source={src}
            within=".image-chip-peek"
            className="image-chip-peek-copy"
          >
            <img
              src={src}
              alt=""
              className={onOpen ? "opens" : undefined}
              onClick={onOpen}
            />
          </CopyImageMenu>
        </PreviewCard.Popup>
      </PreviewCard.Positioner>
    </PreviewCard.Portal>
  );
}
