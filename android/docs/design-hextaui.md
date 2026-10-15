HextaUI is shadcn/ui ("base-vega" style, neutral base colour) rebuilt on Base UI with Tabler icons. The values below come straight from `app/globals.css` and `components/ui/*.tsx` in `github.com/preetsuthar17/HextaUI` (shallow clone at `/tmp/hextaui-src/repo`). The colours are the same as shadcn's; what makes it look different is the hairline borders, the smaller type scale and the toned-down destructive and badge styles.

## Colors (oklch, hex in brackets)
| Token | Light | Dark |
|---|---|---|
| background | 1 0 0 (#ffffff) | 0.145 (#0a0a0a) |
| foreground | 0.145 (#0a0a0a) | 0.985 (#fafafa) |
| card / popover | #ffffff | 0.205 (#171717) |
| primary / on | 0.205 (#171717) / #fafafa | 0.922 (#e5e5e5) / #171717 |
| secondary = muted = accent | 0.97 (#f5f5f5) | 0.269 (#262626) |
| muted-foreground | **0.535 (#6d6d6d)**, darker than shadcn's #737373 | 0.708 (#a1a1a1) |
| border / input | 0.922 (#e5e5e5) | white at 10% / white at 15% |
| ring | #a1a1a1 | #737373 |
| destructive | 0.53 0.22 27.3 (#cd000f) | 0.704 0.191 22.2 (#ff6467), on-colour #171717 |
| success | 0.527 0.154 150 (#008235) | 0.792 0.209 151.7 (#05df72) |
| info | 0.546 0.215 262 (#1f64eb) | 0.707 0.165 254.6 (#50a2ff) |
| warning | 0.555 0.163 49 (#bb4d00) | 0.828 0.189 84.4 (#ffb900) |
| sidebar | 0.985 (#fafafa) | #171717, sidebar-primary #1447e6 |
| chart 1–5 | #2978d6 #1a9e70 #c98500 #4a3aa7 #d55181 | 1: #3e85dc (approx.), 4: #8a7fd8 (approx.), others the same |

- **Focus ring:** foreground at 40% alpha, 3px wide, plus a hairline inner ring in `ring`.
- **Hover:** foreground mixed in at 4–5%.

## Shape
- **Radius:** `--radius` is 0.8rem (12.8dp). sm 7.7, md 10.2, lg 12.8, xl 17.9, 2xl 23. Nested corners use outer radius minus inset.
- **Hairline borders:** 1 physical pixel (0.5px at 2x, 0.33px at 3x). In Compose that's `1.dp / density`, so about 0.33–0.4dp on phones.
- **Borders are inset rings, not layout borders.** Cards, popovers and toasts use foreground at 10%. Tabs use foreground at 5%. Avatars and media use foreground at 10% (5% for item media).
- **Shadows** only on floating layers (drawer, toast, `shadow-lg`) and the floating sidebar (`shadow-sm`). Cards have no shadow.

## Typography
- **Font:** system (`-apple-system`, then Inter). On Android use Inter. Mono is Paper Mono.
- **Scale is shifted 1px down from Tailwind:** xs 11, sm **13 (the body default)**, base 15, lg 17, xl 19, 2xl 23, 3xl 29, 4xl 35, 5xl 47. Hero text maxes out at 43 with line-height 1.3.
- **Weights:** 500 for labels, buttons and titles; 600 only for dialog titles; a custom "book" weight of 520.
- **Tracking:** `tracking-tight` (-0.025em) only on empty-state titles and headings. Keyboard shortcut hints use `tracking-widest`.
- Inputs on touch screens use 16sp.

## Spacing
Tailwind's 4dp grid. Card padding 24 (sm: 16). Item padding 16×14, sm 12×10, xs 10×8. Empty state padding 48 (sm: 24).

## Components
- **Buttons:** heights 36 (default), 24 xs, 32 sm, 40 lg; padding-x 10; gap 6; 13sp at 500; icons 16; radius md (sm size caps at 10).
  - **default:** primary fill, hover to 80% opacity.
  - **secondary:** muted fill.
  - **outline:** background fill with a hairline border ring (dark: input colour at 30%).
  - **ghost:** hover fills muted.
  - **destructive is a tint, not a solid fill:** destructive at 10% (dark 20%) with destructive-coloured text.
  - Extra variants: ghost-destructive, success, error (shakes), and a pill shape.
  - **Press:** moves down 1px and scales to 0.97. There are built-in loading, success and error states that flip in with a 3D rotateX.
- **Cards:** card fill + hairline ring, radius xl (17.9), padding and gap 24. Title is 15sp at 500; description is 13sp muted. Other variants: `outline` (transparent) and `muted` (muted fill, no ring).
- **Lists (Item / ItemGroup):** one card with a hairline ring and radius xl, rows inside with hairline dividers. Media tile is 40dp, muted fill. Hover/selected highlight is muted at 60%. Selected rows get a muted fill plus a ring.
- **Inputs:** height 36, padding-x 12, transparent fill (dark: input colour at 30%), hairline ring in `input` colour. Hover darkens the ring to `ring` at 70%. Errors show a destructive ring and shake. There's a character counter.
- **Badges:** **the default is outline**: background fill, hairline border, foreground text, with the icon or dot tinted (success, info, warning or destructive). Solid and muted versions exist. Heights 18, 20 and 24; radius 5, 6 and 7 (squarish, pill optional); 11–12sp at 500.
- **Tabs:**
  - **Segmented:** muted track with 3dp padding and radius lg. The active tab slides along as a background-filled pill with a 5% ring, triggers are 32 high.
  - **Line:** hairline bottom rule with a 2dp foreground indicator; tabs are 40 high.
  - The indicator slides over 300ms with ease-out-quint.
- **Dialogs:** popover fill, radius xl, padding 24. Title 17sp at 600. Buttons go on the right, stacked on mobile. Enter: fade from opacity 0 and scale from 0.96, 200ms.
- **Drawers:** radius 2xl (23) on the leading edge, popover fill + ring + `shadow-lg`. Easing is `cubic-bezier(0.32, 0.72, 0, 1)` over 300ms. Nested drawers stack, each one scaling down 0.05; the backdrop blurs.
- **Toasts:** radius xl, padding 16, gap 12, 16dp icon, 13sp text. Toasts stack with a 10dp peek, each one scaling down 6%. The close button only shows on hover.
- **Command menu:** radius xl. Search row is 44 high with a hairline divider under it. Rows have a 6dp inset, min height 36, padding 10×6, and are highlighted with a muted fill. Group headings are 11sp, 500, muted.
- **Sidebar:** 16rem (256dp) wide, 48dp when collapsed to icons, 18rem on mobile. A hairline sits on its right edge. Other variants: floating (radius xl + `shadow-sm`) and inset.
- **Empty states:** 40dp media tile on a muted fill with radius lg. There's also a signature **three-card fan**: two cards behind tilted ±10°, offset 28% and scaled to 0.9. Title 17sp at 500, tight tracking. Content fades up 6dp and un-blurs 2px over 480ms, staggered 0/60/110ms.
- **Skeletons:** muted fill, radius md. A shimmer sweeps a foreground band at 8% (dark 10%) across every 1.6s.
- **Avatars:** 24, 32 or 40dp, circle or rounded square, muted fill, hairline inner ring at 10%. Status badge has a 2dp ring in the background colour and a pulse.
- **Accordions:** bordered with radius lg, hairline row dividers, rows padded 16. The chevron rotates on a spring.
- **Chat:** user message is a muted bubble with radius around 16; the assistant message is plain text with no bubble. Prompt input is pill-shaped with a round send button.

## Motion
- **Easing:** ease-out-quint `(0.23, 1, 0.32, 1)` for most things; a spring curve `linear(...)` for accordions and messages.
- **Speed:** 150–220ms. Messages enter with a 420ms spring, moving up 8dp and scaling from 0.96.

## What sets it apart from shadcn
1. Borders are hairline rings (one physical pixel) instead of 1px borders.
2. The type scale is 1px smaller (13sp body).
3. Radius is 12.8 instead of 10.
4. Destructive buttons are tinted, not solid.
5. Badges default to outline with a coloured dot.
6. Success, info and warning tokens are added.
7. Interactions are tactile: press-scale, invalid-shake, async button states.
8. Toasts and drawers stack.
9. Muted text is darker.
10. Everything is greyscale; colour only shows up in status.

## Blocks
There are 22 blocks, all paid Pro except Prompt Input:
- **Chat and AI:** agent-todos, chat-thread, chat-sidebar, prompt-input, streaming, thinking, tool-calls, artifact (chat on the left, code/preview panel on the right), diff-review, code-block, markdown, models, voice-mode, hexta-ai.
- **Settings and account:** settings, profile, appearance, security, billing, team, api-keys, notifications.

The site and blocks are shown in dark mode by default.

**Screenshots** (taken with headless Chrome, which loaded the dark theme):
- `/tmp/hextaui/home.png`
- `/tmp/hextaui/blocks.png`
- `/tmp/hextaui/components-index.png`
- `/tmp/hextaui/components-button.png`
- `/tmp/hextaui/components-card.png`
- `/tmp/hextaui/components-sidebar.png`

## Gaps
- Two of the hex conversions (dark chart-1 and chart-4) are approximate.
- Light destructive is out of sRGB gamut, so #cd000f is clamped. #dc2626 is a safe stand-in.
- I only looked at `blocks.png` and one 404 page (since deleted). The other screenshots are unchecked, so an old `components/<name>` URL may also be a 404.
- The block layouts aren't in the open repo. The ones above come from the blocks page and its one screenshot.