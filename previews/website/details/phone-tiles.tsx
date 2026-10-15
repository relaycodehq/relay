// Demo tiles about the phone app, drawn in the same dp-scaled screens as the
// site's phone section.
import { ChevronLeft, Ellipsis } from "lucide-react";
import "../phone.css";
import { relayIconSvg, svgDataUrl } from "../../../src/lib/relay-icon";
import { PhoneComposer, PhoneStatus } from "../phone";
import { Cycle, Finger, on, within } from "./kit";
import type { Loop } from "./kit";
import type { ReactNode } from "react";

const is = (v: string | undefined) => v !== undefined;
const icon = svgDataUrl(relayIconSvg("#aaa8e5"));

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

function Thread({ title, children, composer }: { title: string; children: ReactNode; composer: ReactNode }) {
  return (
    <div className="ph-thread">
      <header>
        <ChevronLeft size={24} />
        <span>
          <strong>{title}</strong>
          <small>Opus 5.5 · High · 12% context</small>
        </span>
        <Ellipsis size={22} />
      </header>
      <div className="p-turns">{children}</div>
      {composer}
    </div>
  );
}

/* ---- A thread that needs you: Android's heads-up notification ---- */
export const bannerLoop: Loop = { times: [0, 900, 2800, 3500, 5600], still: 1 };
export function BannerTile({ s }: { s: number }) {
  return (
    <div className="p-tile">
      <Phone>
        <Thread title="Draft the release notes" composer={<PhoneComposer input="Message Claude" stop />}>
          <div className="ph-turn" data-user="">
            <div className="ph-bubble">Write the 0.12 notes from the commits since 0.11.1.</div>
          </div>
          <div className="ph-turn">
            <div className="ph-md">
              <p>I'm going through the commits now and grouping them by what you'd notice.</p>
            </div>
          </div>
        </Thread>
        <div className="p-banner" data-on={within(s, 1, 3)}>
          <img src={icon} alt="" />
          <span>
            <small>Relay · now</small>
            <b>Rename the sync worker</b>
            <span>Claude needs you</span>
          </span>
        </div>
      </Phone>
      <Finger x={150} y={s >= 2 ? 70 : 120} show={s >= 2 && s < 4} press={s === 3} />
    </div>
  );
}

/* ---- Hold Send, then send later ---- */
export const holdLoop: Loop = { times: [0, 800, 1300, 2500, 3600, 4200, 4900, 7000], still: 6 };
export function HoldTile({ s }: { s: number }) {
  return (
    <div className="p-tile">
      <Phone>
        <Thread
          title="Rename the sync worker"
          composer={
            <PhoneComposer
              press={is(within(s, 2, 3))}
              input={
                <span className="p-typed" data-on={on(s, 6)}>
                  <Cycle at={s >= 6 ? 1 : 0} items={["Ship the fix after the tests pass", "Message Claude"]} />
                </span>
              }
            />
          }
        >
          <div className="ph-turn">
            <div className="ph-md">
              <p>Done. All 22 tests pass and the docs are updated.</p>
            </div>
          </div>
          <div className="p-later" data-on={on(s, 6)}>
            <p>Ship the fix after the tests pass</p>
            <small>Sends 18:00</small>
          </div>
        </Thread>
        <div className="p-scrim" data-on={within(s, 3, 6)} />
        <div className="p-sheet" data-on={within(s, 3, 6)}>
          <i className="p-grip" />
          <b>Send later</b>
          {[
            ["In 30 minutes", "17:30"],
            ["In 1 hour", "18:00"],
            ["In 3 hours", "20:00"],
            ["Tomorrow morning", "tomorrow 9:00"],
          ].map(([l, w]) => (
            <div className="p-sheetrow" data-hot={l === "In 1 hour" && s >= 4 ? "" : undefined} key={l}>
              <span>{l}</span>
              <small>{w}</small>
            </div>
          ))}
        </div>
      </Phone>
      <Finger x={s >= 4 ? 130 : 233} y={s >= 4 ? 150 : 204} show={s >= 1 && s < 6} press={is(within(s, 2, 3)) || is(within(s, 4, 5))} />
    </div>
  );
}
