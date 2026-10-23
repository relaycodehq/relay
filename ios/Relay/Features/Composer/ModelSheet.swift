import RelayRemote
import SwiftUI

/// The desktop's model picker for a thumb: the agent, what it may do without
/// asking, Plan, its models, how hard it thinks, and Fast or Claude's 200k
/// window. Every pick applies at once; full access asks first.
struct ModelSheet: View {
    @Binding var settings: ResumeSettings
    /// Where the agent's defaults come from; they differ per project.
    let projectId: String?
    /// A new thread moves to the model each agent last ran with; a thread's
    /// composer to the agent's Default.
    var remembered: NewThreadModels?
    /// The conversation's context window and what it cost, for the usage row.
    var context: ContextUsage?
    var cost: ThreadCost?
    var compact: (() async throws -> Void)?
    @Environment(Connection.self) private var connection
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colors) private var colors
    @State private var list: [AgentModel]?
    @State private var defaults: AgentDefaults?
    @State private var error: String?

    private var provider: String { settings.provider }
    private var model: AgentModel? { listedModel(provider, list, settings.choice.model) }
    private var fallback: String? { defaults.flatMap { $0.model.isEmpty ? nil : $0.model } }
    /// On Default, the effort goes to whichever model the agent falls back to.
    private var effortModel: AgentModel? {
        model ?? (settings.choice.model.isEmpty ? fallback.flatMap { listedModel(provider, list, $0) } : nil)
    }
    private var defaultEffort: String? {
        let said = settings.choice.model.isEmpty ? defaults?.effort : defaults?.efforts?[model?.id ?? settings.choice.model]
        return said.flatMap { $0.isEmpty ? nil : $0 } ?? effortModel?.defaultEffort
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Agent", selection: agent) {
                        ForEach(connection.offeredAgents(keeping: provider), id: \.self) { Text(agentName($0)).tag($0) }
                    }
                    if UsageBars.shows(provider, context, cost) {
                        NavigationLink {
                            UsagePage(provider: provider, context: context, cost: cost, compact: compact)
                        } label: {
                            UsageBars(provider: provider, context: context, cost: cost)
                        }
                    }
                }
                .cardRow()
                Section {
                    NavigationLink {
                        PermissionsPage(
                            mode: $settings.runtimeMode,
                            readOnly: (connection.overview?.bridge ?? 1) >= Bridge.readOnlyMode
                        )
                    } label: {
                        LabeledContent("Permissions", value: modeLabel(settings.runtimeMode))
                    }
                    Toggle("Plan mode", isOn: plan)
                } footer: {
                    Text("Plan mode plans before it changes anything.")
                }
                .cardRow()
                if let efforts = effortModel?.efforts, !efforts.isEmpty {
                    Section {
                        Picker("Reasoning", selection: $settings.choice.reasoningEffort) {
                            Text(defaultEffort.map { "Default · \(effortLabel($0))" } ?? "Default").tag("")
                            ForEach(efforts, id: \.self) { Text(effortLabel($0)).tag($0) }
                        }
                    }
                    .cardRow()
                }
                if supportsFast(provider, model: settings.choice.model, list) {
                    Section {
                        Toggle("Fast", isOn: $settings.choice.fast)
                    } footer: {
                        Text("\(agentName(provider))'s faster service tier; uses more of your limit.")
                    }
                    .cardRow()
                }
                if provider == "claude", effortModel?.longContext == true {
                    Section {
                        Toggle("200k context window", isOn: window)
                    } footer: {
                        Text("Off leaves Claude on its default window, 1M on most models.")
                    }
                    .cardRow()
                }
                // Last: the list can be long, and the rest is a tap each.
                models
            }
            .relayBackground()
            .navigationTitle("Thread settings")

            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", systemImage: "checkmark") { dismiss() }
                }
            }
        }
        .presentationBackground(colors.background)
        .task(id: provider) { await load() }
        .task(id: provider) { await connection.loadUsage(provider) }
        // Settings → Agents may have changed since the composer asked.
        .task { await connection.loadAgentPrefs(fresh: true) }
    }

    @ViewBuilder private var models: some View {
        Section {
            row("Default", fallback.map { "Uses \(listedModel(provider, list, $0)?.name ?? $0)" } ?? "The agent's own choice",
                settings.choice.model.isEmpty) { pick("") }
            if !settings.choice.model.isEmpty, model == nil {
                row(settings.choice.model, "What this thread last used", true) {}
            }
            ForEach((list ?? []).filter { $0.legacy != true }) { m in
                row(m.name, m.group.map { "\($0) · \(m.description)" } ?? m.description, m.id == model?.id) { pick(m.id) }
            }
            if list == nil {
                Spinner(size: 20).frame(maxWidth: .infinity)
            }
        } header: {
            Text("Model")
        } footer: {
            if let error { Text("Couldn't list \(agentName(provider))'s models: \(error)") }
        }
        .cardRow()
        let legacy = (list ?? []).filter { $0.legacy == true }
        if !legacy.isEmpty {
            Section("Older models") {
                ForEach(legacy) { m in row(m.name, m.description, m.id == model?.id) { pick(m.id) } }
            }
            .cardRow()
        }
    }

    private func row(_ name: String, _ hint: String, _ checked: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                // Plain colours: in a Form button, .primary would take the tint.
                VStack(alignment: .leading, spacing: 2) {
                    Text(name).foregroundStyle(colors.foreground)
                    if !hint.isEmpty {
                        Text(hint).font(.footnote).foregroundStyle(colors.muted)
                    }
                }
                Spacer(minLength: 8)
                if checked {
                    Image(systemName: "checkmark").font(.body.weight(.semibold)).foregroundStyle(Color.accentColor)
                }
            }
            .contentShape(.rect)
        }
        .accessibilityAddTraits(checked ? .isSelected : [])
    }

    private var agent: Binding<String> {
        Binding(
            get: { settings.provider },
            set: { next in
                let moved = settings.onAgent(next)
                settings = remembered.map { moved.remembering($0) } ?? moved
            })
    }

    private var plan: Binding<Bool> {
        Binding(
            get: { settings.interactionMode == "plan" },
            set: { settings.interactionMode = $0 ? "plan" : "default" })
    }

    private var window: Binding<Bool> {
        Binding(get: { settings.contextWindow == "200k" }, set: { settings = settings.onWindow($0 ? "200k" : "1m") })
    }

    private func pick(_ id: String) { settings = settings.onModel(id, list) }

    private func load() async {
        let asked = provider
        list = connection.catalogs[asked]
        defaults = nil
        error = nil
        async let fallback = fallbackDefaults(asked)
        do {
            let listed = try await connection.models(asked)
            if asked == provider { list = listed }
        } catch {
            // Default and the thread's own model still work without the list.
            if asked == provider {
                self.error = error.localizedDescription
                if list == nil { list = [] }
            }
        }
        let said = await fallback
        if asked == provider { defaults = said }
    }

    private func fallbackDefaults(_ provider: String) async -> AgentDefaults? {
        guard let projectId else { return nil }
        return (try? await connection.agentDefaults(projectId, provider)) ?? nil
    }
}

