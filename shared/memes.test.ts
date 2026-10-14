import { describe, expect, it } from "vitest";
import {
  builtInMemes,
  MEME_LIST_VERSION,
  memeEntrySchema,
  memeSetupAgent,
  memeSetupPrompt,
  memeToken,
  memeTokens,
  readMemeList,
  withNewBuiltIns,
} from "./memes";

describe("meme tokens", () => {
  it("tells the agent it's a playful answer, and reads back where each one is", () => {
    const dew = memeToken({ id: "dew-it", meaning: "Yes, go ahead and do it." });
    expect(dew).toBe(
      "[meme dew-it] I'm answering with a reaction meme, a playful way of saying: Yes, go ahead and do it.",
    );
    const text = `${dew}\nand also\n${memeToken({ id: "perhaps", meaning: "Maybe." })}`;
    expect(memeTokens(text)).toEqual([
      { id: "dew-it", meaning: "Yes, go ahead and do it.", start: 0, end: dew.length },
      {
        id: "perhaps",
        meaning: "Maybe.",
        start: text.indexOf("[meme perhaps"),
        end: text.length,
      },
    ]);
  });

  it("keeps a meaning with line breaks one line", () => {
    const token = memeToken({ id: "x", meaning: "first\n second]" });
    expect(memeTokens(token)).toEqual([
      expect.objectContaining({ id: "x", meaning: "first second]" }),
    ]);
  });

  it("leaves text that only looks like one alone", () => {
    const real = memeToken({ id: "dew-it", meaning: "Go." });
    for (const text of [
      real.replace("dew-it", "Dew It"),
      "[meme dew-it] Go.",
      `quoting ${real}`,
    ])
      expect(memeTokens(text), text).toEqual([]);
  });
});

describe("the list", () => {
  it("starts with every built-in, each downloadable without an agent", () => {
    const { file, added } = withNewBuiltIns({ memes: [] });
    expect(added).toBe(builtInMemes.length);
    expect(file.builtIn).toBe(MEME_LIST_VERSION);
    const ids = builtInMemes.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of builtInMemes) {
      expect(memeEntrySchema.safeParse(m).success, m.id).toBe(true);
      expect(m.page ?? m.image, m.id).toBeTruthy();
    }
  });

  it("doesn't bring back a built-in the person deleted, or touch their edits", () => {
    const mine = { id: "dew-it", meaning: "Ship it.", page: "https://example.com/x" };
    const saved = { builtIn: MEME_LIST_VERSION, memes: [mine] };
    expect(withNewBuiltIns(saved)).toEqual({ file: saved, added: 0 });
    // A list from before built-ins were versioned keeps its own version of one.
    const old = withNewBuiltIns({ memes: [mine] });
    expect(old.file.memes?.filter((m) => (m as { id: string }).id === "dew-it")).toEqual([mine]);
  });

  it("uses what it can and says what's wrong with the rest", () => {
    const { memes, problems } = readMemeList({
      memes: [
        { id: "sad-pablo", meaning: "Still waiting.", find: "Sad Pablo", note: "kept" },
        { id: "sad-pablo", meaning: "Twice." },
        { id: "no-meaning" },
        { id: "Bad Id", meaning: "x" },
        "junk",
      ],
    });
    expect(memes).toEqual([
      { id: "sad-pablo", meaning: "Still waiting.", find: "Sad Pablo", note: "kept" },
    ]);
    expect(problems).toEqual([
      '"sad-pablo" is listed twice; the first one counts.',
      '"no-meaning": meaning: Say what it means: the agent only gets this line.',
      '"Bad Id": id: An id is lowercase words joined by dashes, like sad-pablo.',
      expect.stringContaining("Entry 5"),
    ]);
  });
});

describe("setting memes up", () => {
  const account = (provider: "claude" | "codex", signedIn: boolean) => ({
    provider,
    id: "default",
    label: provider,
    system: true,
    signedIn,
  });
  const inUse = { claude: "default", codex: "default" };

  it("picks Codex's Luna when it's signed in, else Claude's Sonnet", () => {
    const both = { accounts: [account("claude", true), account("codex", true)], inUse };
    expect(memeSetupAgent(both)).toBe("codex");
    const claude = { accounts: [account("claude", true), account("codex", false)], inUse };
    expect(memeSetupAgent(claude)).toBe("claude");
    expect(memeSetupAgent({ accounts: [], inUse })).toBe("codex");
    expect(memeSetupAgent(undefined)).toBe("codex");
  });

  it("asks only for the memes without a picture", () => {
    const prompt = memeSetupPrompt({
      folder: "/data/memes",
      list: "/data/memes/memes.json",
      memes: [
        { id: "dew-it", name: "Dew it", meaning: "Go.", url: "relay-media://x" },
        { id: "perhaps", name: "Perhaps", meaning: "Maybe." },
        { id: "sad-cat", name: "Sad cat", meaning: "Sad." },
      ],
    });
    expect(prompt).toContain("The meme folder is /data/memes.");
    expect(prompt).toContain("Memes to get (2): perhaps, sad-cat");
  });
});

it("names a thread that starts with a meme after what it means", async () => {
  const { promptTitle } = await import("./prompt-title");
  expect(promptTitle(memeToken({ id: "dew-it", meaning: "Yes, go ahead and do it." }))).toBe(
    "Yes, go ahead and do it.",
  );
});
