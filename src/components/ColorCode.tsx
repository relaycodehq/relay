import { PreviewCard } from "@base-ui/react/preview-card";
import type { CSSProperties } from "react";

/** Inline code holding a colour: a square of it, grown bigger on hover. */
export function ColorCode({ value }: { value: string }) {
  const style = { "--swatch": value } as CSSProperties;
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        delay={80}
        closeDelay={0}
        render={<code className="color-code" style={style} />}
      >
        <span className="color-code-swatch" aria-hidden />
        {value}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        {/* Portalled so the thread's scroller can't clip it near the top. */}
        <PreviewCard.Positioner
          className="composer-popup-positioner"
          side="top"
          align="start"
          sideOffset={6}
          style={style}
        >
          <PreviewCard.Popup className="color-code-big" aria-hidden />
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}
