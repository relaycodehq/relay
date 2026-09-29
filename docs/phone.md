# Phone app

`mobile/` is an Expo app that carries most of Relay to a phone, built for the phone rather than squeezed from the desktop UI. It uses the desktop's colours and wording, and draws an agent's turn from the same code (`shared/agent-trace.ts`).

- **Threads:** Activity looks like the desktop's: a card per open thread with its project, state (needs input, working, waiting, sends at, woke up) or age, branch and agent; threads with nothing new fade back, and Snoozed and Settled fold away below. Hold a card to settle or snooze it. Search finds threads by title or project. Each thread streams live, with approvals and questions above the composer (in side conversations too), Resume answer, stopped and pending background work, Implement plan, and images. Answers carry the desktop's copy, fork and reply actions; replies and `/btw` questions open side conversations, listed in the ⋯ menu with rename, done, snooze, archive, compact and worktree changes. Unsent text is kept per thread and reply; scrolling or tapping the thread puts the keyboard away. File names in answers open the turn's diff when the turn changed them, or the file otherwise. "Load earlier" pages back through a long thread, 100 messages at a time. While you're in one thread, another starting to wait on you shows up under the header with a buzz. The header carries CI for the thread's branch, its runs a tap away.
- **Scratchpad:** its own section above Projects, its chats listed directly; New thread starts one in a fresh Scratchpad folder, as the desktop's New chat does.
- **Queue:** while an answer runs, send queues it or ⚡ steers it in. Queued messages send or steer now, go back to the composer with ×, and move or delete on a long press; hold send to send later.
- **Composer:** agent, model and reasoning (Default included), Fast or Claude's 200k window, permissions, Plan, up to three photos, the slash menu (Relay's commands and the agent's own commands and skills, or the / button), and bars under the message box for the context window and plan limits.
- **Sheets:** pickers and menus drag like Android's own: by the grip, or by their content once it's scrolled to the top; a fling or a pull past a third closes them.
- **Turn changes:** everything a turn changed, with roll back and redo per file or for all of it; the same for a worktree's branch, which merges into the branch it came from (pushed along when that has a remote). A conflict merges nothing, and the phone offers to ask the agent to resolve it.
- **Themes:** the phone wears the desktop's theme, imported VS Code themes included, in its light or dark mode, or follows the phone's; Settings on the phone chooses.
- **Foldables and tablets:** from 600dp wide, Activity and Projects sit in a sidebar beside the open thread, as on the desktop; the list's button hides it. Diffs can go side by side there, taking the whole width. Phones stay upright; bigger screens turn.
- **New thread:** the Scratchpad or any project, in its checkout or its own worktree.
- **Project icons:** each project wears the icon the desktop finds for it (IDE, app bundle, manifest or favicon), or its folder. The phone keeps them as files and asks at most every ten minutes, sending the hashes it has, so only new or changed icons cross the network.
- **Offline:** the lists and the threads you've opened are kept on the phone and stay readable when the computer can't be reached.
- **Project:** Changes (Commit & push in one step with a written message, or stage and commit a part; push, pull, fetch), branches, Files (read-only, highlighted), History with each commit's diff, and Tasks (stop or restart what agents left running).

## Install

