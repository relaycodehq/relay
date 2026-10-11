import { useState } from "react";

const findings = [
  {
    id: "B1",
    kind: "Bug",
    priority: "Fix first",
    title: "Removing an unfinished note resurrects completed work",
    summary:
      "A checked item loses its done state when removing another item leaves it alone. Quote now puts the completed task back into the draft.",
    repro:
      "Keep a two-item list. Check the first item, remove the second, then quote the note.",
    evidence:
      "Before: done: [0]. After: no done field. Quoted text: “1. Already shipped”. Confirmed both in the real Notes UI component and through the isolated Electron API.",
    cause:
      "noteList rejects lists shorter than two items; arrangeNote then clears done and noteQuote returns the whole plain note.",
    source: "shared/thread-notes.ts:93, shared/thread-notes.ts:228",
    fix: "Preserve checklist state when a list shrinks to one item. Keep the checkbox and quote exclusion until that last item is explicitly unchecked.",
    history:
      "Matches your 10 Oct request to skip crossed-out items when quoting (c6d1714e).",
    images: ["notes-before.png", "notes-after.png"],
    lab: "notes",
  },
  {
    id: "B2",
    kind: "Bug",
    priority: "Fix first",
    title: "Narrowing the queue hides text that will not expand",
    summary:
      "A message that fits initially becomes clipped after the pane narrows. Clicking it does nothing because Relay still thinks it is short.",
    repro:
      "Open the queue sample wide (1050px), click Narrow pane (744px), then click the message.",
    evidence:
      "Wide: 69px visible / 69px content. Narrow: 74px visible / 92px content. The bubble stays “queued-bubble”, without “long” or “open”, even after clicking. No message data is lost.",
    cause:
      "The overflow measurement only reruns when text or open changes. It never observes width changes.",
    source: "src/features/thread/QueuedMessages.tsx:89",
    fix: "Re-measure the paragraph on size changes. Keep the bubble design and working drag behavior.",
    history:
      "Matches your queue redesign and repeated complaints about pane/layout changes (3b75d727).",
    images: ["queue-clipped.png"],
    lab: "queue",
  },
  {
    id: "B3",
    kind: "Bug",
    priority: "Fix next",
    title: "The time picker loops at the spring clock change",
    summary:
      "On Prague’s daylight-saving transition, Down or scrolling forward can move the time backward and then alternate forever between 03:00 and 03:30.",
    repro:
      "Use the DST sample (28 March 2027, Europe/Prague). Focus the time drum, then press ArrowDown repeatedly from 01:30.",
    evidence:
      "Observed: 01:30 → 03:00 → 03:30 → 03:00 → 03:30 → 03:00. The screenshot shows duplicate 03:00 / 03:30 rows. Reproduced in Chromium with Europe/Prague timezone.",
    cause:
      "48 wall-clock slots are converted with Date.setHours. Nonexistent 02:00/02:30 normalize to 03:00/03:30, producing duplicate, out-of-order timestamps; findIndex returns the earlier duplicate.",
    source: "src/ui/TimeDrum.tsx:6, src/ui/TimeDrum.tsx:39",
    fix: "Build a monotonic list of valid instants for the selected day and index it without duplicated timestamps. Verify both daylight-saving boundaries.",
    history: "Affects the shared picker used by Send later and Snooze.",
    images: ["calendar-dst.png"],
    lab: "time&clock=dst",
  },
  {
    id: "B4",
    kind: "Bug",
    priority: "Small fix",
    title: "At month end, the calendar hides its selected day",
    summary:
      "The default time rolls into the next month while the calendar stays in the current month. There is no selected date to focus.",
    repro:
      "Use the month-end sample: 31 October 2026 at 23:10, Europe/Prague. Open Pick a time.",
    evidence:
      "Calendar: October 2026. Scheduled time: Tomorrow 00:30 (1 November). Selected date cells: zero. The initial focus effect has nothing to focus.",
    cause:
      "The chosen instant starts an hour ahead; the visible month starts from now, independently.",
    source: "src/ui/PickTime.tsx:95, src/ui/PickTime.tsx:122",
    fix: "Initialize the visible month from the chosen instant and keep a valid keyboard focus target in the visible month.",
    history:
      "Small but concrete mismatch between the state and what the control shows.",
    images: ["calendar-month-end.png"],
    lab: "time&clock=month-end",
  },
  {
    id: "U1",
    kind: "UI polish",
    priority: "Highest UI value",
    title: "Search should not move away while you type",
    summary:
      "The new shared search picker changes height with its results. Near the bottom of a window, filtering can flip the entire popup across its trigger.",
    repro: "Open the sample branch picker, type “main”, then clear the search.",
    evidence:
      "At 1280×850: 24 options gave a 410px popup starting at y=193. One option gave an 81px popup starting at y=647: a 454px move while typing.",
    cause:
      "Only max-height is constrained. Collision positioning changes sides as the content shrinks.",
    source: "src/ui/search-select.css:2, src/ui/SearchSelect.tsx:107",
    fix: "Reserve the results area while the picker is open, with a viewport cap. Keep the search and empty/loading states in place.",
    history:
      "You explicitly asked for a fixed-height, scrollable PR picker on 10 Oct (539769f2). The same issue remains in SearchSelect, added elsewhere in b27c0bc4.",
    images: ["picker-many.png", "picker-one.png"],
    lab: "picker",
  },
  {
    id: "U2",
    kind: "UI polish",
    priority: "Low effort",
    title: "Make “show the full queued message” an actual control",
    summary:
      "Long messages expand through a mouse click on a div. There is no focusable expansion button or expanded state for keyboard and assistive-technology users.",
    repro:
      "Load a long queued message at a narrow width, then Tab through the queue. Only its send and return actions are focusable; the message body cannot be expanded with Enter or Space.",
    evidence:
      "The real bubble is a div with tabIndex -1, no role and no aria-expanded. This is separate from the resize bug.",
    cause: "QueuedRow implements expansion only through onClick.",
    source: "src/features/thread/QueuedMessages.tsx:104",
    fix: "Add a quiet “Show more / Show less” control with aria-expanded, keeping the existing bubble and drag behavior. Show it only when the text actually overflows.",
    history:
      "Keeps the queue design you selected instead of replacing it with another widget.",
    images: [],
    lab: "queue",
  },
  {
    id: "U3",
    kind: "UI polish",
    priority: "Optional",
    title: "Keep a review’s branch direction readable together",
    summary:
      "At a 744px conversation width, a longer source branch leaves “into” at the end of one row and “main” alone on the next.",
    repro:
      "Open the long-branch sample. Both branch controls are real TargetField controls.",
    evidence:
      "The 78-character source branch fits, but the base wraps below it. This is a readability issue, not a broken review.",
    cause:
      "The target row wraps controls independently without reserving space for the destination.",
    source:
      "src/features/deep-review/TargetField.tsx:97, src/features/deep-review/deep-review.css:51",
    fix: "Let the source label truncate, retain its full name in the opened picker or tooltip, and keep the direction and destination together.",
    history:
      "Follows your recent branch-picker cleanup without adding another mode or toolbar.",
    images: ["long-branch.png"],
    lab: "branches",
  },
];

