import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Modal } from "./ui";

export function OpenPullUrl({
  onOpen,
  onClose,
}: {
  onOpen: (url: string) => Promise<void>;
  onClose: () => void;
}) {
  const [url, setUrl] = useState("");
  return (
    <Modal title="Open a pull request" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onOpen(url);
        }}
      >
        <label>
          Gitea pull request URL
          <input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://git.example.com/team/project/pulls/42"
            required
          />
        </label>
        <p className="muted">
          Paste the PR URL, including a link to its Files tab.
        </p>
        <button className="primary" disabled={!url.trim()}>
          Open pull request <ArrowRight size={15} />
        </button>
      </form>
    </Modal>
  );
}
