/** Fence languages that hold commands for a shell. */
const SHELL_LANGS = new Set([
  "sh",
  "bash",
  "zsh",
  "fish",
  "shell",
  "shellscript",
  "console",
  "shellsession",
  "shell-session",
  "powershell",
  "pwsh",
  "ps1",
]);

const SESSION_LANGS = new Set(["console", "shellsession", "shell-session"]);

/**
 * Programs whose name opening a line of code makes it a command. Kept to
 * names that rarely start anything else, since a wrong guess offers to type
 * prose into a shell.
 */
const COMMANDS = new Set(
  `npm npx pnpm pnpx yarn bun bunx deno node tsx corepack nvm volta
  git gh glab cd ls pwd cat head tail grep rg find fd mkdir rm rmdir cp mv
  touch chmod chown ln echo export source open code cursor which env kill
  pkill lsof ps
  python python3 pip pip3 uv uvx poetry pipx pytest ruby gem bundle rails rake
  cargo rustup go make cmake java mvn gradle ./gradlew ./mvnw dotnet swift
  xcodebuild xcrun pod flutter dart expo eas adb php composer
  docker docker-compose podman kubectl helm terraform brew apt apt-get dnf
  yum pacman curl wget ssh scp rsync tar unzip jq sudo
  psql mysql redis-cli sqlite3 claude codex opencode
  vitest jest playwright tsc eslint prettier vite next`.split(/\s+/),
);

/** `NAME=value` set for the one command that follows it. */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=\S*$/;
/** A prompt someone copied along with the command: `$ `, `% `, `PS C:\> `. */
const PROMPT = /^(?:\$|%|PS(?: [^>]*)?>)\s+/;

/**
 * Whether one line reads as a command to run: a known program, perhaps after
 * a prompt and `NAME=value` settings, with at least one argument so a bare
 * `git` naming the tool stays plain.
 */
export function looksLikeCommand(line: string): boolean {
  if (line.includes("\n") || line.length > 400) return false;
  const words = line.replace(PROMPT, "").trim().split(/\s+/);
  while (words.length && ASSIGNMENT.test(words[0]!)) words.shift();
  return words.length >= 2 && COMMANDS.has(words[0]!);
}

/** Inline code that is a command, without its prompt; null when it isn't one. */
export function inlineCommand(code: string): string | null {
  const line = code.trim();
  return looksLikeCommand(line) ? line.replace(PROMPT, "") : null;
}

/**
 * What a fenced block would type at a shell prompt, or null when it doesn't
 * hold commands. Shell blocks give their commands: only the prompted lines
 * when it shows a session with output, and without comments, which zsh would
 * try to run. An unlabelled block counts only as one line that looks like a
 * command; a script (`#!`) is a file, not something to type.
 */
export function blockCommand(code: string, lang?: string): string | null {
  const text = code.replace(/\s+$/, "");
  if (!text.trim()) return null;
  if (!lang) {
    const line = text.trim();
    return looksLikeCommand(line) ? line.replace(PROMPT, "") : null;
  }
  if (!SHELL_LANGS.has(lang.toLowerCase())) return null;
  if (text.trimStart().startsWith("#!")) return null;
  let lines = text.split("\n");
  if (lines.some((line) => PROMPT.test(line))) lines = promptedLines(lines);
  // Without a prompt, a session block is only output.
  else if (SESSION_LANGS.has(lang.toLowerCase())) return null;
  // A heredoc's body is data, blank and `#` lines included.
  if (!text.includes("<<"))
    lines = lines
      .filter((line) => line.trim() && !/^\s*#/.test(line))
      .map(withoutComment);
  return lines.join("\n").trim() || null;
}

/** A session transcript's commands: prompted lines and the lines they continue onto. */
function promptedLines(lines: string[]) {
  const kept: string[] = [];
  let continues = false;
  for (const line of lines) {
    if (PROMPT.test(line)) kept.push(line.replace(PROMPT, ""));
    else if (continues) kept.push(line);
    else continue;
    continues = /\\$/.test(line);
  }
  return kept;
}

/** The line without a trailing ` # comment`, leaving `#` inside quotes or words alone. */
function withoutComment(line: string) {
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (quote) {
      if (char === "\\" && quote === '"') i++;
      else if (char === quote) quote = "";
    } else if (char === "\\") i++;
    else if (char === "'" || char === '"') quote = char;
    else if (char === "#" && i > 0 && /\s/.test(line[i - 1]!))
      return line.slice(0, i).trimEnd();
  }
  return line;
}
