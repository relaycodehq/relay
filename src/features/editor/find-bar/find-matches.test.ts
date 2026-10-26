import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { SearchQuery } from "@codemirror/search";
import { MATCH_CAP, findMatches, matchCount, matchFrom, matchNumber } from "./find-matches";

const state = EditorState.create({ doc: "tab tabs Tab\ntab" });

describe("find matches", () => {
  it("counts and numbers the match the selection is on", () => {
    const query = new SearchQuery({ search: "tab" });
    const matches = findMatches(state, query);
    expect(matches.starts).toEqual([0, 4, 9, 13]);
    expect(matchCount(query, matches, matchNumber(matches.starts, EditorSelection.range(9, 12)))).toBe("3/4");
    expect(matchCount(query, matches, matchNumber(matches.starts, EditorSelection.cursor(9)))).toBe("4 results");
  });

  it("follows the toggles", () => {
    expect(findMatches(state, new SearchQuery({ search: "tab", caseSensitive: true, wholeWord: true })).starts).toEqual([0, 13]);
    expect(matchCount(new SearchQuery({ search: "(", regexp: true }), { starts: [], capped: false }, 0)).toBe("Bad pattern");
    expect(matchCount(new SearchQuery({ search: "zzz" }), findMatches(state, new SearchQuery({ search: "zzz" })), 0)).toBe("0 results");
    expect(matchCount(new SearchQuery({ search: "" }), { starts: [], capped: false }, 0)).toBe("0 results");
  });

  it("stops counting at the cap", () => {
    const big = EditorState.create({ doc: "a".repeat(MATCH_CAP + 5) });
    const query = new SearchQuery({ search: "a" });
    const matches = findMatches(big, query);
    expect(matches.capped).toBe(true);
    expect(matchCount(query, matches, 0)).toBe(`${MATCH_CAP}+ results`);
  });

  it("finds onward from the caret, wrapping to the top", () => {
    const query = new SearchQuery({ search: "tab" });
    expect(matchFrom(state, query, 5)).toMatchObject({ from: 9, to: 12 });
    expect(matchFrom(state, query, 14)).toMatchObject({ from: 0, to: 3 });
  });
});
