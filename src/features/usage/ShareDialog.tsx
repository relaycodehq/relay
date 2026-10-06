import { useRef, useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import type { UsageSummary } from "../../../shared/usage";
import { api } from "../../lib/api";
import { useAppearance } from "../../lib/appearance";
import { ErrorBox, Modal } from "../../ui/ui";
import { cardPng, UsageCard, type CardOptions } from "./share-card";

/** The card to share, with what it shows and ways to take it out of Relay. */
export function ShareDialog({
  summary,
  onClose,
}: {
  summary: UsageSummary;
  onClose: () => void;
}) {
  const kind = useAppearance().palette.kind;
  const card = useRef<SVGSVGElement>(null);
  const [options, setOptions] = useState<CardOptions>({
    names: false,
    dollars: true,
  });
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<unknown>();
  const run = (action: (png: string) => Promise<unknown>) => async () => {
    setError(undefined);
    try {
      await action(await cardPng(card.current!));
    } catch (e) {
      setError(e);
    }
  };
  const copy = run(async (png) => {
    await api.writeClipboardImage(png);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  });
  const save = run((png) =>
    api.saveUsageImage(png, `relay-usage-${summary.range}.png`),
  );
  return (
    <Modal title="Share usage" className="us-share" onClose={onClose}>
      <div className="us-card-frame">
        <UsageCard ref={card} summary={summary} kind={kind} options={options} />
      </div>
      <div className="us-share-options">
        <label>
          <input
            type="checkbox"
            checked={options.dollars}
            onChange={(e) =>
              setOptions({ ...options, dollars: e.target.checked })
            }
          />
          Show dollars
        </label>
        <label>
          <input
            type="checkbox"
            checked={options.names}
            onChange={(e) =>
              setOptions({ ...options, names: e.target.checked })
            }
          />
          Show the busiest thread’s name
        </label>
      </div>
      {!!error && <ErrorBox error={error} />}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>
          Close
        </button>
        <button type="button" onClick={() => void copy()}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy image"}
        </button>
        <button type="button" className="primary" onClick={() => void save()}>
          <Download size={13} />
          Save PNG…
        </button>
      </div>
    </Modal>
  );
}