Android only for now, and over [Tailscale](https://tailscale.com) only: the computer and the phone both need it, signed in to the same tailnet. **Settings → Phone** walks through it. It checks for Tailscale on the computer (and offers the download), then, once **Allow phone connections** is on, lists three steps: Tailscale on the phone (a code for Google Play; when the `tailscale` CLI answers, it also says whether a phone is on the tailnet), the app (**Get the app** downloads the newest `Relay-Android.apk` from the releases repo), and **Show pairing code**, which the app scans.

## Try it from source

1. With Tailscale on the computer and the phone, open **Settings → Phone** in Relay and turn on **Allow phone connections**.
2. Run the app with [Expo Go](https://expo.dev/go) on your phone:

   ```sh
   cd mobile
   npm install
   npx expo start
   ```

   Scan the terminal's QR code with Expo Go (Android) or the Camera app (iOS).

3. In Relay, choose **Show pairing code**, then scan that code from the phone app.

The phone reaches the desktop over the tailnet. Without Tailscale, `RELAY_REMOTE_TAILNET=127.0.0.1` makes the desktop treat loopback as its tailnet, which is what the tests and the Android emulator (reaching the computer as `10.0.2.2`) use.

## How it works

The desktop hosts the bridge (`electron/remote/`): a WebSocket server on port 47821 that only listens while phone access is on. `RELAY_REMOTE_PORT` overrides the port.

- **Tailscale only.** `electron/remote/tailscale.ts` finds this computer on Tailscale: from the `tailscale status --json` of the CLI where Tailscale installs it, or else from the interface carrying Tailscale's own IPv6 prefix (`fd7a:115c:a1e0::/48`), so a hotspot's carrier-grade NAT address in the same 100.64.0.0/10 block doesn't count. The bridge listens on that one address, never on the Wi-Fi, and drops any connection that doesn't come from the tailnet or the computer itself. Phone access won't turn on without Tailscale; if Tailscale goes off later, the bridge stops listening and comes back with it (checked every ten seconds). The pairing code carries only the tailnet address.

- **Pairing.** The QR code holds the desktop's addresses, its X25519 public key and a one-time code. The code expires after ten minutes, dies after five wrong guesses, and is traded on first contact for a device token. The desktop stores only the token's SHA-256; the phone keeps it in the OS keystore (`expo-secure-store`). **Settings → Phone** lists paired phones, and removing one disconnects it at once.
- **Encryption.** Every connection runs a Noise NK-style handshake (`shared/remote-crypto.ts`): the phone pins the desktop's key from the QR code, both sides add fresh ephemeral keys, and all frames are sealed with ChaCha20-Poly1305. A phone never talks to a computer other than the one it paired with, and a recorded session can't be replayed. This works on plain Wi-Fi without certificates.
- **What a phone can do.** `RemoteApi` in `shared/remote.ts` is the whole surface: the overview, a thread, a diff as lines, and `phoneDesktopMethods`, an allowlist of the desktop's own calls that go through its dispatch and its validation unchanged. That covers threads, models, Git (stage, commit, push, pull, fetch, branches, merging a worktree's branch; never a force push or a discard), CI status, read-only files, history and background tasks, and only the calls the app uses. Calls that wait on the network, git or a model (`slowPhoneMethods`) get the desktop's two minutes; the rest time out after 15 seconds. Terminals, file saves, settings, sharing and anything that opens a desktop dialog aren't on the list. The phone builds its messages the way the desktop's composer does (`mobile/src/remote/compose.ts`), including the leading `@agent` that makes an agent answer.
- **Live updates.** Chat events stream to the phone, throttled to one update per message every 150 ms while an answer streams. Thread states (working, waiting for you, done) come from a two-second watch that runs only while a phone is connected. A thread sends its latest 100 messages; older ones stay on the desktop.

- **Updates.** Each release builds a signed APK (the `android` job) and the app's code alone (`scripts/export-phone-bundle.mjs`, Hermes bytecode and its images), which every desktop build carries in `dist-phone/`. The overview offers it to paired phones, and they fetch it over the same encrypted link with `phoneAppFile`, so only the computer a phone paired with can hand it code. `mobile/modules/relay-bundle` checks every file's SHA-256 and points React Native at the new code from the next start ("Tap to restart" does it at once). A version that doesn't reach its first screen is dropped at the next launch and never fetched again, and the phone's Settings can always go back to the version the APK came with. Code only runs on an APK with the same native side: `mobile/scripts/runtime.mjs` fingerprints it (versions aside), and when a desktop's version needs a different one, the phone offers that release's APK to download instead.
- **Signing.** Android installs an update only if it's signed like the installed app, so release APKs use Relay's own key (`mobile/plugins/release-signing.js`, from the `ANDROID_KEYSTORE_BASE64` and `ANDROID_KEYSTORE_PASSWORD` secrets). Builds without it fall back to the debug key; a phone moving between the two has to uninstall first. Losing the key means every phone reinstalls.

`shared/remote-client.ts` is the phone's connection, with no React Native in it, so the desktop tests drive the same client against the real bridge. The overview carries the bridge's version; a phone newer than its desktop asks for a restart of Relay.

## Tests

```sh
npx vitest run tests/unit/remote-crypto.test.ts tests/unit/remote-devices.test.ts \
  tests/unit/remote-bridge.test.ts tests/unit/phone-remote.test.ts \
  tests/unit/phone-thread-state.test.ts tests/unit/phone-compose.test.ts \
  tests/unit/phone-app.test.ts
env -u RELAY_DEV_URL npx playwright test e2e/phone-remote.spec
```

The Playwright spec pairs through the real Settings screen, then approves an agent's command, sends a message and removes the phone. `mobile/e2e/run.sh` runs the phone app itself on a booted Android emulator with [Maestro](https://maestro.mobile.dev): it starts a throwaway desktop Relay (`tests/fixtures/phone-desktop.mjs`), Metro and Expo Go, then pairs, starts a supervised thread, approves, answers a question, and commits what the agent changed. Build the desktop first (`npx vite build && node scripts/build-electron.mjs`). `node tests/fixtures/phone-desktop.mjs --seed --host 10.0.2.2` gives you the same desktop with two threads to click through by hand.

## Not there yet

- **Notifications.** Android stops a backgrounded app's socket, so "the agent needs you" has to arrive as a push notification. That needs a development build (`npx expo run:android`) with Firebase set up; Expo Go can't receive remote pushes on Android.
- Creating pull requests stays on the desktop for now.
- Deep reviews and Ultraplan councils show as their messages; starting and steering them stays on the desktop, as do Gitea PR review, shared rooms, terminals and editing files.
