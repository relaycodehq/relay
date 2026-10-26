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
    const { textmate } = await resolveTheme(palette.syntax, "shiki-js");
    const { zed } = await resolveTheme(palette.syntax, "highlights");
    const zedColours = Object.values(zed?.style.syntax ?? {}).map((style) =>
      typeof style === "string" ? style : style.color,
    );
    for (const colours of [
      (textmate?.settings ?? []).map((s) => s.settings?.foreground),
      zedColours,
    ]) {
      const solid = colours.filter((c): c is string =>
        /^#[0-9a-f]{6}$/i.test(c ?? ""),
      );
      expect(solid.length).toBeGreaterThan(5);
      for (const bg of [palette.surface, palette.inbox])
        for (const colour of solid)
          expect(
            contrastRatio(colour, bg),
            `${colour} on ${bg}`,
          ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
