import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import {
  GUEST_SHARE_HOURS,
  type GuestShare,
  type GuestShareContents,
} from "../../../shared/guest-share";
import { api } from "../../lib/api";
import { ErrorBox, Modal, Spinner } from "../../ui/ui";
import { guestShareKey } from "./useGuestShare";
import "./guest-share.css";

/**
 * Share with guest: makes the thread's link as it opens, since that's what
 * picking it asked for, and offers to copy or stop it.
 */
export function ShareGuestDialog({
  threadId,
  onClose,
}: {
  threadId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [share, setShare] = useState<GuestShare>();
  const [error, setError] = useState<unknown>();
  const [starting, setStarting] = useState(true);
  const start = async () => {
    setStarting(true);
    setError(undefined);
    try {
      const started = await api.startGuestShare(threadId);
      setShare(started);
      qc.setQueryData(guestShareKey(threadId), started);
    } catch (e) {
      setError(e);
    } finally {
      setStarting(false);
    }
  };
  // Once, as the dialog opens; a second start hands back the same link.
  useEffect(() => void start(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const stop = async () => {
    await api.stopGuestShare(threadId).catch(setError);
    onClose();
  };
  return (
    <Modal
      title="Share with guest"
      className="guest-share-dialog"
      onClose={onClose}
    >
      {starting && !share ? (
        <p className="guest-share-starting">
          <Spinner /> Opening a link…
        </p>
      ) : (
        share && (
          <ShareDetails
            share={share}
            retrying={starting}
            onRetry={() => void start()}
          />
        )
      )}
      {!!error && <ErrorBox error={error} />}
      <div className="modal-actions">
        {share && (
          <>
            <button
              type="button"
              onClick={() => void api.openExternal(share.localUrl)}
            >
              Open as guest here
            </button>
            <button type="button" onClick={() => void stop()}>
              Stop sharing
            </button>
          </>
        )}
        <button type="button" className="primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

function ShareDetails({
  share,
  retrying,
  onRetry,
}: {
  share: GuestShare;
  retrying: boolean;
  onRetry: () => void;
}) {
  const reach = share.reach;
  return (
    <>
      <p>
        Anyone with the link can follow this thread live and suggest messages.
        Nothing reaches the agent until you send it. Secrets like API keys are
        redacted from what they see.
      </p>
      <p className="guest-share-contents">{contentsLine(share.contents)}</p>
      {reach.public ? (
        <CopyLink url={reach.url} />
      ) : (
        <div className="guest-share-offline">
          <p>
            {reach.reason} Only this computer can open the link until Tailscale
            Funnel can publish it.
          </p>
          <div className="guest-share-offline-actions">
            {reach.fixUrl && (
              <button
                type="button"
                onClick={() => void api.openExternal(reach.fixUrl!)}
              >
                Turn on Funnel
              </button>
            )}
            <button type="button" disabled={retrying} onClick={onRetry}>
              {retrying ? "Trying…" : "Try again"}
            </button>
          </div>
        </div>
      )}
      <p className="guest-share-ends">
        Ends when you stop sharing or settle or archive the thread, and after{" "}
        {GUEST_SHARE_HOURS} hours at the latest. It comes back if Relay
        restarts.
      </p>
    </>
  );
}

/** "Shares 12 files (2.4MB), 3 images and 1 page", from what the link lets guests see. */
function contentsLine(contents: GuestShareContents) {
  const parts = [
    contents.files &&
      `${contents.files} ${contents.files === 1 ? "file" : "files"} (${megabytes(contents.bytes)})`,
    contents.images &&
      `${contents.images} ${contents.images === 1 ? "image" : "images"}`,
    contents.videos &&
      `${contents.videos} ${contents.videos === 1 ? "video" : "videos"}`,
    contents.renders &&
      `${contents.renders} ${contents.renders === 1 ? "page" : "pages"}`,
  ].filter((part): part is string => !!part);
  if (!parts.length) return "Shares the conversation only.";
  const last = parts.pop();
  return `Shares the conversation, ${parts.length ? `${parts.join(", ")} and ${last}` : last}.`;
}

const megabytes = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))}KB`
    : `${(bytes / 1024 / 1024).toFixed(1)}MB`;

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    void api.writeClipboard(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  return (
    <div className="guest-share-link">
      <input
        readOnly
        value={url}
        aria-label="Guest link"
        onFocus={(e) => e.currentTarget.select()}
      />
      <button type="button" onClick={copy}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}
