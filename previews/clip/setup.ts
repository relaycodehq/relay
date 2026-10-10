// Runs before the tip memory loads: a returning user, a first run with
// ?intro, or one tip on its own with ?tip=<id> (every other one done).
import { tips } from "../../src/features/tips/tip-list";

const params = new URLSearchParams(location.search);
export const intro = params.has("intro");
export const only = params.get("tip");
if (intro) localStorage.removeItem("relay-tips");
else
  localStorage.setItem(
    "relay-tips",
    JSON.stringify({
      introSeen: true,
      done: only ? tips.map((t) => t.id).filter((id) => id !== only) : [],
    }),
  );
localStorage.removeItem("relay-used");
localStorage.setItem("preview-watch-threads", "off");
