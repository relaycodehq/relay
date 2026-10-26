import { expect, it } from "vitest";
import { resolveTheme } from "@pierre/diffs";
import { DARCULA_SYNTAX } from "./darcula-syntax";
import { zedThemeFrom } from "./zed-theme";

it("gives the Highlights lexers Darcula's colours, calls as yellow as declarations", async () => {
  const { zed } = await resolveTheme(DARCULA_SYNTAX, "highlights");
  const syntax = zed!.style.syntax!;
  expect(zed!.appearance).toBe("dark");
  expect(zed!.style["editor.background"]).toBe("#2b2b2b");
  expect(syntax["function.definition"]).toEqual({ color: "#ffc66d" });
  expect(syntax.function).toEqual({ color: "#ffc66d" });
  expect(syntax["comment.doc"]).toEqual({
    color: "#629755",
    font_style: "italic",
  });
});

it("falls back along a token's scopes and leaves unstyled tokens to inherit", () => {
  const theme = zedThemeFrom(
    {
      type: "light",
      tokenColors: [
        { settings: { foreground: "#111111" } },
        {
          scope: "keyword",
          settings: { foreground: "#0000aa", fontStyle: "bold" },
        },
        { scope: "entity.name.type", settings: { foreground: "#008800" } },
      ],
    },
    "sample",
  );
  expect(theme.appearance).toBe("light");
  expect(theme.style.text).toBe("#111111");
  expect(theme.style.syntax!["keyword.import"]).toEqual({
    color: "#0000aa",
    font_weight: 700,
  });
  expect(theme.style.syntax!["type.class"]).toEqual({ color: "#008800" });
  expect(theme.style.syntax!.string).toBeUndefined();
});
