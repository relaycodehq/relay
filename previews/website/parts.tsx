// Small pieces the page uses in several places.
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { relayMarkSvg, svgDataUrl } from "../../src/lib/relay-icon";

/** `size` is the ribbon's visible height; its SVG box has margins around it. */
export function Mark({ size = 20 }: { size?: number }) {
  const box = Math.round(size * 1.45);
  const src = useMemo(() => svgDataUrl(relayMarkSvg("#aaa8e5")), []);
  return (
    <img
      className="site-mark"
      src={src}
      width={box}
      height={box}
      style={{ margin: (size - box) / 2 }}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}

export function Faq({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="faq">
      {items.map((item, index) => (
        <div key={item.q} className="faq-item" data-open={open === index || undefined}>
          <button type="button" aria-expanded={open === index} onClick={() => setOpen(open === index ? null : index)}>
            {item.q}
            <Plus size={16} />
          </button>
          <div className="faq-answer">
            <p>{item.a}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
