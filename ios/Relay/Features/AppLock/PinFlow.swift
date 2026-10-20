import RelayRemote
import SwiftUI

/// Turning the lock on (choose a PIN, type it again), changing the PIN (the current one first) or
/// turning it off (the current one). Wrong current PINs count toward the lock screen's wait.
/// Android: `PinFlow`.
struct PinFlow: View {
    enum Kind: Identifiable {
        case turnOn, change, turnOff
        var id: Self { self }
    }

    private enum Step { case current, choose, confirm }

    let kind: Kind
    let lock: AppLock
    @Environment(\.dismiss) private var dismiss
    @State private var step: Step
    @State private var typing = PinTyping()
    @State private var chosen = ""
    @State private var note: String?
    @State private var error = false
    @State private var shakes = 0
    @State private var busy = false

    init(kind: Kind, lock: AppLock) {
        self.kind = kind
        self.lock = lock
        _step = State(initialValue: kind == .turnOn ? .choose : .current)
    }

    var body: some View {
        let (title, hint) = words
        PinPad(
            title: title,
            line: note ?? hint,
            typed: typing.text.count,
            onDigit: { d in if let pin = typing.digit(d) { entered(pin) } },
            onDelete: { typing.delete() },
            error: error,
            warn: note != nil,
            shakes: shakes,
            enabled: !busy
        ) {
            HStack {
                Button("Cancel", systemImage: "xmark") { dismiss() }
                    .labelStyle(.iconOnly)
                    .font(.system(size: 17, weight: .semibold))
                    .frame(width: 44, height: 44)
                    .padding(.leading, 12)
                Spacer()
            }
        } footer: {
            EmptyView()
        }
    }

    private var words: (String, String) {
        switch step {
        case .current: (kind == .turnOff ? "Turn the lock off" : "Change PIN", "Enter your current PIN")
        case .choose: (kind == .turnOn ? "Choose a PIN" : "Choose a new PIN", "Six digits, asked for whenever Relay opens.")
        case .confirm: ("Enter it again", "To be sure it's the one you meant.")
        }
    }

    private func refuse(_ line: String) async {
        note = line
        error = true
        shakes += 1
        Haptics.error()
        try? await Task.sleep(for: .milliseconds(420))
        error = false
    }

    private func entered(_ pin: String) {
        busy = true
        Task {
            try? await Task.sleep(for: .milliseconds(90))
            switch step {
            case .current:
                switch await lock.tryPin(pin) {
                case .unlocked:
                    typing.clear()
                    note = nil
                    if kind == .turnOff {
                        lock.turnOff()
                        Haptics.success()
                        dismiss()
                    } else {
                        step = .choose
                    }
                case .wrong(let failures, let waitMs):
                    await refuse(waitMs > 0 ? LockWords.waitLine(waitMs) : LockWords.wrongLine(failures))
                    typing.clear()
                case .waiting(let leftMs):
                    await refuse(LockWords.waitLine(leftMs))
                    typing.clear()
                }
            case .choose:
                chosen = pin
                typing.clear()
                note = nil
                step = .confirm
            case .confirm:
                if pin == chosen {
                    if kind == .turnOn {
                        await lock.turnOn(pin, biometrics: Biometrics.available)
                    } else {
                        await lock.changePin(pin)
                    }
                    Haptics.success()
                    dismiss()
                } else {
                    await refuse("Those didn't match. Choose a PIN again.")
                    typing.clear()
                    chosen = ""
                    step = .choose
                }
            }
            busy = false
        }
    }
}

/// Settings' lock rows: on or off, Face ID, when it locks again, and changing the PIN.
/// Android: `LockSection`.
struct LockSection: View {
    @Environment(AppLock.self) private var lock
    /// Owned by the List's view rather than this section: a cover attached to a List row was
    /// dismissed a second after it first opened.
    @Binding var flow: PinFlow.Kind?
    @State private var biometrics = Biometrics.available

    var body: some View {
        let settings = lock.settings
        Section("App lock") {
            Toggle(isOn: Binding(get: { settings.on }, set: { _ in flow = settings.on ? .turnOff : .turnOn })) {
                row("Lock Relay", "Ask for a PIN when Relay opens. One lock for every computer paired here.")
            }
            if settings.on {
                if biometrics {
                    Toggle(isOn: Binding(get: { settings.biometrics }, set: { lock.useBiometrics($0) })) {
                        row(Biometrics.label, "Unlock without typing the PIN.")
                    }
                }
                Picker(selection: Binding(get: { settings.after }, set: { lock.lockAfter($0) })) {
                    ForEach(LockAfter.allCases, id: \.self) { Text($0.label).tag($0) }
                } label: {
                    row("Lock when away", "How long Relay can be in the background before it asks again.")
                }
                .pickerStyle(.navigationLink)
                Button { flow = .change } label: {
                    HStack {
                        Text("Change PIN").foregroundStyle(.primary)
                        Spacer()
                        Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                    }
                    .contentShape(.rect)
                }
            }
        }
        .cardRow()
    }

    private func row(_ title: String, _ subtitle: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
            Text(subtitle)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }
}
