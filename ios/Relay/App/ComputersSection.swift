import RelayRemote
import SwiftUI

/// The paired computers: switch, update the one in use, pair another, unpair (Android's ComputersSection.kt).
struct ComputersSection: View {
    @Environment(Connection.self) private var connection
    @Environment(ComputerUpdates.self) private var updates
    @Environment(\.colors) private var colors
    @State private var pairing = false
    @State private var unpairing = false

    var body: some View {
        let name = connection.computerName
        let update = connection.updateAction(updates)
        Section("Computers") {
            ForEach(connection.computers, id: \.key) { computer in
                let inUse = computer.key == connection.active
                Button {
                    if !inUse { connection.switchTo(computer.key) }
                } label: {
                    HStack {
                        Label {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(computer.name).foregroundStyle(.primary)
                                Text(
                                    inUse
                                        ? "In use\(connection.overview?.version.map { ", Relay \($0)" } ?? ""). Remove this phone in Relay's Settings → Phone there to cut it off."
                                        : "Tap to switch to it."
                                )
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                            }
                        } icon: {
                            Image(systemName: "desktopcomputer")
                        }
                        Spacer()
                        if inUse { Image(systemName: "checkmark").foregroundStyle(.tint) }
                    }
                }
                .swipeActions {
                    Button("Forget", role: .destructive) { connection.forget(computer.key) }
                }
            }
            if let current = update.update {
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Updating \(name)")
                        Text(describeUpdate(name, current)).font(.footnote).foregroundStyle(.secondary)
                    }
                } icon: {
                    Image(systemName: "arrow.triangle.2.circlepath")
                }
            } else if update.can {
                Button { connection.startUpdate(updates) } label: {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Update \(name)").foregroundStyle(.primary)
                            Text("\(update.hint) It restarts into the new version; its agents keep going.")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    } icon: {
                        Image(systemName: "arrow.triangle.2.circlepath")
                    }
                }
            } else if update.devBuild {
                note("\(update.hint) It's a development build, so it doesn't update itself.")
            } else if update.needed && !update.askable {
                note("\(name) runs an older Relay. Update it there once; after that this phone can do it.")
            }
            Button { pairing = true } label: {
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Pair another computer").foregroundStyle(.primary)
                        Text("Scan the code in Relay's Settings → Phone there.").font(.footnote).foregroundStyle(.secondary)
                    }
                } icon: {
                    Image(systemName: "plus")
                }
            }
            if connection.active != nil {
                Button(role: .destructive) { unpairing = true } label: {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Unpair from \(name)").foregroundStyle(colors.destructive)
                            Text("Forgets it here. Pairing again needs a new code from Relay there.")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    } icon: {
                        Image(systemName: "minus.circle").foregroundStyle(colors.destructive)
                    }
                }
            }
        }
        .cardRow()
        .fullScreenCover(isPresented: $pairing) { PairingView() }
        .confirmationDialog("Unpair from \(name)?", isPresented: $unpairing, titleVisibility: .visible) {
            Button("Unpair", role: .destructive) {
                if let active = connection.active { connection.forget(active) }
            }
        }
    }

    private func note(_ text: String) -> some View {
        Text(text).font(.footnote).foregroundStyle(.secondary)
    }
}
