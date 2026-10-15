// Reaction memes for `/meme`. The person sees the picture; the agent gets one
// line of text, the meme's token, which carries what the person means by it.
// The pictures live in a folder in app data, beside memes.json, the list the
// person can edit; built-in entries say where Relay downloads them from.
import { z } from "zod";
import type { AccountProvider, AgentAccountsState } from "./agent-accounts";
import type { ModelChoice } from "./settings";

export const memeIdSchema = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "An id is lowercase words joined by dashes, like sad-pablo.",
  )
  .max(48);

/** One meme as memes.json lists it; fields Relay doesn't know are kept. */
export const memeEntrySchema = z
  .object({
    id: memeIdSchema,
    name: z.string().trim().min(1).max(60).optional(),
    /** What sending it says, as the agent reads it. */
    meaning: z
      .string({ error: "Say what it means: the agent only gets this line." })
      .trim()
      .min(1, "Say what it means: the agent only gets this line.")
      .max(160),
    /** What to search for when there's no page or image to download it from. */
    find: z.string().trim().max(200).optional(),
    /** A web page whose preview image is the meme. */
    page: z.url().optional(),
    /** The image file itself. */
    image: z.url().optional(),
    /** Words Relay writes across the bottom, for a picture without its line. */
    caption: z.string().trim().min(1).max(80).optional(),
  })
  .loose();
export type MemeEntry = z.infer<typeof memeEntrySchema>;

/** Bumped when built-ins are added, so lists saved earlier gain them once. */
export const MEME_LIST_VERSION = 1;

type BuiltIn = MemeEntry & { name: string; since?: number };

const kym = (slug: string) => `https://knowyourmeme.com/memes/${slug}`;

