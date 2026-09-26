# Phone app

`mobile/` is an Expo app for following threads from a phone: see what each agent is doing, approve its commands, answer its questions, send follow-ups, start threads and read the diffs a turn made. It is built for the phone rather than squeezed from the desktop UI, and uses the desktop's colours, wording and activity labels.

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
- **What a phone can do.** `RemoteApi` in `shared/remote.ts` is the whole surface: the thread list, a thread, send, start, stop, answer a request, a turn's diff, and settling a thread. Terminals, files, settings and git actions aren't reachable. A message from the phone goes to the agent, model and modes the thread last used.
- **Live updates.** Chat events stream to the phone, throttled to one update per message every 150 ms while an answer streams. Thread states (working, waiting for you, done) come from a two-second watch that runs only while a phone is connected. A thread sends its latest 100 messages; older ones stay on the desktop.

`shared/remote-client.ts` is the phone's connection, with no React Native in it, so the desktop tests drive the same client against the real bridge.

## Tests

```sh
npx vitest run tests/unit/remote-crypto.test.ts tests/unit/remote-devices.test.ts \
  tests/unit/remote-bridge.test.ts tests/unit/phone-remote.test.ts tests/unit/phone-thread-state.test.ts
env -u RELAY_DEV_URL npx playwright test e2e/phone-remote.spec
```

The Playwright spec pairs through the real Settings screen, then approves an agent's command, sends a message and removes the phone. `mobile/e2e/run.sh` runs the phone app itself on a booted Android emulator with [Maestro](https://maestro.mobile.dev): it starts a throwaway desktop Relay (`tests/fixtures/phone-desktop.mjs`), Metro and Expo Go, then pairs, starts a supervised thread, approves and answers a question. Build the desktop first (`npx vite build && node scripts/build-electron.mjs`). `node tests/fixtures/phone-desktop.mjs --seed --host 10.0.2.2` gives you the same desktop with two threads to click through by hand.

## Not there yet

- **Notifications.** Android stops a backgrounded app's socket, so "the agent needs you" has to arrive as a push notification. That needs a development build (`npx expo run:android`) with Firebase set up; Expo Go can't receive remote pushes on Android.
- Side questions (`/btw`) and deep reviews stay on the desktop.
- Images in messages and the composer.
