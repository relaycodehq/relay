// Set in the main process by launch.cjs, for code run through app.evaluate.
/** Whether a person could see the window: shown, opaque and on the desktop. */
declare var relaySeen: (win: import("electron").BrowserWindow) => boolean;
