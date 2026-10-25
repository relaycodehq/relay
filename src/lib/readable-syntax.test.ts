import { describe, expect, it } from "vitest";
import { resolveTheme } from "@pierre/diffs";
import "./readable-syntax";
import { readableSyntaxBase } from "./builtin-themes";
import { contrastRatio, themesFor } from "./themes";

const light = themesFor("light").map((t) => [t.name, t.light!] as const);

describe.each(light)("%s", (_, palette) => {
  it("keeps secondary text at AA on every background it sits on", () => {
    for (const bg of [
      palette.sidebar,
      palette.toolbar,
      palette.surface,
      palette.inbox,
    ])
      expect(contrastRatio(palette.muted, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("colours code at AA on its own backgrounds", async () => {
    expect(readableSyntaxBase(palette.syntax)).not.toBeNull();
    const theme = await resolveTheme(palette.syntax);
    const colours = (theme.settings ?? [])
      .map((s) => s.settings?.foreground)
      .filter((c): c is string => /^#[0-9a-f]{6}$/i.test(c ?? ""));
    expect(colours.length).toBeGreaterThan(5);
    for (const bg of [palette.surface, palette.inbox])
      for (const colour of colours)
        expect(
          contrastRatio(colour, bg),
          `${colour} on ${bg}`,
        ).toBeGreaterThanOrEqual(4.5);
  });
});
