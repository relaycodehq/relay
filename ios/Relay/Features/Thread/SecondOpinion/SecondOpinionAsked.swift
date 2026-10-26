import RelayRemote
import SwiftUI

/// Atop a second opinion's thread, in place of the prompt its agent got: what
/// it was asked, the question and the answer it checks.
struct SecondOpinionAskedView: View {
    let asked: SecondOpinionAsked
    @Environment(\.colors) private var colors

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Second opinion").font(.subheadline.weight(.semibold)).foregroundStyle(colors.foreground)
            if !asked.question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                heading("Question")
                MarkdownView(asked.question, small: true)
            }
            heading("Answer")
            Folded(lines: 4) { MarkdownView(asked.answer, small: true) }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(colors.border, lineWidth: 0.5))
    }

    private func heading(_ text: String) -> some View {
        Text(text).font(.caption.weight(.semibold)).foregroundStyle(colors.muted)
    }
}

/// Picks the agent and model that give a second opinion, as the desktop's
/// model picker does: every agent on its Default, none "the one picked".
/// Picking a model asks.
struct SecondOpinionSheet: View {
    let chatId: String
    let answer: ChatMessage
    @Environment(Connection.self) private var connection
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colors) private var colors
    @State private var provider = ""
    @State private var list: [AgentModel]?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Agent", selection: $provider) {
                        ForEach(connection.offeredAgents(keeping: answer.provider), id: \.self) { Text(agentName($0)).tag($0) }
                    }
                } footer: {
                    Text("Another agent checks this answer without changing any files.")
                }
                .cardRow()
                Section {
                    row("Default", "The agent's own choice") { pick("") }
                    ForEach((list ?? []).filter { $0.legacy != true }) { m in
                        row(m.name, m.group.map { "\($0) · \(m.description)" } ?? m.description) { pick(m.id) }
                    }
                    if list == nil { Spinner(size: 20).frame(maxWidth: .infinity) }
                } header: {
                    Text("Model")
                } footer: {
                    if let error { Text("Couldn't list \(agentName(provider))'s models: \(error)") }
                }
                .cardRow()
                let legacy = (list ?? []).filter { $0.legacy == true }
                if !legacy.isEmpty {
                    Section("Older models") {
                        ForEach(legacy) { m in row(m.name, m.description) { pick(m.id) } }
                    }
                    .cardRow()
                }
            }
            .relayBackground()
            .navigationTitle("Second Opinion")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark") { dismiss() }
                }
            }
        }
        .presentationBackground(colors.background)
        .onAppear { if provider.isEmpty { provider = answer.provider } }
        .task(id: provider) { await load() }
        .task { await connection.loadAgentPrefs(fresh: true) }
    }

    private func row(_ name: String, _ hint: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 2) {
                Text(name).foregroundStyle(colors.foreground)
                if !hint.isEmpty { Text(hint).font(.footnote).foregroundStyle(colors.muted) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
        }
    }

    private func pick(_ model: String) {
        SecondOpinions.shared.ask(chatId, answer.id, provider: provider, model: model, connection)
        dismiss()
    }

    private func load() async {
        guard !provider.isEmpty else { return }
        let asked = provider
        list = connection.catalogs[asked]
        error = nil
        do {
            let listed = try await connection.models(asked)
            if asked == provider { list = listed }
        } catch {
            // Default still works without the list.
            if asked == provider {
                self.error = error.localizedDescription
                if list == nil { list = [] }
            }
        }
    }
}
