/**
 * An editor or IDE Relay looks for, and where it's installed on each system.
 * One without an entry for a system isn't looked for there.
 */
export interface KnownApp {
  id: string;
  name: string;
  /** Bundle names in an Applications folder. */
  mac?: string[];
  /** Programs under Windows' install folders, written `%LOCALAPPDATA%/…`. */
  windows?: string[];
  jetbrains?: JetBrainsInstall;
  /** Commands on PATH. */
  linux?: string[];
}

/**
 * Where a JetBrains IDE is on Windows, its program in `bin` each time: its
 * own installer's `%ProgramFiles%/JetBrains/<folder> <version>`, Toolbox 2's
 * `%LOCALAPPDATA%/Programs/<folder>`, or Toolbox 1's
 * `%LOCALAPPDATA%/JetBrains/Toolbox/apps/<toolbox>/ch-0/<build>`.
 */
export interface JetBrainsInstall {
  folders: string[];
  toolbox: string;
  exe: string;
}

/** In the order they're offered; the first found is the button's until the user picks. */
export const knownApps: KnownApp[] = [
  {
    id: "cursor",
    name: "Cursor",
    mac: ["Cursor.app"],
    windows: [
      "%LOCALAPPDATA%/Programs/cursor/Cursor.exe",
      "%ProgramFiles%/cursor/Cursor.exe",
    ],
    linux: ["cursor"],
  },
  {
    id: "vscode",
    name: "VS Code",
    mac: ["Visual Studio Code.app"],
    windows: [
      "%LOCALAPPDATA%/Programs/Microsoft VS Code/Code.exe",
      "%ProgramFiles%/Microsoft VS Code/Code.exe",
    ],
    linux: ["code"],
  },
  {
    id: "vscode-insiders",
    name: "VS Code Insiders",
    mac: ["Visual Studio Code - Insiders.app"],
    windows: [
      "%LOCALAPPDATA%/Programs/Microsoft VS Code Insiders/Code - Insiders.exe",
      "%ProgramFiles%/Microsoft VS Code Insiders/Code - Insiders.exe",
    ],
    linux: ["code-insiders"],
  },
  {
    id: "vscodium",
    name: "VSCodium",
    mac: ["VSCodium.app"],
    windows: [
      "%LOCALAPPDATA%/Programs/VSCodium/VSCodium.exe",
      "%ProgramFiles%/VSCodium/VSCodium.exe",
    ],
    linux: ["codium"],
  },
  {
    id: "windsurf",
    name: "Windsurf",
    mac: ["Windsurf.app"],
    windows: ["%LOCALAPPDATA%/Programs/Windsurf/Windsurf.exe"],
    linux: ["windsurf"],
  },
  {
    id: "antigravity",
    name: "Antigravity",
    mac: ["Antigravity.app"],
    windows: ["%LOCALAPPDATA%/Programs/Antigravity/Antigravity.exe"],
    linux: ["antigravity"],
  },
  {
    id: "zed",
    name: "Zed",
    mac: ["Zed.app", "Zed Preview.app"],
    windows: ["%LOCALAPPDATA%/Programs/Zed/Zed.exe"],
    // Arch and Fedora package it as `zeditor`.
    linux: ["zed", "zeditor"],
  },
  {
    id: "sublime",
    name: "Sublime Text",
    mac: ["Sublime Text.app"],
    windows: [
      "%ProgramFiles%/Sublime Text/sublime_text.exe",
      "%ProgramFiles%/Sublime Text 3/sublime_text.exe",
    ],
    linux: ["subl"],
  },
  {
    id: "phpstorm",
    name: "PhpStorm",
    mac: ["PhpStorm.app", "PhpStorm EAP.app"],
    jetbrains: {
      folders: ["PhpStorm"],
      toolbox: "PhpStorm",
      exe: "phpstorm64.exe",
    },
    linux: ["phpstorm"],
  },
  {
    id: "webstorm",
    name: "WebStorm",
    mac: ["WebStorm.app", "WebStorm EAP.app"],
    jetbrains: {
      folders: ["WebStorm"],
      toolbox: "WebStorm",
      exe: "webstorm64.exe",
    },
    linux: ["webstorm"],
  },
  {
    id: "idea",
    name: "IntelliJ IDEA",
    mac: ["IntelliJ IDEA.app", "IntelliJ IDEA Ultimate.app"],
    jetbrains: {
      folders: ["IntelliJ IDEA", "IntelliJ IDEA Ultimate"],
      toolbox: "IDEA-U",
      exe: "idea64.exe",
    },
    linux: ["idea", "intellij-idea-ultimate"],
  },
  {
    id: "idea-ce",
    name: "IntelliJ IDEA CE",
    mac: ["IntelliJ IDEA CE.app", "IntelliJ IDEA Community Edition.app"],
    jetbrains: {
      folders: ["IntelliJ IDEA Community Edition"],
      toolbox: "IDEA-C",
      exe: "idea64.exe",
    },
    linux: ["intellij-idea-community"],
  },
  {
    id: "pycharm",
    name: "PyCharm",
    mac: ["PyCharm.app", "PyCharm Professional Edition.app"],
    jetbrains: {
      folders: ["PyCharm", "PyCharm Professional"],
      toolbox: "PyCharm-P",
      exe: "pycharm64.exe",
    },
    linux: ["pycharm", "pycharm-professional"],
  },
  {
    id: "pycharm-ce",
    name: "PyCharm CE",
    mac: ["PyCharm CE.app", "PyCharm Community Edition.app"],
    jetbrains: {
      folders: ["PyCharm Community Edition"],
      toolbox: "PyCharm-C",
      exe: "pycharm64.exe",
    },
    linux: ["pycharm-community"],
  },
  {
    id: "goland",
    name: "GoLand",
    mac: ["GoLand.app"],
    jetbrains: { folders: ["GoLand"], toolbox: "Goland", exe: "goland64.exe" },
    linux: ["goland"],
  },
  {
    id: "rustrover",
    name: "RustRover",
    mac: ["RustRover.app"],
    jetbrains: {
      folders: ["RustRover"],
      toolbox: "RustRover",
      exe: "rustrover64.exe",
    },
    linux: ["rustrover"],
  },
  {
    id: "rider",
    name: "Rider",
    mac: ["Rider.app"],
    jetbrains: {
      folders: ["JetBrains Rider", "Rider"],
      toolbox: "Rider",
      exe: "rider64.exe",
    },
    linux: ["rider"],
  },
  {
    id: "clion",
    name: "CLion",
    mac: ["CLion.app"],
    jetbrains: { folders: ["CLion"], toolbox: "CLion", exe: "clion64.exe" },
    linux: ["clion"],
  },
  {
    id: "rubymine",
    name: "RubyMine",
    mac: ["RubyMine.app"],
    jetbrains: {
      folders: ["RubyMine"],
      toolbox: "RubyMine",
      exe: "rubymine64.exe",
    },
    linux: ["rubymine"],
  },
  {
    id: "fleet",
    name: "Fleet",
    mac: ["Fleet.app"],
    windows: ["%LOCALAPPDATA%/Programs/Fleet/Fleet.exe"],
    linux: ["fleet"],
  },
  {
    id: "android-studio",
    name: "Android Studio",
    mac: ["Android Studio.app", "Android Studio Preview.app"],
    windows: [
      "%ProgramFiles%/Android/Android Studio/bin/studio64.exe",
      "%LOCALAPPDATA%/Programs/Android Studio/bin/studio64.exe",
    ],
    linux: ["android-studio", "studio"],
  },
  { id: "xcode", name: "Xcode", mac: ["Xcode.app", "Xcode-beta.app"] },
  { id: "nova", name: "Nova", mac: ["Nova.app"] },
  { id: "textmate", name: "TextMate", mac: ["TextMate.app"] },
  { id: "bbedit", name: "BBEdit", mac: ["BBEdit.app"] },
];