export const builtInMemes: BuiltIn[] = [
  {
    id: "dew-it",
    name: "Dew it",
    meaning: "Yes, go ahead and do it.",
    find: 'Emperor Palpatine saying "Do it" in Star Wars: Revenge of the Sith',
    image: "https://i.imgflip.com/u3u78.jpg",
    caption: "Dew it.",
  },
  {
    id: "perhaps",
    name: "Perhaps",
    meaning: "Hmm, maybe. I'm not convinced yet.",
    find: 'The "Perhaps" cow (Otis from Barnyard)',
    image:
      "https://i.kym-cdn.com/photos/images/newsfeed/001/785/838/937.png",
    caption: "Perhaps.",
  },
  {
    id: "hello-there",
    name: "Hello there",
    meaning: "Hello! Let's get started.",
    find: "Obi-Wan Kenobi, Star Wars",
    page: kym("hello-there"),
    caption: "Hello there.",
  },
  {
    id: "same-picture",
    name: "They're the same picture",
    meaning: "Those look the same to me. I don't see a difference.",
    find: `Pam from The Office: "They're the same picture"`,
    page: kym("theyre-the-same-picture"),
  },
  {
    id: "this-is-the-way",
    name: "This is the way",
    meaning: "Agreed, that's the right approach.",
    find: "The Mandalorian, Star Wars",
    page: kym("this-is-the-way"),
  },
  {
    id: "success-kid",
    name: "Success kid",
    meaning: "Yes! It worked.",
    page: kym("success-kid-i-hate-sandcastles"),
  },
  {
    id: "shut-up-and-take-my-money",
    name: "Shut up and take my money",
    meaning: "Yes, I want that.",
    find: "Fry, Futurama",
    page: kym("shut-up-and-take-my-money"),
  },
  {
    id: "chefs-kiss",
    name: "Chef's kiss",
    meaning: "Perfect, exactly right.",
    find: "Swedish Chef kissing his fingers",
    page: kym("italian-chef-kiss"),
  },
  {
    id: "not-bad",
    name: "Not bad",
    meaning: "Not bad, decent work.",
    find: "Barack Obama \"Not bad\" face",
    page: kym("not-bad-obama-face"),
  },
  {
    id: "stonks",
    name: "Stonks",
    meaning: "Nice, that paid off.",
    page: kym("stonks"),
  },
  {
    id: "mind-blown",
    name: "Mind blown",
    meaning: "Wow, that's impressive.",
    page: kym("mind-blown"),
  },
  {
    id: "unlimited-power",
    name: "Unlimited power",
    meaning: "Go all out on this one.",
    find: "Palpatine, Star Wars",
    page: kym("darth-sidious-unlimited-power"),
  },
  {
    id: "fun-begins",
    name: "This is where the fun begins",
    meaning: "Now the fun part starts.",
    find: "Anakin Skywalker, Star Wars",
    page: kym("this-is-where-the-fun-begins"),
    caption: "This is where the fun begins.",
  },
  {
    id: "kowalski-analysis",
    name: "Kowalski, analysis",
    meaning: "Analyze this for me.",
    find: "Penguins of Madagascar",
    page: kym("kowalski-analysis"),
  },
  {
    id: "visible-confusion",
    name: "Visible confusion",
    meaning: "I don't understand. Can you explain?",
    find: "Obi-Wan Kenobi, Star Wars",
    page: kym("visible-confusion"),
  },
  {
    id: "confused-math-lady",
    name: "Confused math lady",
    meaning: "I'm confused, this doesn't add up.",
    page: kym("math-lady-confused-lady"),
  },
  {
    id: "doubt",
    name: "X to doubt",
    meaning: "I doubt that's true.",
    page: kym("la-noire-doubt-press-x-to-doubt"),
  },
  {
    id: "are-you-sure",
    name: "Are you sure about that?",
    meaning: "Are you sure about that? Double-check it.",
    find: "John Cena",
    page: kym("are-you-sure-about-that"),
    caption: "Are you sure about that?",
  },
  {
    id: "well-yes-but-actually-no",
    name: "Well yes, but actually no",
    meaning: "Partly right, but no.",
    page: kym("well-yes-but-actually-no"),
  },
  {
    id: "one-does-not-simply",
    name: "One does not simply",
    meaning: "It's not that simple.",
    find: "Boromir, Lord of the Rings",
    page: kym("one-does-not-simply-walk-into-mordor"),
  },
  {
    id: "its-a-trap",
    name: "It's a trap",
    meaning: "Careful, that looks like a trap.",
    find: "Admiral Ackbar, Star Wars",
    page: kym("its-a-trap"),
  },
  {
    id: "wait-thats-illegal",
    name: "Wait, that's illegal",
    meaning: "Wait, that shouldn't be possible.",
    page: kym("wait-thats-illegal"),
  },
  {
    id: "we-dont-do-that-here",
    name: "We don't do that here",
    meaning: "No, we don't do that here.",
    find: "T'Challa, Black Panther",
    page: kym("we-dont-do-that-here"),
    caption: "We don't do that here.",
  },
  {
    id: "why-are-you-running",
    name: "Why are you running?",
    meaning: "Why are you doing that? Slow down.",
    page: kym("why-are-you-running"),
    caption: "Why are you running?",
  },
  {
    id: "stop-it-get-some-help",
    name: "Stop it, get some help",
    meaning: "Stop, that's too much.",
    find: "Michael Jordan",
    page: kym("stop-it-get-some-help"),
    caption: "Stop it. Get some help.",
  },
  {
    id: "once-again-asking",
    name: "I am once again asking",
    meaning: "I'm asking again: please do what I asked.",
    find: "Bernie Sanders",
    page: kym("i-am-once-again-asking-for-your-financial-support"),
  },
  {
    id: "fine-ill-do-it-myself",
    name: "Fine, I'll do it myself",
    meaning: "Never mind, I'll do it myself.",
    find: "Thanos, Avengers",
    page: "https://tenor.com/view/thanos-fine-ill-do-it-myself-gif-11168108",
  },
  {
    id: "surprised-pikachu",
    name: "Surprised Pikachu",
    meaning: "Shocked, though I really should have seen that coming.",
    page: kym("surprised-pikachu"),
  },
  {
    id: "this-is-fine",
    name: "This is fine",
    meaning: "Things are on fire, but let's keep going.",
    page: kym("this-is-fine"),
    caption: "This is fine.",
  },
  {
    id: "here-we-go-again",
    name: "Here we go again",
    meaning: "The same problem is back.",
    find: "CJ, GTA San Andreas",
    page: kym("ah-shit-here-we-go-again"),
  },
  {
    id: "facepalm",
    name: "Facepalm",
    meaning: "Oh no, that was a silly mistake.",
    find: "Picard, Star Trek",
    page: kym("facepalm"),
  },
  {
    id: "blinking-guy",
    name: "Blinking guy",
    meaning: "Wait, what?",
    page: kym("blinking-white-guy"),
  },
  {
    id: "monkey-puppet",
    name: "Monkey puppet",
    meaning: "Awkward. I'll pretend I didn't see that.",
    page: kym("monkey-puppet"),
  },
  {
    id: "sweating-jordan-peele",
    name: "Sweating Jordan Peele",
    meaning: "I'm nervous about this.",
    find: "Key & Peele",
    page: kym("sweating-jordan-peele"),
  },
  {
    id: "hide-the-pain-harold",
    name: "Hide the pain Harold",
    meaning: "Fine, I guess. It hurts a little.",
    page: kym("hide-the-pain-harold"),
  },
  {
    id: "modern-problems",
    name: "Modern problems require modern solutions",
    meaning: "Hacky, but it works.",
    find: "Dave Chappelle",
    page: kym("modern-problems-require-modern-solutions"),
    caption: "Modern problems require modern solutions.",
  },
  {
    id: "perfectly-balanced",
    name: "Perfectly balanced",
    meaning: "Perfectly balanced, as all things should be.",
    find: "Thanos, Avengers",
    page: kym("perfectly-balanced"),
  },
  {
    id: "sad-pablo",
    name: "Sad Pablo",
    meaning: "Still waiting, and nothing is happening.",
    find: "Pablo Escobar waiting, Narcos",
    page: kym("pablo-escobar-waiting"),
  },
  {
    id: "coffin-dance",
    name: "Coffin dance",
    meaning: "That's dead. Let it go.",
    page: kym("coffin-dance"),
  },
  {
    id: "ight-imma-head-out",
    name: "Ight imma head out",
    meaning: "I'm done for now. Wrap up.",
    find: "SpongeBob",
    page: kym("ight-imma-head-out"),
  },
];

