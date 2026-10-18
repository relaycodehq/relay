import RelayRemote
import SwiftUI

/// Android's SettingsScreen: theme, this app's version and licences, the paired computers,
/// and how to reach the one in use.
struct SettingsView: View {
    @Environment(Connection.self) private var connection
    @Environment(\.navigate) private var navigate
    @AppStorage(ThemeMode.key) private var theme = ThemeMode.computer
    @AppStorage(ThreadNotices.switchKey) private var notices = true
    @AppStorage(DictationEngine.key) private var dictation = DictationEngine.computer
    #if DEBUG
    @AppStorage(ShowTouches.key) private var touches = true
    #endif

    var body: some View {
        let name = connection.computerName
        List {
            Section("Theme") {
                ForEach(ThemeMode.allCases, id: \.self) { mode in
                    let (label, hint) = choice(mode, name: name, known: connection.overview?.appearance != nil)
                    ChoiceRow(label: label, hint: hint, chosen: theme == mode) { theme = mode }
                }
            }
            .cardRow()
            if PhoneSpeech.available {
                Section("Dictation") {
                    ChoiceRow(
                        label: "On the computer", hint: "\(name) turns speech into text; the audio goes over the link.",
                        chosen: dictation == .computer
                    ) { dictation = .computer }
                    ChoiceRow(
                        label: "On this phone", hint: "The phone's own speech engine. Needs no computer and sends no audio.",
                        chosen: dictation == .phone
                    ) { dictation = .phone }
                }
                .cardRow()
            }
            Section("App") {
                LabeledContent("Relay \(Connection.appVersion)") {}
                #if DEBUG
                Toggle(isOn: $touches) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Show touches")
                        Text("A circle under each finger, for screen recordings.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                #endif
                Button { navigate(.licences) } label: {
                    HStack {
                        Label("Open-source licences", systemImage: "doc.plaintext").foregroundStyle(.primary)
                        Spacer()
                        Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                    }
                }
            }
            .cardRow()
            ComputersSection()
            RouteSection().cardRow()
            Section {
                Toggle(isOn: $notices) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("When another thread finishes or fails")
                        Text("A note at the top while Relay is open; tap it to open the thread.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .cardRow()
        }
        .relayBackground()
    }

    private func choice(_ mode: ThemeMode, name: String, known: Bool) -> (String, String) {
        switch mode {
        case .computer:
            ("Match \(name)", known ? "Its theme, light or dark as it is set there." : "Relay's theme until your computer shares its own.")
        case .phone: ("Follow this phone", "The same theme, light or dark with the phone.")
        case .light: ("Light", "The theme's light colours.")
        case .dark: ("Dark", "The theme's dark colours.")
        }
    }
}

/// A row of a pick-one list: a check on the chosen one.
struct ChoiceRow: View {
    let label: String
    let hint: String
    let chosen: Bool
    let pick: () -> Void

    var body: some View {
        Button(action: pick) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(label).foregroundStyle(.primary)
                    Text(hint).font(.footnote).foregroundStyle(.secondary)
                }
                Spacer()
                if chosen { Image(systemName: "checkmark").foregroundStyle(.tint) }
            }
            .contentShape(.rect)
        }
        .accessibilityAddTraits(chosen ? .isSelected : [])
    }
}
