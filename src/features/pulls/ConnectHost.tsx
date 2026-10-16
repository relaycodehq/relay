import { Modal } from "../../ui/ui";
import { hostPrompt } from "./host-prompt";

/** What a project needs before Relay can choose its PRs, as a dialog. */
export function ConnectHost({
  onClose,
  ...prompt
}: Parameters<typeof hostPrompt>[0] & { onClose: () => void }) {
  const { title, text, action } = hostPrompt(prompt);
  return (
    <Modal title={title} onClose={onClose}>
      {text}
      {action && <div className="modal-actions">{action}</div>}
    </Modal>
  );
}
