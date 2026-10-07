// The Themes section: a card per built-in theme, drawn in that theme's own
// colours, and the current theme's accent swatches. Picking one re-themes the
// whole site from the point that was clicked (see theme.ts).
import type { CSSProperties, MouseEvent } from "react";
import { Reveal } from "./motion";
import {
  relayDefault,
  sameTheme,
  setSiteTheme,
  siteThemes,
  useSiteTheme,
  type SiteTheme,
} from "./theme";

export function ThemesSection() {
  const { choice, resolved } = useSiteTheme();
  const pick = (next: SiteTheme) => (event: MouseEvent) =>
    setSiteTheme(next, { x: event.clientX, y: event.clientY });
  const accents = [
    ...new Set([resolved.palette.accent, ...resolved.theme.swatches]),
  ];
  return (
    <section className="block" id="themes">
      <Reveal>
        <span className="eyebrow">Make it yours</span>
        <h2>Pick a theme. The page follows.</h2>
        <p className="lede">
          Relay has these themes built in and takes any VS Code theme from Open
          VSX, with your own fonts, sizes and accent. Try one here: the whole
          site changes to it, the way the app does.
        </p>
      </Reveal>
      <div className="themes" role="radiogroup" aria-label="Theme">
        {siteThemes.map(({ theme, kind, name }, index) => {
          const palette = theme[kind]!;
          const on = choice.theme === theme.id && choice.kind === kind;
          return (
            <Reveal key={`${theme.id}-${kind}`} delay={(index % 3) * 60}>
              <button
                type="button"
                role="radio"
                aria-checked={on}
                className="theme-card"
                style={
                  {
                    "--t-sidebar": palette.sidebar,
                    "--t-surface": palette.surface,
                    "--t-text": palette.text,
                    "--t-muted": palette.muted,
                    "--t-border": palette.border,
                    "--t-accent": palette.accent,
                    "--t-send": palette.send ?? palette.accent,
                    "--t-add": palette.diffAddition,
                    "--t-del": palette.diffDeletion,
                  } as CSSProperties
                }
                onClick={pick({ theme: theme.id, kind })}
              >
                <span className="theme-window" aria-hidden="true">
                  <span className="tw-side">
                    <b style={{ width: "70%" }} />
                    <b style={{ width: "55%" }} />
                    <b style={{ width: "62%" }} />
                  </span>
                  <span className="tw-main">
                    <b style={{ width: "58%" }} />
                    <b style={{ width: "34%" }} />
                    <span className="tw-diff">
                      <i />
                      <i />
                    </span>
                    <u />
                  </span>
                </span>
                <strong>
                  {name}
                  <small>{kind}</small>
                </strong>
                <span>{theme.description}</span>
              </button>
            </Reveal>
          );
        })}
      </div>
      <div className="accents">
        <span className="accents-label">Accent</span>
        {accents.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`Accent ${color}`}
            aria-pressed={resolved.accent === color}
            style={{ "--swatch": color } as CSSProperties}
            onClick={pick({
              ...choice,
              ...(color === resolved.palette.accent
                ? { accent: undefined }
                : { accent: color }),
            })}
          />
        ))}
        <span className="accents-note">
          {sameTheme(choice, relayDefault) ? (
            "Relay's own look."
          ) : (
            <button type="button" className="link" onClick={pick(relayDefault)}>
              Back to Relay's own look
            </button>
          )}
        </span>
      </div>
    </section>
  );
}
