# Phone app

`mobile/` is an Expo / React Native app for Android and iOS, built for the phone rather than squeezed from the desktop UI. Android has a released APK; iOS currently requires a source build and has been exercised in the simulator, not verified on a physical device. It uses the desktop's colours and wording, and draws an agent's turn from the same code (`shared/agent-trace.ts`).

- **Threads:** Activity looks like the desktop's: a card per open thread with its project, state (needs input, working, waiting, sends at, woke up) or age, branch and agent; threads with nothing new fade back, and Snoozed and Settled fold away below. Hold a card to settle or snooze it. Search finds threads by title or project. Each thread streams live, with approvals and questions above the composer (in side conversations too), Resume answer, stopped and pending background work, Implement plan, and images. Questions an agent leaves in its answer can be answered or dismissed there, and count as waiting on you until then. While the agent continues, its list entry keeps the working indicator and adds “needs input”; live requests that block it still show Needs input. Relay’s `wait_for_threads` keeps waiting while an agent with async questions continues, and returns needs-input once it stops with a question open. A failed answer reads like the desktop's error, a lost login says to sign in on the computer, and pages shown with `show_html` render inline, with variant tabs and interactive controls on current versions. Older bridges show a title and a pointer to the computer instead. While Claude's subagents work, a line over the composer says how many are out and what the newest one is on; it opens a sheet of them, where Stop ends one (after asking) without the turn, and a tap reads that agent's run. Answers carry the desktop's copy, fork and reply actions; replies and `/btw` questions open side conversations, listed in the ⋯ menu with rename, done, snooze, archive, compact and worktree changes. Unsent text is kept per thread and reply; scrolling or tapping the thread puts the keyboard away. File names in answers open the turn's diff when the turn changed them, or the file otherwise. "Load earlier" pages back through a long thread, 100 messages at a time. While you're in one thread, another starting to wait on you shows up under the header with a buzz. The header carries CI for the thread's branch, its runs a tap away.
- **Scratchpad:** its own section above Projects, its chats listed directly; New thread starts one in a fresh Scratchpad folder, as the desktop's New chat does.
- **Queue:** while an answer runs, send queues it or ⚡ steers it in. Queued messages send or steer now, go back to the composer with ×, and move or delete on a long press; hold send to send later.
- **Composer:** agent, model and reasoning (Default included), supported Fast and context-window options, permissions, Plan, up to three photos, the slash menu (Relay's commands and the agent's own commands and skills, or the / button), and bars under the message box for the context window and plan limits.
- **Sheets:** pickers and menus drag like Android's own: by the grip, or by their content once it's scrolled to the top; a fling or a pull past a third closes them.
- **Turn changes:** everything a turn changed, with roll back and redo per file or for all of it; the same for a worktree's branch, which merges into the branch it came from (pushed along when that has a remote). A conflict merges nothing, and the phone offers to ask the agent to resolve it.
- **Themes:** the phone wears the desktop's theme, imported VS Code themes included, in its light or dark mode, or follows the phone's; Settings on the phone chooses.
- **Foldables and tablets:** from 600dp wide, Activity and Projects sit in a sidebar beside the open thread, as on the desktop; the list's button hides it. Diffs can go side by side there, taking the whole width. Phones stay upright; bigger screens turn.
- **New thread:** the Scratchpad or any project, in its checkout or its own worktree.
- **Project icons:** each project wears the icon the desktop finds for it (IDE, app bundle, manifest or favicon), or its folder. The phone keeps them as files and asks at most every ten minutes, sending the hashes it has, so only new or changed icons cross the network.
- **Offline:** the lists and the threads you've opened are kept on the phone and stay readable when the computer can't be reached.
- **Project:** Changes (Commit & push in one step with a written message, or stage and commit a part; push, pull, fetch), branches, Files (read-only, highlighted), History with each commit's diff, and Tasks (stop or restart what agents left running).

## Install

On Android, **Settings → Phone → Get the app** downloads `Relay-Android.apk` from Relay's releases. There is no published iOS build yet; see the source instructions below.

The computer must stay awake and Relay must be running. Choose how the phone reaches it:

