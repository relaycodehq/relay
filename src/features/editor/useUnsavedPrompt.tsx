import { useEffect, useState } from "react";
import type { FileDocument } from "./documents";
import { UnsavedPrompt } from "./prompts";

/**
 * Closing and reloading that ask first when the document has unsaved edits.
 * `prompt` is the question to show, when one is open.
 */
export function useUnsavedPrompt({
  doc,
  closeRequest,
  onClose,
}: {
  doc: FileDocument;
  /** A new value asks to close, as a tab's × does. */
  closeRequest: number | undefined;
  onClose: () => void;
}) {
  const [asking, setAsking] = useState<"close" | "reload" | null>(null);

  const requestClose = () => {
    if (doc.status.saving) return;
    if (doc.status.dirty) setAsking("close");
    else onClose();
  };
  const requestReload = () => {
    if (doc.status.dirty) setAsking("reload");
    else void doc.load();
  };
  useEffect(() => {
    if (closeRequest) requestClose();
  }, [closeRequest]);

  const discard = () => {
    setAsking(null);
    if (asking === "close") onClose();
    else void doc.load();
  };
  const saveAndClose = async () => {
    const saved = await doc.save();
    if (!saved) return;
    setAsking(null);
    onClose();
  };
  const prompt = asking && (
    <UnsavedPrompt
      asking={asking}
      saving={doc.status.saving}
      onKeep={() => setAsking(null)}
      onDiscard={discard}
      onSave={() => void saveAndClose()}
    />
  );
  return { requestClose, requestReload, prompt };
}
