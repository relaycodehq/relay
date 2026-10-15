// Writes the Kotlin app's third-party notices, which it shows under
// Settings → Open-source licences: every library in the release APK, grouped
// by licence, with the licence texts, plus the files bundled as assets.
//
//   node scripts/android-notices.mjs           rewrite the asset
//   node scripts/android-notices.mjs --check   exit 1 when it's out of date
//
// Libraries come from Gradle's release runtime classpath and their licences
// from the POMs in Gradle's cache (run a build first). A licence that isn't
// Apache 2.0, Google's terms or listed in `texts` fails, so a new dependency
// gets looked at before it ships.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const android = join(repo, "android");
const licences = join(android, "licences");
const main = join(android, "app/src/main");
const out = join(main, "assets/third-party-notices.txt");
const cache = join(homedir(), ".gradle/caches/modules-2/files-2.1");

// Libraries under their own licence text, by group or group:artifact.
const texts = {
  "org.bouncycastle": { title: "Bouncy Castle", file: "bouncy-castle.txt" },
  "org.commonmark": { title: "commonmark-java", file: "commonmark-java.txt" },
  "org.nibor.autolink": { title: "autolink-java", file: "autolink-java.txt" },
  "androidx.datastore:datastore-preferences-external-protobuf": {
    title: "Protocol Buffers, as bundled by AndroidX DataStore",
    file: "protobuf.txt",
  },
};
const googleTerms = /android software development kit license|ml kit terms/i;

function dependencies() {
  const env = {
    JAVA_HOME: "/opt/homebrew/opt/openjdk@21",
    ANDROID_HOME: join(homedir(), "Library/Android/sdk"),
    ...process.env,
  };
  const tree = execFileSync(
    "./gradlew",
    ["-q", ":app:dependencies", "--configuration", "releaseRuntimeClasspath"],
    { cwd: android, env, encoding: "utf8", maxBuffer: 64 << 20 },
  );
  const found = new Map();
  for (const line of tree.split("\n")) {
    if (/\((c|n)\)\s*$/.test(line)) continue;
    const m = line.match(
      /[+\\]--- ([\w.-]+):([\w.-]+)(?::([\w.-]+))?(?: -> ([\w.-]+))?/,
    );
    if (!m) continue;
    const version = m[4] ?? m[3];
    if (version) found.set(`${m[1]}:${m[2]}`, version);
  }
  return [...found].map(([id, version]) => ({ id, version })).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
}

function pom(group, artifact, version) {
  const dir = join(cache, group, artifact, version);
  if (!existsSync(dir)) return null;
  for (const hash of readdirSync(dir)) {
    const file = join(dir, hash, `${artifact}-${version}.pom`);
    if (existsSync(file)) return readFileSync(file, "utf8");
  }
  return null;
}

function licenceOf(group, artifact, version) {
  const xml = pom(group, artifact, version);
  if (!xml) throw new Error(`No POM for ${group}:${artifact}:${version} in ${cache}`);
  const block = xml.match(/<licenses>([\s\S]*?)<\/licenses>/)?.[1];
  const name = block?.match(/<name>\s*([^<]*?)\s*<\/name>/)?.[1];
  if (name) return name;
  const parent = xml.match(/<parent>([\s\S]*?)<\/parent>/)?.[1];
  if (!parent) return null;
  const tag = (t) => parent.match(new RegExp(`<${t}>\\s*([^<]*?)\\s*</${t}>`))?.[1];
  return licenceOf(tag("groupId"), tag("artifactId"), tag("version"));
}

// Licence files are hard-wrapped; the phone wraps them itself.
function reflow(text) {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => {
      let joined = "";
      let alone = false;
      for (const raw of paragraph.split("\n")) {
        const line = raw.trim();
        if (!line) continue;
        // Rules and short all-caps lines are headings and stay on their own.
        const heading = /^-{3,}$/.test(line) || (line.length < 40 && !/[a-z]/.test(line));
        const starts =
          heading ||
          alone ||
          /^(\d+[.)]|\([a-z0-9]+\)|[*•-] |Copyright [(©\d]|All rights reserved|Permission is hereby)/.test(line);
        joined += joined && !starts ? ` ${line}` : `${joined ? "\n" : ""}${line}`;
        alone = heading;
      }
      return joined;
    })
    .join("\n\n");
}

const read = (path) => readFileSync(path, "utf8");
const section = (title, ...parts) =>
  [`# ${title}`, ...parts.filter(Boolean)].join("\n\n");
const list = (deps) => deps.map((d) => `${d.id} ${d.version}`).join("\n");

const apache = [];
const google = [];
const own = new Map();
for (const dep of dependencies()) {
  const [group, artifact] = dep.id.split(":");
  const named = texts[dep.id] ?? texts[group];
  if (named) {
    own.set(named, [...(own.get(named) ?? []), dep]);
    continue;
  }
  const licence = licenceOf(group, artifact, dep.version);
  if (/apache/i.test(licence ?? "")) apache.push(dep);
  else if (googleTerms.test(licence ?? "")) google.push(dep);
  else throw new Error(`${dep.id} ${dep.version}: licence "${licence}" isn't handled; add it to texts`);
}

const katex = read(join(main, "assets/katex/VERSION")).trim();
const notices = [
  section(
    "Relay for Android",
    "Relay is released under the MIT License. This app contains the work of others listed here, under the licences that follow.",
  ),
  section(`KaTeX ${katex}`, "Math rendering, with its fonts.", reflow(read(join(licences, "katex.txt")))),
  section(
    "Tabler Icons",
    "The icon artwork, through io.github.lyxnx.compose.ui:tabler-icons (Apache License 2.0, below).",
    reflow(read(join(licences, "tabler-icons.txt"))),
  ),
  section("Inter", reflow(read(join(main, "res/raw/license_inter.txt")))),
  section("JetBrains Mono", reflow(read(join(main, "res/raw/license_jetbrains_mono.txt")))),
  ...[...own].map(([{ title, file }, deps]) =>
    section(title, list(deps), reflow(read(join(licences, file)))),
  ),
  google.length &&
    section(
      "Google Play services and ML Kit",
      list(google),
      "Not open source. Provided under the ML Kit Terms of Service (https://developers.google.com/ml-kit/terms) and the Android Software Development Kit License (https://developer.android.com/studio/terms).",
    ),
  section("Apache License 2.0", list(apache), reflow(read(join(licences, "apache-2.0.txt")))),
]
  .filter(Boolean)
  .join("\n\n")
  .concat("\n");

if (process.argv.includes("--check")) {
  if (!existsSync(out) || read(out) !== notices) {
    console.error(`${out} is out of date: run node scripts/android-notices.mjs`);
    process.exit(1);
  }
  console.log("Android notices are up to date.");
} else {
  writeFileSync(out, notices);
  console.log(
    `${out}: ${apache.length} Apache, ${google.length} Google, ${[...own.values()].flat().length} other libraries.`,
  );
}
