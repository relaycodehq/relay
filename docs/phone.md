# Phone app

`mobile/` is an Expo app that carries most of Relay to a phone, built for the phone rather than squeezed from the desktop UI. It uses the desktop's colours and wording, and draws an agent's turn from the same code (`shared/agent-trace.ts`).

- **Threads:** Activity looks like the desktop's: a card per open thread with its project, state (needs input, working, waiting, sends at, woke up) or age, branch and agent; threads with nothing new fade back, and Snoozed and Settled fold away below. Hold a card to settle or snooze it. Search finds threads by title or project. Each thread streams live, with approvals and questions above the composer (in side conversations too), Resume answer, stopped and pending background work, Implement plan, and images. Answers carry the desktop's copy, fork and reply actions; replies and `/btw` questions open side conversations, listed in the ⋯ menu with rename, done, snooze, archive, compact and worktree changes. Unsent text is kept per thread and reply; scrolling or tapping the thread puts the keyboard away. File names in answers open the turn's diff when the turn changed them, or the file otherwise. "Load earlier" pages back through a long thread, 100 messages at a time. While you're in one thread, another starting to wait on you shows up under the header with a buzz. The header carries CI for the thread's branch, its runs a tap away.
- **Scratchpad:** its own section above Projects, its chats listed directly; New thread starts one in a fresh Scratchpad folder, as the desktop's New chat does.
- **Queue:** while an answer runs, send queues it or ⚡ steers it in. Queued messages send or steer now, go back to the composer with ×, and move or delete on a long press; hold send to send later.
- **Composer:** agent, model and reasoning, Fast or Claude's 200k window, permissions, Plan, up to three photos, the slash menu (Relay's commands and the agent's own commands and skills), and the usage ring with the context window and plan limits.
- **Turn changes:** everything a turn changed, with roll back and redo per file or for all of it; the same for a worktree's branch, which merges into the branch it came from (pushed along when that has a remote). A conflict merges nothing, and the phone offers to ask the agent to resolve it.
- **Themes:** the phone wears the desktop's theme, imported VS Code themes included, in its light or dark mode, or follows the phone's; Settings on the phone chooses.
- **Foldables and tablets:** from 600dp wide, Activity and Projects sit in a sidebar beside the open thread, as on the desktop; the list's button hides it. Diffs can go side by side there, taking the whole width. Phones stay upright; bigger screens turn.
- **New thread:** the Scratchpad or any project, in its checkout or its own worktree.
- **Project icons:** each project wears the icon the desktop finds for it (IDE, app bundle, manifest or favicon), or its folder. The phone keeps them as files and asks at most every ten minutes, sending the hashes it has, so only new or changed icons cross the network.
- **Offline:** the lists and the threads you've opened are kept on the phone and stay readable when the computer can't be reached.
- **Project:** Changes (Commit & push in one step with a written message, or stage and commit a part; push, pull, fetch), branches, Files (read-only, highlighted), History with each commit's diff, and Tasks (stop or restart what agents left running).

## Try it

1. In Relay, open **Settings → Phone** and turn on **Allow phone connections**.
2. Run the app with [Expo Go](https://expo.dev/go) on your phone:

   ```sh
   cd mobile
   npm install
   npx expo start
   ```

   Scan the terminal's QR code with Expo Go (Android) or the Camera app (iOS).

3. In Relay, choose **Pair a phone**, then scan that code from the phone app.

The phone reaches the desktop directly, so both need to be on the same network, or both on a VPN such as Tailscale. Relay lists every address it listens on under the switch; the pairing code carries all of them and the phone tries them in order.

## How it works

The desktop hosts the bridge (`electron/remote/`): a WebSocket server on port 47821 that only listens while phone access is on. `RELAY_REMOTE_PORT` overrides the port.

- **Pairing.** The QR code holds the desktop's addresses, its X25519 public key and a one-time code. The code expires after ten minutes, dies after five wrong guesses, and is traded on first contact for a device token. The desktop stores only the token's SHA-256; the phone keeps it in the OS keystore (`expo-secure-store`). **Settings → Phone** lists paired phones, and removing one disconnects it at once.
- **Encryption.** Every connection runs a Noise NK-style handshake (`shared/remote-crypto.ts`): the phone pins the desktop's key from the QR code, both sides add fresh ephemeral keys, and all frames are sealed with ChaCha20-Poly1305. A phone never talks to a computer other than the one it paired with, and a recorded session can't be replayed. This works on plain Wi-Fi without certificates.
- **What a phone can do.** `RemoteApi` in `shared/remote.ts` is the whole surface: the overview, a thread, a diff as lines, and `phoneDesktopMethods`, an allowlist of the desktop's own calls that go through its dispatch and its validation unchanged. That covers threads, models, Git (stage, commit, push, pull, fetch, branches, merging a worktree's branch; never a force push or a discard), CI status, read-only files, history and background tasks, and only the calls the app uses. Calls that wait on the network, git or a model (`slowPhoneMethods`) get the desktop's two minutes; the rest time out after 15 seconds. Terminals, file saves, settings, sharing and anything that opens a desktop dialog aren't on the list. The phone builds its messages the way the desktop's composer does (`mobile/src/remote/compose.ts`), including the leading `@agent` that makes an agent answer.
- **Live updates.** Chat events stream to the phone, throttled to one update per message every 150 ms while an answer streams. Thread states (working, waiting for you, done) come from a two-second watch that runs only while a phone is connected. A thread sends its latest 100 messages; older ones stay on the desktop.

`shared/remote-client.ts` is the phone's connection, with no React Native in it, so the desktop tests drive the same client against the real bridge. The overview carries the bridge's version; a phone newer than its desktop asks for a restart of Relay.

## Tests

```sh
npx vitest run tests/unit/remote-crypto.test.ts tests/unit/remote-devices.test.ts \
  tests/unit/remote-bridge.test.ts tests/unit/phone-remote.test.ts \
  tests/unit/phone-thread-state.test.ts tests/unit/phone-compose.test.ts
env -u RELAY_DEV_URL npx playwright test e2e/phone-remote.spec
```

The Playwright spec pairs through the real Settings screen, then approves an agent's command, sends a message and removes the phone. `mobile/e2e/run.sh` runs the phone app itself on a booted Android emulator with [Maestro](https://maestro.mobile.dev): it starts a throwaway desktop Relay (`tests/fixtures/phone-desktop.mjs`), Metro and Expo Go, then pairs, starts a supervised thread, approves, answers a question, and commits what the agent changed. Build the desktop first (`npx vite build && node scripts/build-electron.mjs`). `node tests/fixtures/phone-desktop.mjs --seed --host 10.0.2.2` gives you the same desktop with two threads to click through by hand.

## Not there yet

- **Notifications.** Android stops a backgrounded app's socket, so "the agent needs you" has to arrive as a push notification. That needs a development build (`npx expo run:android`) with Firebase set up; Expo Go can't receive remote pushes on Android.
- Creating pull requests stays on the desktop for now.
- Deep reviews and Ultraplan councils show as their messages; starting and steering them stays on the desktop, as do Gitea PR review, shared rooms, terminals and editing files.
