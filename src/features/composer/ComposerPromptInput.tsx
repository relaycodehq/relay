import { EditorContent } from "@tiptap/react";
import { PreviewCard } from "@base-ui/react/preview-card";
import type { HTMLAttributes, Ref, RefObject } from "react";
import { useDraftPills } from "./useDraftPills";
import type { ImageChip } from "./prompt/image-pill";
import { QuoteTooltip, useQuoteTip } from "./prompt/QuoteTip";
import { useImagePeek } from "./prompt/useImagePeek";
import { usePromptEditor, type PromptEvents } from "./prompt/usePromptEditor";
import {
  usePromptHandle,
  type PromptInputHandle,
} from "./prompt/usePromptHandle";
import { useComboboxRole, usePromptSync } from "./prompt/usePromptSync";
import { ImagePeek } from "../images/ImagePeek";
export type { SkillPick } from "./prompt/edits";
export type { ImageChip, PromptInputHandle };

/** The composer's message: the draft's text with its pills, in a TipTap editor. */
export function ComposerPromptInput({
  value,
  onChange,
  onCursor,
  onOpenPaste,
  onOpenImage,
  images,
  placeholder,
  inputRef,
  handleRef,
  draftKey,
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
} & PromptEvents &
  Omit<HTMLAttributes<HTMLDivElement>, "onChange">) {
  const pills = useDraftPills(draftKey);
  const editor = usePromptEditor(
    value,
    placeholder,
    pills,
    { onChange, onCursor, onOpenPaste, onOpenImage },
    inputRef,
  );
  const tip = useQuoteTip(editor);
  const [peek, setPeek] = useImagePeek(editor);
  usePromptSync(editor, value, pills, images, placeholder);
  useComboboxRole(editor, expanded, controls, activeId, autocomplete);
  usePromptHandle(handleRef, editor, draftKey, pills);
  return (
    <div {...events}>
      <EditorContent editor={editor} />
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
