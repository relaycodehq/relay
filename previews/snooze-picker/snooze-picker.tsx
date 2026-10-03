// Snooze → a time of your own: three ways to pick one, from the real
// sidebar card. Open http://127.0.0.1:5177/previews/snooze-picker/ (?v=a|b|c)
import "../_shared/desktop-stub";
import { StrictMode, useRef, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { Popover } from "@base-ui/react/popover";
import { Check, ChevronRight, Clock, Moon, Sun, Sunrise } from "lucide-react";
import "../../src/styles.css";
import "../../src/features/sidebar/sidebar.css";
import "../_shared/chrome.css";
import "./snooze-picker.css";
import { initAppearance, setMode } from "../../src/lib/appearance";
import { initWindowFocus } from "../../src/lib/window-focus";
import { wakeLabel } from "../../shared/chat-activity";
import type { PickerProps } from "./snooze-picker-common";
import { TypeIt } from "./snooze-picker-type";
import { CalendarPicker } from "./snooze-picker-calendar";
import { TimelinePicker } from "./snooze-picker-timeline";
import { whenLabel } from "./snooze-when";

initAppearance();
initWindowFocus();

type Variant = "a" | "b" | "c";

const variants: {
  id: Variant;
  label: string;
  about: string;
  Picker: (props: PickerProps) => React.ReactNode;
}[] = [
  {
    id: "a",
    label: "A · Type it",
    about:
      "The menu's heading is a field: type 45m, fri 3pm, next tue or oct 12 and it reads it as you go. ↑↓ and Enter.",
    Picker: TypeIt,
  },
  {
    id: "b",
    label: "B · Calendar",
    about:
      "The one that shipped. Pick a time… turns the menu into a month and a drum of half-hours: each wheel notch clicks the next one into the band.",
    Picker: CalendarPicker,
  },
  {
    id: "c",
    label: "C · Timeline",
    about:
      "Pick a time… shows a tape of time under a needle: drag or flick it, scroll it, or tap a day to jump. ←→ 15 min, ⇧ an hour.",
    Picker: TimelinePicker,
  },
];

interface Chat {
  id: string;
  project: string;
  hue: number;
  title: string;
  age: string;
  until?: number;
}

const sample: Chat[] = [
  {
    id: "1",
    project: "Relay",
    hue: 250,
    title: "Snooze picker that isn't a browser input",
    age: "4m",
  },
  {
    id: "2",
    project: "Website",
    hue: 28,
    title: "Pricing page hero spacing",
    age: "1h",
  },
  {
    id: "3",
    project: "Licensing",
    hue: 150,
    title: "Seat count on renewal invoices",
    age: "3h",
  },
  {
    id: "4",
    project: "Relay",
    hue: 250,
    title: "Phone APK installs itself",
    age: "1d",
  },
];

function Badge({ chat }: { chat: Chat }) {
  return (
    <span
      className="sb-project-badge"
      style={{ "--hue": chat.hue } as CSSProperties}
      aria-hidden
    >
      {chat.project[0]}
    </span>
  );
}

function App() {
  const initial = new URLSearchParams(location.search).get("v");
  const [variant, setVariant] = useState<Variant>(
    initial === "b" || initial === "c" ? initial : "a",
  );
  const [chats, setChats] = useState(sample);
  const [openId, setOpenId] = useState<string | null>("1");
  const [last, setLast] = useState<{ title: string; until: number } | null>(
    null,
  );
  const [shelf, setShelf] = useState(true);
  const [dark, setDark] = useState(
    document.documentElement.dataset.theme === "dark" ||
      matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const popup = useRef<HTMLDivElement>(null);
  const { Picker, about } = variants.find((v) => v.id === variant)!;

  const pick = (next: Variant) => {
    setVariant(next);
    setOpenId("1");
    history.replaceState(null, "", `?v=${next}`);
  };
  const snooze = (chat: Chat, until: number) => {
    setOpenId(null);
    setChats((all) => all.map((c) => (c.id === chat.id ? { ...c, until } : c)));
    setLast({ title: chat.title, until });
  };
  const wake = (id: string) =>
    setChats((all) =>
      all.map((c) => (c.id === id ? { ...c, until: undefined } : c)),
    );
  const active = chats.filter((c) => !c.until);
  const snoozed = chats.filter((c) => c.until);

  return (
    <div className="preview-app">
      <div className="preview-bar">
        <strong>Snooze · pick a time</strong>
        <span className="preview-tag">Sample data</span>
        <div
          className="preview-segmented"
          role="radiogroup"
          aria-label="Design"
        >
          {variants.map((v) => (
            <button
              key={v.id}
              role="radio"
              aria-checked={variant === v.id}
              onClick={() => pick(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <span style={{ flex: 1, minWidth: 240 }}>{about}</span>
        <button
          className="sp-bar-button"
          onClick={() => {
            setChats(sample);
            setLast(null);
            setOpenId("1");
          }}
        >
          Reset
        </button>
        <button
          className="sp-bar-button"
          aria-label="Toggle theme"
          onClick={() => {
            setMode(dark ? "light" : "dark");
            setDark(!dark);
          }}
        >
          {dark ? <Sun size={13} /> : <Moon size={13} />}
        </button>
      </div>
      <div className="sp-stage">
        <aside className="sp-sidebar">
          <div className="sb">
            <div className="sb-scroll">
              <div className="sp-heading">
                <span>Activity</span>
                <span>{active.length} open</span>
              </div>
              <div className="sb-cards">
                {active.map((c) => (
                  <div key={c.id} className="sb-card" tabIndex={0}>
                    <div className="sb-card-top">
                      <Badge chat={c} />
                      <span className="sb-card-name">
                        <span className="sb-card-project">{c.project}</span>
                      </span>
                      <time className="sb-card-state">{c.age}</time>
                      <div className="sb-card-actions">
                        <Popover.Root
                          open={openId === c.id}
                          onOpenChange={(open) => setOpenId(open ? c.id : null)}
                        >
                          <Popover.Trigger
                            className="sb-card-action icon"
                            aria-label="Snooze"
                            title="Snooze"
                          >
                            <Clock size={14} />
                          </Popover.Trigger>
                          <Popover.Portal>
                            <Popover.Positioner
                              side="bottom"
                              align="end"
                              sideOffset={6}
                              collisionPadding={8}
                              className="sb-menu-positioner"
                            >
                              <Popover.Popup
                                ref={popup}
                                className="sb-menu sp-pop"
                                initialFocus={() =>
                                  popup.current?.querySelector<HTMLElement>(
                                    "[data-autofocus]",
                                  ) ?? true
                                }
                              >
                                <Picker
                                  key={variant}
                                  onSnooze={(until) => snooze(c, until)}
                                />
                              </Popover.Popup>
                            </Popover.Positioner>
                          </Popover.Portal>
                        </Popover.Root>
                        <button className="sb-card-action">
                          <Check size={13} />
                          Settle
                        </button>
                      </div>
                    </div>
                    <div className="sb-card-title">{c.title}</div>
                  </div>
                ))}
              </div>
              {snoozed.length > 0 && (
                <section className="sb-shelf">
                  <button
                    className="sb-shelf-toggle"
                    aria-expanded={shelf}
                    onClick={() => setShelf(!shelf)}
                  >
                    <span>
                      Snoozed <b>{snoozed.length}</b>
                    </span>
                    <hr />
                    <ChevronRight size={13} />
                  </button>
                  {shelf && (
                    <div className="sb-shelf-list">
                      {snoozed.map((c) => (
                        <div key={c.id} className="sb-compact">
                          <Badge chat={c} />
                          <span className="sb-compact-title">{c.title}</span>
                          <small>{wakeLabel(c.until!, new Date())}</small>
                          <button
                            className="sb-card-action icon"
                            title="Wake now"
                            aria-label="Wake now"
                            onClick={() => wake(c.id)}
                          >
                            <Sunrise size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </div>
          </div>
        </aside>
        <main className="sp-main">
          {last ? (
            <>
              <span>
                Snoozed <strong>{last.title}</strong>
              </span>
              <span>until {whenLabel(last.until, new Date())}</span>
            </>
          ) : (
            <span>
              Hover a card and press its clock. The first card's menu opens on
              load.
            </span>
          )}
        </main>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