- **Tailscale, the default:** install [Tailscale](https://tailscale.com) on both devices and sign in to the same tailnet. This works away from home too.
- **Local network:** enable **Settings → Phone → Local network** on the desktop and put both devices on the same network. Tailscale is optional for this route. Local-network access is off by default.

Turn on **Allow phone connections**, choose **Show pairing code**, then scan that code in the phone app. On iOS, allow local-network access when asked. The phone's **Settings → Reaching …** section chooses whether to try the local network or Tailscale first.

## Try it from source

1. Set up either network route above and turn on **Allow phone connections** in desktop Relay.
2. Install the phone dependencies:

   ```sh
   cd mobile
   npm ci
   ```

3. Build a native development app with `npx expo run:android` (Android SDK/JDK and a device or emulator), or `npx expo run:ios` (macOS, Xcode and an iOS Simulator). A physical iPhone also needs signing configured in Xcode. Rebuild after changing native modules.

   For UI-only work, `npx expo start` also runs in [Expo Go](https://expo.dev/go). Scan the terminal's QR code with Expo Go on Android or the Camera app on iOS. Relay's native dictation, audio playback, Android background notifications and release updater are unavailable there.

4. In desktop Relay, choose **Show pairing code**, then scan that code from the phone app. This is separate from Expo's development-server code.

For local fixtures, `RELAY_REMOTE_TAILNET=127.0.0.1` makes the desktop treat loopback as its tailnet, which is what the tests and the Android emulator (reaching the computer as `10.0.2.2`) use.

## How it works

The desktop hosts the bridge (`electron/remote/`): a WebSocket server on port 47821 that only listens while phone access is on. `RELAY_REMOTE_PORT` overrides the port.

- **Network access.** By default, `electron/remote/tailscale.ts` finds this computer's Tailscale address and the bridge binds to it alone. Without local-network access enabled, losing Tailscale stops the listener until it returns. With **Local network** enabled, the listener binds to all interfaces but accepts only tailnet, loopback, private-network or link-local peers (`electron/remote/lan.ts`); pairing and encryption are still required. Pairing codes include the available routes, and connected devices learn updated addresses. The phone tries its preferred routes first and can switch to a better route without re-pairing.

- **Pairing.** The QR code holds the desktop's addresses, its X25519 public key and a one-time code. The code expires after ten minutes, dies after five wrong guesses, and is traded on first contact for a device token. The desktop stores only the token's SHA-256; the phone keeps it in the OS keystore (`expo-secure-store`). **Settings → Phone** lists paired phones, and removing one disconnects it at once.
- **Encryption.** Every connection runs a Noise NK-style handshake (`shared/remote-crypto.ts`): the phone pins the desktop's key from the QR code, both sides add fresh ephemeral keys, and all frames are sealed with ChaCha20-Poly1305. A phone never talks to a computer other than the one it paired with, and a recorded session can't be replayed. This works on plain Wi-Fi without certificates.
- **What a phone can do.** `RemoteApi` in `shared/remote.ts` is the whole surface: the overview, a thread, a diff as lines, and `phoneDesktopMethods`, an allowlist of the desktop's own calls that go through its dispatch and its validation unchanged. That covers threads, models, Git (stage, commit, push, pull, fetch, branches, merging a worktree's branch; never a force push or a discard), CI status, read-only files, history and background tasks, and only the calls the app uses. Calls that wait on the network, git or a model (`slowPhoneMethods`) get the desktop's two minutes; the rest time out after 15 seconds. Terminals, file saves, desktop settings and anything that opens a desktop dialog aren't on the list. The phone builds its messages the way the desktop's composer does (`shared/remote-compose.ts`), including the leading `@agent` that makes an agent answer.
- **Dictation.** The phone's mic, the computer's speech engine: `mobile/modules/relay-mic` has Android and iOS implementations that record 16 kHz mono PCM in 80 ms chunks, streamed over the encrypted link. The computer's Parakeet worker returns words as they arrive, greyed while they may still change. Tap the mic to start and stop or hold it to talk; the X discards, and sending mid-dictation waits for the last words. The computer needs the model downloaded (**Settings → Dictation**); a phone that stops sending audio for ten seconds loses its session. Expo Go has no Relay microphone module.
- **Read aloud.** The computer generates speech with its downloaded voice and streams it to `mobile/modules/relay-speaker`, which has Android and iOS implementations. On iOS, dictation and playback share an audio session; starting one stops the other. Lock-screen playback and audio-interruption handling exist in the native code but still need physical iPhone validation.
- **Android notifications.** `mobile/modules/relay-watch` uses a foreground service to keep the connection running with the app in the background and post notifications when a thread finishes, fails or needs you. It needs notification permission and a reachable computer; there is no Firebase or hosted push service. This module is unavailable on iOS and in Expo Go.
- **Live updates.** Chat events stream to the phone, throttled to one update per message every 150 ms while an answer streams. Thread states (working, waiting for you, done) come from a two-second watch that runs only while a phone is connected. Subagent reads send the phone's last signature and return no data when unchanged: the focused screen asks every five seconds while work runs, backing off to twenty seconds without changes and sixty after errors, only with the app in front. Lists leave briefs to the run screen. A run's tool output comes cut, as a thread's does. A thread sends its latest 100 messages; older ones stay on the desktop.

- **Android updates.** The Mac mini release pipeline builds a signed APK when the native runtime changes, otherwise reuses the compatible APK. It also exports the app's code (`scripts/export-phone-bundle.mjs`, Hermes bytecode and images) into `dist-phone/` for desktop and headless packages. Paired Android apps fetch compatible code over the encrypted connection; `mobile/modules/relay-bundle` checks each file's SHA-256 and loads it on restart. A bundle that fails to reach its first screen is rolled back on the next launch. Native-runtime changes require a new APK. **Settings → Phone** on the desktop shows each phone's version and update state. iOS does not use this updater; updates require a new native build.
- **New Android apps without the desktop.** The Android app also reads the release feed itself (`latest.json`, checked against the same pinned Ed25519 keys as the desktop, `shared/update-signature.ts`), at start and on coming back to the front, at most every six hours (kept across restarts), with a ten-minute retry after failure; Settings → App has **Look for a new app** and **Update to Relay x**. The feed's `android` entry names the APK's own version and SHA-512, which `mobile/modules/relay-apk` checks before Android sees the file. On an unmetered network a release build downloads it ahead, so a tap goes straight to Android's prompt; on a metered one it waits for the tap. Development builds and Expo Go open the download in the browser.
- **Signing.** Android installs an update only if it's signed like the installed app, so release APKs use Relay's own key (`mobile/plugins/release-signing.js`, from the `ANDROID_KEYSTORE_BASE64` and `ANDROID_KEYSTORE_PASSWORD` secrets). Builds without it fall back to the debug key; a phone moving between the two has to uninstall first. Losing the key means every phone reinstalls.

`shared/remote-client.ts` is the phone's connection, with no React Native in it, so the desktop tests drive the same client against the real bridge. The overview carries the bridge's version; a phone newer than its desktop asks for a restart of Relay.

## Tests

```sh
npx vitest run shared/remote-crypto.test.ts electron/remote/remote-devices.test.ts \
  electron/remote/remote-bridge.test.ts electron/remote/phone-remote.test.ts \
  tests/unit/phone-thread-state.test.ts shared/phone-compose.test.ts \
  electron/remote/phone-app.test.ts
env -u RELAY_DEV_URL npx playwright test e2e/phone-remote.spec
RELAY_DICTATION_MODEL="<model folder>" env -u RELAY_DEV_URL npx playwright test e2e/phone-dictation.spec
```

`phone-dictation.spec` streams a recorded clip through the real bridge into the real speech model; it skips without one. `RELAY_DICTATION_MODEL` also gives `phone-desktop.mjs` the model, so an emulator can dictate against it; the emulator's microphone hears nothing unless its host audio is on.

The Playwright spec pairs through the real Settings screen, then approves an agent's command, sends a message and removes the phone. `mobile/e2e/run.sh` runs the phone app itself on a booted Android emulator with [Maestro](https://maestro.mobile.dev): it starts a throwaway desktop Relay (`tests/fixtures/phone-desktop.mjs`), Metro and Expo Go, then pairs, starts a supervised thread, approves, answers a question, and commits what the agent changed. Build the desktop first (`npx vite build && node scripts/build-electron.mjs`). `node tests/fixtures/phone-desktop.mjs --seed --host 10.0.2.2` gives you the same desktop with two threads to click through by hand. `--asks` adds threads ending on an open question, an error envelope, a lost login and a shown page, which `mobile/e2e/notices.yaml` walks.

## Not there yet

- Published iOS builds, iOS background thread notifications, and physical iPhone validation of audio interruptions and lock-screen playback.
- Creating pull requests stays on the desktop for now.
- Deep reviews show as their messages, and each reviewer as a thread under its review; starting a review stays on the desktop, as do Gitea PR review, terminals and editing files.