/** "sad-pablo" reads "Sad pablo", for an entry that names nothing else. */
export const memeName = (m: Pick<MemeEntry, "id" | "name">) =>
  m.name ?? m.id.charAt(0).toUpperCase() + m.id.slice(1).replace(/-/g, " ");

/** Tells the agent a meme is the person joking around, not a task about memes. */
const MEME_SAYS =
  "I'm answering with a reaction meme, a playful way of saying:";

/** The line the agent reads in place of the picture. */
export const memeToken = (m: Pick<MemeEntry, "id" | "meaning">) =>
  `[meme ${m.id}] ${MEME_SAYS} ${m.meaning.replace(/\s*\n+\s*/g, " ").trim()}`;

const tokenPattern = new RegExp(
  `^\\[meme ([a-z0-9]+(?:-[a-z0-9]+)*)\\] ${MEME_SAYS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} ([^\\n]+)$`,
  "gm",
);

/** The memes a sent message's text holds, where they are in it. */
export function memeTokens(text: string) {
  return [...text.matchAll(tokenPattern)].map((m) => ({
    id: m[1]!,
    meaning: m[2]!,
    start: m.index!,
    end: m.index! + m[0].length,
  }));
}

/** `text` with each meme read as what it means, e.g. for a thread's title. */
export const memesAsMeanings = (text: string) =>
  text.replace(tokenPattern, (_, _id: string, meaning: string) => meaning);

/** memes.json as saved: the person may have broken any part of it. */
export type MemeListFile = { builtIn?: number; memes?: unknown[] } & Record<
  string,
  unknown
>;

/**
 * The list with the built-ins added since `builtIn`, each once: one the
 * person deleted stays deleted, and their own edits stay as they are.
 */
export function withNewBuiltIns(file: MemeListFile): {
  file: MemeListFile;
  added: number;
} {
  const from = typeof file.builtIn === "number" ? file.builtIn : 0;
  if (from >= MEME_LIST_VERSION) return { file, added: 0 };
  const memes = Array.isArray(file.memes) ? file.memes : [];
  const ids = new Set(
    memes.map((m) => (m as { id?: unknown } | null)?.id).filter(Boolean),
  );
  const fresh = builtInMemes
    .filter((m) => (m.since ?? 1) > from && !ids.has(m.id))
    .map(({ since: _, ...m }) => m);
  return {
    file: { ...file, builtIn: MEME_LIST_VERSION, memes: [...memes, ...fresh] },
    added: fresh.length,
  };
}

