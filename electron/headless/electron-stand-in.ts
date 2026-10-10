// What `electron` is when Relay runs headless under plain Node:
// scripts/build-headless.mjs points every import of "electron" here, so the
// desktop's own services run unchanged. What a server can do has a real
// answer (paths, fetch, sealing secrets); what needs a screen throws and
// says so, which reaches a phone as that call's error.
import { EventEmitter } from "node:events";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { HeadlessImage } from "./image";
import { headlessPaths, relayHome } from "./paths";
import { KeyFile } from "./secrets";
import {
  HeadlessMessageChannel,
  HeadlessUtilityProcess,
} from "./utility-process";
import { headlessVersion } from "./version";

const unavailable = (what: string) =>
  new Error(`${what} isn't available on a headless Relay.`);

let quitting: (() => void) | undefined;
/** What app.quit() does here: the daemon's own shutdown. */
export function onAppQuit(handler: () => void) {
  quitting = handler;
}

class HeadlessApp extends EventEmitter {
  readonly isPackaged = false;
  readonly commandLine = {
    hasSwitch: () => false,
    appendSwitch: () => {},
    getSwitchValue: () => "",
  };
  readonly dock = undefined;
  private name = "Relay";
  getPath(name: string) {
    const home = relayHome();
    switch (name) {
      case "userData":
      case "appData":
        return home;
      case "logs":
        return headlessPaths(home).logs;
      case "crashDumps":
        return join(home, "crashes");
      case "temp":
        return tmpdir();
      case "home":
        return homedir();
      case "downloads":
        return join(homedir(), "Downloads");
      case "exe":
        return process.execPath;
      default:
        throw unavailable(`The ${name} folder`);
    }
  }
  setPath() {}
  setAppLogsPath() {}
  getVersion() {
    return headlessVersion;
  }
  getName() {
    return this.name;
  }
  setName(name: string) {
    this.name = name;
  }
  getAppPath() {
    return __dirname;
  }
  isReady() {
    return true;
  }
  whenReady() {
    return Promise.resolve();
  }
  requestSingleInstanceLock() {
    return true;
  }
  quit() {
    if (quitting) quitting();
    else process.exit(0);
  }
  exit(code = 0) {
    process.exit(code);
  }
  relaunch() {}
  show() {}
  focus() {}
  setBadgeCount() {
    return false;
  }
  setAsDefaultProtocolClient() {
    return false;
  }
}

export const app = new HeadlessApp();

export const net = {
  fetch: (input: string | URL | Request, init?: RequestInit) =>
    fetch(input, init),
  isOnline: () => true,
};

let keys: KeyFile | undefined;
const keyFile = () =>
  (keys ??= new KeyFile(headlessPaths(relayHome()).secretKey));
export const safeStorage = {
  isEncryptionAvailable: () => true,
  isAsyncEncryptionAvailable: async () => true,
  getSelectedStorageBackend: () => "relay_key_file",
  encryptString: (value: string) => keyFile().encrypt(value),
  decryptString: (sealed: Buffer) => keyFile().decrypt(sealed),
  encryptStringAsync: async (value: string) => keyFile().encrypt(value),
  decryptStringAsync: async (sealed: Buffer) => ({
    result: keyFile().decrypt(sealed),
    shouldReEncrypt: false,
  }),
};

export const shell = {
  openExternal: async (_url: string) => {
    throw unavailable("Opening a browser");
  },
  openPath: async (_path: string): Promise<string> => {
    throw unavailable("Opening files");
  },
  showItemInFolder: (_path: string) => {
    throw unavailable("Showing files");
  },
  trashItem: async (_path: string) => {
    throw unavailable("Moving files to the trash");
  },
};

export const dialog = {
  showOpenDialog: async () => {
    throw unavailable("A file dialog");
  },
  showSaveDialog: async () => {
    throw unavailable("A file dialog");
  },
  showMessageBox: async () => {
    throw unavailable("A dialog");
  },
  showMessageBoxSync: () => {
    throw unavailable("A dialog");
  },
  showErrorBox: (title: string, content: string) =>
    console.error(`${title}: ${content}`),
};

export const nativeImage = {
  createEmpty: () => HeadlessImage.empty(),
  createFromPath: (path: string) => HeadlessImage.fromPath(path),
  createFromDataURL: (url: string) => HeadlessImage.fromDataURL(url),
  createFromBuffer: (bytes: Buffer) => HeadlessImage.fromBuffer(bytes),
  createFromBitmap: () => HeadlessImage.empty(),
};

export const nativeTheme = Object.assign(new EventEmitter(), {
  shouldUseDarkColors: true,
  themeSource: "system",
});

export const clipboard = {
  readText: () => {
    throw unavailable("The clipboard");
  },
  writeText: () => {
    throw unavailable("The clipboard");
  },
  write: () => {
    throw unavailable("The clipboard");
  },
};

export class ClipboardItem {
  constructor() {
    throw unavailable("The clipboard");
  }
}

/**
 * Timers don't count the time a computer sleeps, so a check that comes far
 * later than it was due means it slept: that is when "resume" fires.
 */
class HeadlessPowerMonitor extends EventEmitter {
  private timer?: NodeJS.Timeout;
  override on(event: string, listener: (...args: unknown[]) => void) {
    if (event === "resume" && !this.timer) {
      let last = Date.now();
      this.timer = setInterval(() => {
        const now = Date.now();
        if (now - last > 60_000) this.emit("resume");
        last = now;
      }, 15_000);
      this.timer.unref();
    }
    return super.on(event, listener);
  }
  isOnBatteryPower() {
    return false;
  }
  getSystemIdleTime() {
    return 0;
  }
}
export const powerMonitor = new HeadlessPowerMonitor();

export const powerSaveBlocker = {
  start: () => 0,
  stop: () => {},
  isStarted: () => false,
};

export const ipcMain = {
  handle: () => {},
  on: () => {},
  removeHandler: () => {},
};

// Phones bring their own microphone; this computer's is never asked for.
export const systemPreferences = {
  getMediaAccessStatus: () => "denied",
  askForMediaAccess: async () => false,
};

export const crashReporter = { start: () => {} };

export const utilityProcess = {
  fork: (modulePath: string, args?: string[]) =>
    new HeadlessUtilityProcess(modulePath, args),
};

export { HeadlessMessageChannel as MessageChannelMain };

export class BrowserWindow {
  static getAllWindows() {
    return [];
  }
  static fromWebContents() {
    return null;
  }
  static getFocusedWindow() {
    return null;
  }
  constructor() {
    throw unavailable("A window");
  }
}

/** Windows place themselves on screens; with no windows there are none. */
export const screen = {
  getAllDisplays: () => [],
  getPrimaryDisplay: () => {
    throw unavailable("A display");
  },
};

export class WebContentsView {
  constructor() {
    throw unavailable("A browser preview");
  }
}

export const session = {
  fromPartition: () => {
    throw unavailable("Browser storage");
  },
  get defaultSession(): never {
    throw unavailable("Browser storage");
  },
};

// No pages are shown here, so nothing serves them (see electron/html-renders).
export const protocol = {
  registerSchemesAsPrivileged: () => {
    throw unavailable("Showing pages");
  },
};

export class Tray {
  constructor() {
    throw unavailable("The menubar");
  }
}

export const Menu = {
  setApplicationMenu: () => {},
  getApplicationMenu: () => null,
  buildFromTemplate: () => {
    throw unavailable("A menu");
  },
};
