import { useState } from "react";

type Work = "commit" | "suggest";

/**
 * The commit message typed into the change popup, and the commit or the
 * written suggestion running for it. One runs at a time.
 */
export function useCommitDraft(
  commit: ((message: string) => Promise<void>) | undefined,
  suggest: (() => Promise<string>) | undefined,
) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<Work>();
  const [error, setError] = useState<unknown>();

  async function run(kind: Work, work: () => Promise<void>) {
    setBusy(kind);
    setError(undefined);
    try {
      await work();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(undefined);
    }
  }

  const send = () => {
    if (!commit || !message.trim() || busy) return;
    void run("commit", () => commit(message.trim()));
  };

  const write = () => {
    if (!suggest || busy) return;
    void run("suggest", async () => setMessage(await suggest()));
  };

  return { message, setMessage, busy, error, send, write };
}
