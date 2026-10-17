import RelayRemote
import SwiftUI

/// The paired computers, which one is active, and pairing another.
struct SettingsView: View {
    @Environment(Connection.self) private var connection
    @State private var pairing = false

    var body: some View {
        List {
            Section("Computers") {
                ForEach(connection.computers, id: \.key) { computer in
                    Button {
                        connection.switchTo(computer.key)
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(computer.name).foregroundStyle(.primary)
                                Text(computer.hosts.joined(separator: ", "))
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                            Spacer()
                            if computer.key == connection.active {
                                Image(systemName: "checkmark").foregroundStyle(.tint)
                            }
                        }
                    }
                    .swipeActions {
                        Button("Forget", role: .destructive) { connection.forget(computer.key) }
                    }
                }
                Button("Pair another computer", systemImage: "plus") { pairing = true }
            }
            .cardRow()
            if let overview = connection.overview {
                Section("Connected") {
                    LabeledContent("Relay", value: overview.version ?? "unknown")
                    LabeledContent("Bridge", value: overview.bridge.map(String.init) ?? "unknown")
                }
                .cardRow()
            }
            Section {
                LabeledContent(
                    "This app",
                    value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")
            }
            .cardRow()
        }
        .relayBackground()
        .fullScreenCover(isPresented: $pairing) { PairingView() }
    }
}