/** The entries Relay can use, and what's wrong with the others, in words. */
export function readMemeList(file: MemeListFile) {
  const memes: MemeEntry[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of (Array.isArray(file.memes) ? file.memes : []).entries()) {
    const parsed = memeEntrySchema.safeParse(raw);
    const label =
      typeof (raw as { id?: unknown } | null)?.id === "string"
        ? `"${(raw as { id: string }).id}"`
        : `Entry ${i + 1}`;
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      problems.push(
        `${label}: ${issue?.path.length ? `${issue.path.join(".")}: ` : ""}${issue?.message ?? "not a meme"}`,
      );
    } else if (seen.has(parsed.data.id)) {
      problems.push(`${label} is listed twice; the first one counts.`);
    } else {
      seen.add(parsed.data.id);
      memes.push(parsed.data);
    }
  }
  return { memes, problems };
}

/** Who sets memes up, on a model that's quick and cheap at it. */
export const memeAgents = {
  codex: {
    provider: "codex",
    label: "GPT-6 Luna",
    choice: { model: "gpt-6-luna", reasoningEffort: "low", fast: false },
  },
  claude: {
    provider: "claude",
    label: "Claude Sonnet 5.5",
    choice: { model: "claude-sonnet-5-5", reasoningEffort: "low", fast: false },
  },
} as const satisfies Record<
  string,
  { provider: AccountProvider; label: string; choice: ModelChoice }
>;
export type MemeAgent = keyof typeof memeAgents;

/**
 * The agent to set memes up with: Codex when it's signed in, as Luna did it
 * for about a cent; else Claude on Sonnet, which a Claude plan pays for in
 * usage limits; else Codex, to sign in to.
 */
export function memeSetupAgent(
  accounts: Pick<AgentAccountsState, "accounts" | "inUse"> | undefined,
): MemeAgent {
  const signedIn = (provider: AccountProvider) =>
    !!accounts?.accounts.some(
      (a) =>
        a.provider === provider &&
        a.id === accounts.inUse[provider] &&
        a.signedIn,
    );
  return signedIn("codex") || !signedIn("claude") ? "codex" : "claude";
}

export interface MemeView {
  id: string;
  name: string;
  meaning: string;
  /** Who or what it shows, which a search finds it by too. */
  find?: string;
  /** Written across the bottom of the picture. */
  caption?: string;
  /** Where the window shows its picture from; none until it's downloaded. */
  url?: string;
}

export interface MemesState {
  /** memes.json exists: memes were set up here. */
  setUp: boolean;
  folder: string;
  list: string;
  memes: MemeView[];
  /** Entries in memes.json Relay can't use, in words. */
  problems: string[];
}

/** What an agent is asked to get the memes without a picture into the folder. */
export function memeSetupPrompt(state: Pick<MemesState, "folder" | "list" | "memes">) {
  const missing = state.memes.filter((m) => !m.url);
  return [
    "Set up my reaction memes for Relay's /meme. When I send one, I see the picture and you get one line of text.",
    "",
    `The meme folder is ${state.folder}. ${state.list} lists each meme: its id, name, what it means, and where its picture is: \`image\` (the file itself) or \`page\` (a web page whose og:image, or twitter:image, is the meme).`,
    "",
    `Download the picture of each meme below into that folder as <id>.<ext>, where ext is jpg, png, gif or webp by what the file really is. Check each download is a picture (for example with \`file\`) and delete anything that isn't. Some sites only send the picture with a browser user agent and \`Accept: */*\`.`,
    "",
    "When a link doesn't work, or a meme has none, search the web for the classic version of that meme (its Know Your Meme or Tenor page is usually best), download it, and put the link you used in memes.json as its `page` or `image`.",
    "",
    "Relay writes a meme's `caption` across the bottom of its picture, so for one with a `caption`, get a still without words on it. A meme known by its line (like \"Hello there\") has to show it: if the picture you got doesn't, set that meme's `caption` to the line. Change nothing else in memes.json and nothing outside the folder.",
    "",
    `Memes to get (${missing.length}): ${missing.map((m) => m.id).join(", ")}`,
    "",
    "Finish with a short list of any you couldn't get.",
  ].join("\n");
}
