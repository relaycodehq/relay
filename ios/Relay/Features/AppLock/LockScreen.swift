import RelayRemote
import SwiftUI

/// "Relay is locked": the PIN, Face ID once per locking, and starting over when the PIN is
/// forgotten. Android: `LockScreen`.
struct LockScreen: View {
    let lock: AppLock
    @Environment(Connection.self) private var connection
    @State private var typing = PinTyping()
    @State private var wrong: String?
    @State private var error = false
    @State private var shakes = 0
    @State private var checking = false
    @State private var forgetAsked = false
    @State private var waitLeft: Int64 = 0
    @State private var biometrics = Biometrics.available

    var body: some View {
        let waiting = waitLeft > 0
        PinPad(
            title: "Relay is locked",
            line: waiting ? LockWords.waitLine(waitLeft) : wrong ?? "Enter your PIN",
            typed: typing.text.count,
            onDigit: { d in
                wrong = nil
                if let pin = typing.digit(d) { check(pin) }
            },
            onDelete: { typing.delete() },
            error: error,
            warn: waiting || wrong != nil,
            shakes: shakes,
            enabled: !checking && !waiting,
            extra: biometrics && lock.settings.biometrics ? PadKey(symbol: Biometrics.symbol, label: Biometrics.label) { ask() } : nil
        ) {
            EmptyView()
        } footer: {
            Button("Forgot PIN?") { forgetAsked = true }
                .font(.subheadline.weight(.medium))
                .buttonStyle(.borderless)
        }
        .task(id: lock.settings.waitUntil) {
            while !Task.isCancelled {
                waitLeft = max(lock.settings.waitUntil - Int64(Date().timeIntervalSince1970 * 1000), 0)
                if waitLeft == 0 { break }
                try? await Task.sleep(for: .milliseconds(waitLeft % 1000 + 1))
            }
        }
        // Once per locking, when Relay is in front: a prompt asked for in the background just fails.
        .task(id: lock.wantsBiometrics) {
            guard lock.wantsBiometrics else { return }
            lock.wantsBiometrics = false
            if biometrics, lock.settings.biometrics, lock.settings.waitUntil <= Int64(Date().timeIntervalSince1970 * 1000) { ask() }
        }
        .alert("Forget every computer?", isPresented: $forgetAsked) {
            Button("Forget all", role: .destructive) {
                for computer in connection.computers { connection.forget(computer.key) }
                lock.reset()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Without the PIN, the way back in is to start over: Relay forgets every computer paired on this phone and the lock, and you pair them again.")
        }
        .accessibilityAddTraits(.isModal)
    }

    private func check(_ pin: String) {
        checking = true
        Task {
            // Long enough to see the last dot fill.
            try? await Task.sleep(for: .milliseconds(90))
            switch await lock.tryPin(pin) {
            case .unlocked:
                Haptics.success()
            case .wrong(let failures, let waitMs):
                wrong = waitMs > 0 ? nil : LockWords.wrongLine(failures)
                error = true
                shakes += 1
                Haptics.error()
                try? await Task.sleep(for: .milliseconds(420))
                error = false
                typing.clear()
            case .waiting:
                typing.clear()
            }
            checking = false
        }
    }

    private func ask() {
        Task {
            if await Biometrics.prompt() {
                Haptics.success()
                lock.unlockWithBiometrics()
            }
        }
    }
}