/// What the agent may do without asking; full access asks first, then goes back.
private struct PermissionsPage: View {
    @Binding var mode: String
    /// The desktop takes Read only.
    let readOnly: Bool
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colors) private var colors
    @State private var allowing = false

    var body: some View {
        Form {
            Section {
                ForEach(runtimeModes.filter { readOnly || $0.value != "read-only" }, id: \.value) { option in
                    Button {
                        if option.value == "full-access" && mode != "full-access" { return allowing = true }
                        mode = option.value
                        dismiss()
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(option.label).foregroundStyle(colors.foreground)
                                Text(option.description).font(.footnote).foregroundStyle(colors.muted)
                            }
                            Spacer(minLength: 8)
                            if option.value == mode {
                                Image(systemName: "checkmark").font(.body.weight(.semibold)).foregroundStyle(Color.accentColor)
                            }
                        }
                        .contentShape(.rect)
                    }
                    .accessibilityAddTraits(option.value == mode ? .isSelected : [])
                }
            }
            .cardRow()
        }
        .relayBackground()
        .navigationTitle("Permissions")
        .navigationBarTitleDisplayMode(.inline)
        .alert("Allow full access?", isPresented: $allowing) {
            Button("Cancel", role: .cancel) {}
            Button("Allow") {
                mode = "full-access"
                dismiss()
            }
        } message: {
            Text("The agent will run commands and edit files on your computer without asking.")
        }
    }
}
