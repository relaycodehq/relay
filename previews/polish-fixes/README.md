# Polish fixes

An interactive check of the October 2026 polish audit fixes, using the app's
components and isolated sample data. Open `/previews/polish-fixes/` on Vite.

- Notes: remove the unfinished item; the last completed item keeps its
  checkbox and cannot be quoted until unchecked.
- Queue: narrow the pane; Show more appears, works with Enter and Space,
  and disappears again when the folded message fits.
- Calendar: the selected day opens in the right month and keeps keyboard
  focus across month boundaries. Spring skips missing times; autumn offers
  both repeated times with their offsets.
- Picker: filtering to one or zero results preserves the popup's position
  and height, including in a short viewport. Enter selects both the initial
  first result and one moved to the first position by filtering.
- Branches: long source and base names stay together on one row, with the
  full selected name available in a tooltip.

Run the browser checks against an already-running dev server:

```sh
RELAY_POLISH_URL=http://127.0.0.1:5177/previews/polish-fixes/ node previews/polish-fixes/verify.mjs
```

The script uses Chromium in Europe/Prague, verifies the seven audit cases,
checks keyboard interaction and light/dark layouts, and writes screenshots
and results to `test-results/polish-fixes/`. Its fixed clocks affect only this
preview. No real projects, notes, or agent calls are used.
