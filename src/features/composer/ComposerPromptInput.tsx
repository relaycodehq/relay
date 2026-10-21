import { EditorContent } from "@tiptap/react";
import { PreviewCard } from "@base-ui/react/preview-card";
import type { HTMLAttributes, Ref, RefObject } from "react";
import { useDraftPills } from "./useDraftPills";
import type { ImageChip } from "./prompt/image-pill";
import { QuoteTooltip, useQuoteTip } from "./prompt/QuoteTip";
import { useImagePeek } from "./prompt/useImagePeek";
import { useLineCount } from "./prompt/useLineCount";
import { usePromptEditor, type PromptEvents } from "./prompt/usePromptEditor";
import {
  usePromptHandle,
  type PromptInputHandle,
} from "./prompt/usePromptHandle";
import { useComboboxRole, usePromptSync } from "./prompt/usePromptSync";
import { ImagePeek } from "../images/ImagePeek";
import "./prompt/prompt-input.css";
export type { SkillPick } from "./prompt/edits";
export type { ImageChip, PromptInputHandle };

/** The composer's message: the draft's text with its pills, in a TipTap editor. */
export function ComposerPromptInput({
  value,
  onChange,
  onCursor,
  onOpenPaste,
  onOpenImage,
  onPasteRefused,
  images,
  placeholder,
  inputRef,
  handleRef,
  draftKey,
  ghost,
  onGhost,
  "aria-label": ariaLabel,
  "aria-expanded": expanded,
  "aria-controls": controls,
  "aria-activedescendant": activeId,
  "aria-autocomplete": autocomplete,
  ...events
}: {
  value: string;
  images?: ImageChip[];
  placeholder: string;
  inputRef: RefObject<HTMLElement | null>;
  handleRef: Ref<PromptInputHandle>;
  draftKey: string;
  /** A suggested message shown over the empty draft, which Tab or a click on its key takes. */
  ghost?: string;
  onGhost?: () => void;
} & PromptEvents &
  Omit<HTMLAttributes<HTMLDivElement>, "onChange">) {
  const pills = useDraftPills(draftKey);
  const editor = usePromptEditor(
    value,
    placeholder,
    pills,
    { onChange, onCursor, onOpenPaste, onOpenImage, onPasteRefused },
    inputRef,
  );
  const tip = useQuoteTip(editor);
  const [peek, setPeek] = useImagePeek(editor);
  const more = useLineCount(editor) - 1;
  usePromptSync(editor, value, pills, images, ghost ? "" : placeholder);
  useComboboxRole(editor, expanded, controls, activeId, autocomplete);
  usePromptHandle(handleRef, editor, draftKey, pills);
  return (
    <div {...events} className="composer-prompt" data-more={more || undefined}>
      <EditorContent editor={editor} />
      {ghost && (
        <div className="composer-ghost" key={ghost}>
          <span aria-hidden>{ghost}</span>
          <button
            type="button"
            className="composer-ghost-key"
            title="Use this message"
            aria-label={`Use the suggested message: ${ghost}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onGhost}
          >
            Tab
          </button>
        </div>
      )}
      {more > 0 && (
        <span className="composer-more-lines" aria-hidden>
          +{more} {more === 1 ? "line" : "lines"}
        </span>
      )}
      {tip && <QuoteTooltip tip={tip} />}
      <PreviewCard.Root
        open={!!peek}
        onOpenChange={(open) => !open && setPeek(null)}
      >
        {peek && <ImagePeek src={peek.src} anchor={peek.anchor} />}
      </PreviewCard.Root>
    </div>
  );
}
