import RelayRemote
import SwiftUI

/// A project: a new thread in it, then every thread it has (Android's ProjectScreen.kt).
struct ProjectView: View {
    let projectId: String
    @Environment(Connection.self) private var connection
    @Environment(\.navigate) private var navigate
    @Environment(\.colors) private var colors

    var body: some View {
        let chats = connection.chats.filter { $0.projectId == projectId }
        List {
            Section {
                Button { navigate(.newThread(projectId: projectId)) } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "plus").foregroundStyle(colors.accent).frame(width: 18)
                        Text("New thread").foregroundStyle(colors.foreground)
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(colors.faint)
                    }
                    .padding(.vertical, 11)
                    .contentShape(.rect)
                }
                .disabled(connection.status.state != .online)
                .activityRow()
                if connection.canTunnel {
                    Button { navigate(.browser()) } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "globe").foregroundStyle(colors.muted).frame(width: 18)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Sites").foregroundStyle(colors.foreground)
                                Text("Open localhost on \(connection.overview?.name ?? "the computer")")
                                    .font(.footnote)
                                    .foregroundStyle(colors.muted)
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(colors.faint)
                        }
                        .padding(.vertical, 9)
                        .contentShape(.rect)
                    }
                    .activityRow()
                }
            }
            Section {
                ForEach(chats) { chat in
                    Button { navigate(.thread(chat.id)) } label: { ThreadRow(chat: chat) }
                        .activityRow()
                }
                if chats.isEmpty {
                    Text("No threads in this project yet.")
                        .font(.footnote)
                        .foregroundStyle(colors.muted)
                        .padding(.vertical, 12)
                        .activityRow()
                }
            } header: {
                SectionLabel(title: "Threads", count: chats.count)
            }
        }
        .listStyle(.plain)
        .ribbonRefresh { await connection.reloadList() }
        .relayBackground()
        .navigationTitle(connection.project(projectId)?.name ?? "Project")
        .navigationBarTitleDisplayMode(.inline)
    }
}
