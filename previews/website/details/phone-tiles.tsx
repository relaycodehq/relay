// Demo tiles about the phone app, drawn in the same dp-scaled screens as the
// site's phone section.
import { ArrowUp, ChevronLeft, X } from "lucide-react";
import "../phone.css";
import { PhoneStatus } from "../phone";
import { Cycle, Finger, on, within } from "./kit";
import type { Loop } from "./kit";
import type { ReactNode } from "react";

const is = (v: string | undefined) => v !== undefined;

function Phone({ children }: { children: ReactNode }) {
  return (
    <div className="p-frame">
      <div className="p-screen">
        <div className="ph">
          <PhoneStatus hole="center" />
          {children}
        </div>
      </div>
    </div>
  );
}

/* ---- "Needs you" banner ---- */
export const bannerLoop: Loop = { times: [0, 900, 2800, 3500, 5600], still: 1 };
export function BannerTile({ s }: { s: number }) {
  return (
    <div className="p-tile">
      <Phone>
        <div className="p-thread">
          <div className="p-bar"><ChevronLeft size={20} /><b>Draft the release notes</b></div>
          <p className="p-msg">Write the 0.12 notes from the commits since 0.11.1.</p>
          <p className="p-reply">I'm going through the commits now and grouping them by what you'd notice.</p>
          <div className="p-dock">
            <span>Message</span>
            <i className="p-send"><ArrowUp size={18} strokeWidth={2.5} /></i>
          </div>
        </div>
        <div className="p-banner" data-on={within(s, 1, 3)}>
          <i className="p-dot" />
          <span>
            <b>Rename the sync worker</b>
            <small>Needs input · relay</small>
          </span>
          <X size={16} />
        </div>
      </Phone>
      <Finger x={s >= 2 ? 243 : 150} y={s >= 2 ? 64 : 120} show={s >= 2 && s < 4} press={s === 3} />
    </div>
  );
}

/* ---- Hold Send, then send later ---- */
export const holdLoop: Loop = { times: [0, 800, 1300, 2500, 3600, 4200, 4900, 7000], still: 6 };
export function HoldTile({ s }: { s: number }) {
  return (
    <div className="p-tile">
      <Phone>
        <div className="p-thread">
          <div className="p-bar"><ChevronLeft size={20} /><b>Rename the sync worker</b></div>
          <p className="p-reply">Done. All 22 tests pass and the docs are updated.</p>
          <div className="p-later" data-on={on(s, 6)}>
            <p>Ship the fix after the tests pass</p>
            <small>Sends 18:00</small>
          </div>
          <div className="p-dock">
            <span className="p-typed" data-on={on(s, 6)}>
              <Cycle at={s >= 6 ? 1 : 0} items={["Ship the fix after the tests pass", "Message"]} />
            </span>
            <i className="p-send" data-press={within(s, 2, 3)}>
              <ArrowUp size={18} strokeWidth={2.5} />
            </i>
          </div>
        </div>
        <div className="p-scrim" data-on={within(s, 3, 6)} />
        <div className="p-sheet" data-on={within(s, 3, 6)}>
          <i className="p-grip" />
          <b>Send later</b>
          {[
            ["In 30 minutes", "17:30"],
            ["In 1 hour", "18:00"],
            ["Tomorrow morning", "tomorrow 9:00"],
          ].map(([l, w]) => (
            <div className="p-sheetrow" data-hot={l === "In 1 hour" && s >= 4 ? "" : undefined} key={l}>
              <span>{l}</span>
              <small>{w}</small>
            </div>
          ))}
        </div>
      </Phone>
      <Finger x={s >= 4 ? 130 : 240} y={s >= 4 ? 180 : 208} show={s >= 1 && s < 6} press={is(within(s, 2, 3)) || is(within(s, 4, 5))} />
    </div>
  );
}