export function Report() {
  const [filter, setFilter] = useState("All");
  return (
    <section className="audit-report">
      <div className="audit-lead">
        <h2>Four reproduced bugs. Three focused UI improvements.</h2>
        <p>
          Start with Notes and queue resizing. Both affect everyday work, and
          both have a small shared cause. The picker movement is the clearest UI
          win.
        </p>
      </div>
      <div className="audit-filters">
        {["All", "Bug", "UI polish"].map((f) => (
          <button
            key={f}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="audit-findings">
        {findings
          .filter((f) => filter === "All" || filter === f.kind)
          .map((f) => (
            <article className="audit-finding" id={f.id} key={f.id}>
              <div className="audit-finding-meta">
                <b>
                  {f.id} · {f.kind}
                </b>
                <span>{f.priority}</span>
                <a href={`?case=${f.lab}`}>Try reproduction ↗</a>
              </div>
              <h3>{f.title}</h3>
              <p>{f.summary}</p>
              {!!f.images.length && (
                <div className={`audit-shots ${f.id === "B1" ? "pair" : ""}`}>
                  {f.images.map((img, i) => (
                    <figure key={img}>
                      <a
                        href={`assets/${img}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <img
                          src={`assets/${img}`}
                          alt={`${f.title}: ${f.images.length > 1 ? (i ? "after" : "before") : "observed state"}`}
                        />
                      </a>
                      {f.images.length > 1 && (
                        <figcaption>{i ? "After" : "Before"}</figcaption>
                      )}
                    </figure>
                  ))}
                </div>
              )}
              <details>
                <summary>Reproduction, cause and proposed fix</summary>
                <dl>
                  <dt>Reproduce</dt>
                  <dd>{f.repro}</dd>
                  <dt>Observed</dt>
                  <dd>{f.evidence}</dd>
                  <dt>Cause</dt>
                  <dd>{f.cause}</dd>
                  <dt>Proposed fix</dt>
                  <dd>{f.fix}</dd>
                  <dt>Relevant history</dt>
                  <dd>{f.history}</dd>
                  <dt>Code</dt>
                  <dd>
                    <code>{f.source}</code>
                  </dd>
                </dl>
              </details>
            </article>
          ))}
      </div>
      <aside className="audit-scope">
        <h3>What this pass covers</h3>
        <p>
          Read 180 recent commit subjects and 10 relevant conversations.
          Inspected the current checkout, including the presence of local
          compaction/token edits. Exercised Notes, queued messages, search
          pickers, calendar and review target components using the app’s own CSS
          with sample data. Also opened desktop Settings and exercised note
          persistence in an isolated Electron profile.
        </p>
        <p>
          All evidence above is captured output, not a proposed redesign.
          Calendar clocks are deliberately fixed; their reproductions assume
          Europe/Prague. Product source files were not edited. Only this report,
          its sample harness and evidence were added.
        </p>
        <p>
          This is a focused desktop audit, not certification of the whole app.
          Real-provider streaming, OS window lifecycle, phone UI, handoffs,
          Device Hub, production performance and live network failures were not
          reproduced in this pass.
        </p>
        <p id="verification">
          Typecheck passed. Of 12 existing project, new-thread and deep-review
          E2E scenarios, 10 passed. Two repeatedly fail at outdated UI steps:
          reopening a persisted Deep review toggle, and expecting Add project to
          skip its new palette. See REPORT.md for the exact steps. The four
          product bugs above were reproduced separately.
        </p>
      </aside>
    </section>
  );
}
