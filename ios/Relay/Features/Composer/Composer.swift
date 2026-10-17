import PhotosUI
import RelayRemote
import SwiftUI

/// What the composer hands over to send.
struct ComposerSend {
    var text: String
    var images: [PastedImage]
    var settings: ResumeSettings
    /// Into the running answer rather than behind it.
    var steer = false
    /// Set for later rather than now.
    var sendAt: Int64?
}

/// A composer: one glass box with the text on top and its controls under
/// it, photos and the model on the left, dictation and send on the right.
/// Holding Send offers Send later.
struct Composer: View {
    /// The thread it writes to; nil for a thread `send` is yet to make.
    let chatId: String?
    /// The side conversation it replies in, if any.
    var rootId: String?
    /// Where the agent's defaults come from.
    let projectId: String?
    /// What the next message goes with; nil until the computer says.
    @Binding var settings: ResumeSettings?
    /// A new thread's agents keep the model they last ran with.
    var remembered: NewThreadModels?
    var placeholder = "Message"
    /// The screen's, so a tap or a drag on it puts the keyboard away.
    var focused: FocusState<Bool>.Binding
    /// How the thread puts a queued message back in.
    var handle: ComposerHandle?
    /// Relay's actions for a thread: /new, /clear, /compact, /reload; throws to say why not.
    var onCommand: ((_ name: String, _ args: String) async throws -> Void)?
    let send: (ComposerSend) async throws -> Void
    @Environment(Connection.self) private var connection
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.colors) private var colors
    @State private var draft = ""
    @State private var photos: [PickedPhoto] = []
    @State private var picked: [PhotosPickerItem] = []
    @State private var loadingPhotos = 0
    @State private var sending = false
    @State private var error: String?
    @State private var dictation = DictationSession()
    @State private var picking = false
    @State private var library = false
    @State private var camera = false
    /// A send waiting on "Switch to …?".
    @State private var switching: (steer: Bool, sendAt: Int64?)?
    @State private var agentCommands: [ProviderCommand] = []
    @State private var loadingCommands = false
    @State private var commandsFailed = false
    /// The draft the menu was put away for; typing brings it back.
    @State private var menuDismissed: String?
    /// `/context`'s usage page.
    @State private var showingUsage = false

    private var running: Bool { chatId.map { connection.running($0, rootId: rootId) } ?? false }
    private var text: String { draft.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var empty: Bool { text.isEmpty && photos.isEmpty }
    private var stops: Bool { running && empty && dictation.phase == .idle }
    private var steers: Bool { running && !stops }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let items = menuItems {
                CommandMenu(items: items, loading: loadingCommands, failed: commandsFailed, pick: pick)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
            VStack(alignment: .leading, spacing: 8) {
                // Inside the glass: over the thread it reads through whatever scrolls behind.
                if let shown = error ?? dictation.error {
                    Text(shown)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .padding(.horizontal, 4)
                        .padding(.top, 4)
                        // Tapping it puts it away, and the menu with it.
                        .onTapGesture {
                            if error == nil { dictation.error = nil } else {
                                error = nil
                                menuDismissed = draft
                            }
                        }
                }
                if !photos.isEmpty || loadingPhotos > 0 {
                    PhotoStrip(photos: photos, loading: loadingPhotos) { id in photos.removeAll { $0.id == id } }
                        .padding(.top, 4)
                }
                TextField(running ? "Queue a message" : placeholder, text: $draft, axis: .vertical)
                    .lineLimit(1...8)
                    .focused(focused)
                    .padding(.horizontal, 4)
                    .padding(.top, 6)
                controls
            }
            .padding(.horizontal, 12)
            .padding(.top, 10)
            .padding(.bottom, 12)
            .contentShape(.rect(cornerRadius: 26))
            .onTapGesture { focused.wrappedValue = true }
            .glassEffect(.regular, in: .rect(cornerRadius: 26))
        }
        // In from the sides as far as the tab bar it takes over.
        .padding(.horizontal, 20)
        .padding(.bottom, 6)
        .animation(.snappy(duration: 0.2), value: menuItems == nil)
        .task(id: commandsWanted) { await loadCommands() }
        .onChange(of: picked) { _, items in add(items) }
        .photosPicker(
            isPresented: $library, selection: $picked,
            maxSelectionCount: max(1, PastedImage.maxPerMessage - photos.count - loadingPhotos), matching: .images)
        .fullScreenCover(isPresented: $camera) {
            CameraPicker { add($0, name: "photo-\(photos.count + loadingPhotos + 1).jpg") }
                .ignoresSafeArea()
        }
        .alert(switchTitle, isPresented: Binding(get: { switching != nil }, set: { if !$0 { switching = nil } })) {
            Button("Switch to \(agentName(settings?.provider ?? ""))") {
                if let pending = switching { submit(steer: pending.steer, sendAt: pending.sendAt, confirmed: true) }
            }
            Button("Keep \(agentName(holder ?? ""))", role: .cancel) {}
        } message: {
            let from = agentName(holder ?? "")
            let next = agentName(settings?.provider ?? "")
            Text(
                "\(from) has been working in this thread. \(next) cannot see its session, tool results, or the files it read.\n\n"
                    + "\(from) will write a handoff note first. \(next) continues from that note and the recent messages, so expect some context to be lost."
            )
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { dictation.stop() }
        }
        .onDisappear { dictation.stop() }
        .onAppear {
            handle?.restore = restore
            handle?.compose = { text, earlier in draft = composeInto(draft, text, earlier: earlier) }
        }
        .sheet(isPresented: $picking) {
            if let current = settings {
                ModelSheet(
                    settings: Binding(get: { settings ?? current }, set: { settings = $0 }), projectId: projectId,
                    remembered: remembered, context: context, cost: cost, compact: compact
                )
                .presentationDetents([.medium, .large])
            }
        }
        .sheet(isPresented: $showingUsage) {
            if let provider = settings?.provider {
                NavigationStack {
                    UsagePage(provider: provider, context: context, cost: cost, compact: compact)
                }
            }
        }
        // Names the model rather than its id once the agent's list is in.
        .task(id: settings?.provider) {
            if let provider = settings?.provider { _ = try? await connection.models(provider) }
        }
    }

    @ViewBuilder private var model: some View {
        if let settings {
            Button {
                focused.wrappedValue = false
                picking = true
            } label: {
                HStack(spacing: 3) {
                    Text(label(settings))
                        .lineLimit(1)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.caption2.weight(.semibold))
                }
                .font(.footnote)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 4)
                .frame(minHeight: 36)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Thread settings: \(label(settings))")
        }
    }

    private var controls: some View {
        HStack(spacing: 6) {
            Menu {
                Button("Photo Library", systemImage: "photo.on.rectangle") { library = true }
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button("Take Photo", systemImage: "camera") { camera = true }
                }
                Button { paste() } label: {
                    Label("Paste Image", systemImage: "doc.on.clipboard")
                    Text("The image you copied last")
                }
                .disabled(!UIPasteboard.general.hasImages)
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 20))
                    .frame(width: 36, height: 36)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .disabled(photos.count + loadingPhotos >= PastedImage.maxPerMessage)
            .accessibilityLabel("Attach a photo")
            model
            Spacer(minLength: 0)
            if draft.isEmpty && dictation.phase == .idle {
                Button {
                    draft = "/"
                    focused.wrappedValue = true
                } label: {
                    Text("/")
                        .font(.system(size: 18, design: .monospaced))
                        .frame(width: 26, height: 36)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .accessibilityLabel("Commands")
            }
            if connection.canDictate {
                DictationButton(session: dictation) {
                    dictation.start(after: draft, with: connection) { draft = $0 }
                }
            }
            if steers {
                Button {
                    submit(steer: true)
                } label: {
                    Image(systemName: "bolt.fill")
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(colors.foreground)
                        .frame(width: 28, height: 28)
                }
                .accessibilityLabel("Steer now")
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .disabled(!canSend)
                .transition(.scale.combined(with: .opacity))
            }
            // A sheet's Done: its size, weight and accent tint; Stop in the desktop's red.
            Button {
                if stops { stop() } else { submit() }
            } label: {
                Image(systemName: stops ? "stop.fill" : running ? "text.line.last.and.arrowtriangle.forward" : "arrow.up")
                    .font(.system(size: stops ? 15 : running ? 16 : 19, weight: .medium))
                    .foregroundStyle(.white)
                    .frame(width: 28, height: 28)
            }
            .accessibilityLabel(stops ? "Stop" : running ? "Queue" : "Send")
            .buttonStyle(.glassProminent)
            .buttonBorderShape(.circle)
            .tint(stops ? stopRed : colors.accent)
            .disabled(!stops && !canSend)
            .contextMenu {
                if !stops && canSend {
                    let now = nowMs()
                    Section("Send later") {
                        ForEach(Clock().sendLaterPresets(now), id: \.at) { preset in
                            Button { submit(sendAt: preset.at) } label: {
                                Text(preset.label)
                                Text(Clock().wakeLabel(preset.at, now: now))
                            }
                        }
                    }
                }
            }
        }
        .animation(.easeOut(duration: 0.15), value: stops)
        .animation(.snappy(duration: 0.2), value: steers)
    }

    private var canSend: Bool {
        (!empty || dictation.phase == .listening) && !sending && loadingPhotos == 0 && dictation.phase != .finishing
    }

    private func add(_ items: [PhotosPickerItem]) {
        guard !items.isEmpty else { return }
        picked = []
        let taking = Array(items.prefix(PastedImage.maxPerMessage - photos.count - loadingPhotos))
        let first = photos.count + loadingPhotos + 1
        loadingPhotos += taking.count
        Task {
            // Loaded side by side, shown in the order they were picked.
            let loaded = await withTaskGroup(of: (Int, Result<PickedPhoto?, Error>).self) { group in
                for (n, item) in taking.enumerated() {
                    group.addTask { (n, await Result { try await pickedPhoto(item, name: "photo-\(first + n).jpg") }) }
                }
                var all: [(Int, Result<PickedPhoto?, Error>)] = []
                for await one in group { all.append(one) }
                return all.sorted { $0.0 < $1.0 }
            }
            loadingPhotos -= taking.count
            for (_, result) in loaded {
                switch result {
                case .success(let photo?): photos.append(photo)
                case .success(nil): error = "That photo is too big to send."
                case .failure(let failure): error = "Couldn't load that photo: \(failure.localizedDescription)"
                }
            }
        }
    }

    /// "Opus 5.5 · High", and Plan while it's on.
    private func label(_ settings: ResumeSettings) -> String {
        settings.label(connection.catalogs[settings.provider]) + (settings.interactionMode == "plan" ? " · Plan" : "")
    }

    /// The agent holding this conversation's context; another one taking over loses its session.
    private var holder: String? {
        guard let chatId else { return nil }
        return contextAgent(connection.conversation(chatId, rootId: rootId), rootId: rootId)
    }

    private var switchTitle: String { "Switch to \(agentName(settings?.provider ?? ""))?" }

    private func submit(steer: Bool = false, sendAt: Int64? = nil, confirmed: Bool = false) {
        if !confirmed, startsWithCommand(text), !command(text) { return }
        // A `/btw` question goes beside the conversation; nobody takes over.
        let side = rootId == nil && text.range(of: "^/btw\\s", options: [.regularExpression, .caseInsensitive]) != nil
        if !confirmed, !side, let settings, takesOver(settings.provider, holder: holder) {
            switching = (steer, sendAt)
            return
        }
        Task {
            if dictation.phase != .idle { await dictation.finish() }
            let body = text
            let sent = photos
            guard !body.isEmpty || !sent.isEmpty else { return }
            sending = true
            error = nil
            draft = ""
            photos = []
            defer { sending = false }
            do {
                guard let settings else { throw PairingError("Wait for your computer to say which agent answers.") }
                try await send(ComposerSend(text: body, images: sent.map(\.image), settings: settings, steer: steer, sendAt: sendAt))
            } catch {
                self.error = error.localizedDescription
                if draft.isEmpty { draft = body }
                if photos.isEmpty { photos = sent }
            }
        }
    }

    // MARK: Commands

    /// Relay's actions this phone can't do yet, left out of the menu.
    private static let notHere: Set = ["openpr", "changes", "files"]

    /// The conversation's context window, and what the thread cost.
    private var context: ContextUsage? { chatId.flatMap { latestContext(connection.conversation($0, rootId: rootId)) } }
    private var cost: ThreadCost? {
        guard let chatId, let thread = connection.threads[chatId] else { return nil }
        return thread.cost ?? threadCost(thread.messages)
    }
    private var compact: (() async throws -> Void)? {
        guard chatId != nil, let onCommand else { return nil }
        return { try await onCommand("compact", "") }
    }

    private var menuItems: [CommandMenuItem]? {
        guard menuDismissed != draft, let provider = settings?.provider else { return nil }
        return commandItems(draft, provider: provider, commands: agentCommands, hidden: Self.notHere)
    }

    /// Which agent's commands the menu wants, while one may open.
    private var commandsWanted: String? {
        guard let projectId, let provider = settings?.provider,
            draft.range(of: "^\\s*[/$]", options: .regularExpression) != nil
                || draft.range(of: "\\s\\$\\S*$", options: .regularExpression) != nil
        else { return nil }
        return "\(projectId):\(provider)"
    }

    private func loadCommands() async {
        guard commandsWanted != nil, let projectId, let provider = settings?.provider else { return }
        loadingCommands = true
        defer { loadingCommands = false }
        do {
            agentCommands = try await connection.commands(projectId, provider)
            commandsFailed = false
        } catch {
            agentCommands = []
            commandsFailed = true
        }
    }

    private func pick(_ item: CommandMenuItem) {
        error = nil
        switch item.kind {
        case .relay:
            // Required values are picked or typed after it; the rest run now.
            if item.name == "btw" || (item.args?.hasPrefix("<") == true && !isComposerCommand(item.name)) {
                draft = "/\(item.name) "
            } else {
                run(item.name, "")
            }
        case .command: draft = "/\(item.name) "
        case .skill: draft = withSkill(draft, item.name)
        }
    }

    /// A message that starts with a command: true when it goes out as a message
    /// (`/btw`, `/goal`, a skill or the agent's own), else it ran or `error` says why not.
    private func command(_ text: String) -> Bool {
        let provider = settings?.provider ?? ""
        let traits = agentTraits(provider)
        let command = relayCommand(text)
        switch command?.name {
        case "goal":
            // The agent runs `/goal` itself.
            if provider == "codex" || provider == "claude" { return true }
            error = "Pick Codex or Claude Code to set a goal."
        case "btw":
            if command?.args.isEmpty == true {
                error = "Add a question after /btw."
            } else if let refusal = sideRefusal(provider) {
                error = refusal
            } else {
                return true
            }
        case let name?:
            run(name, command?.args ?? "")
        case nil:
            let name = text.dropFirst().prefix { !$0.isWhitespace }
            let agents = traits?.commandsAlone == true && agentCommands.contains { $0.name == name }
            let skill = traits?.skills == true && text.range(of: "^/skill:[^\\s]+(?:\\s|$)", options: .regularExpression) != nil
            if agents || skill { return true }
            error = "Choose a command from the menu. Relay actions run on their own; add instructions after a skill or an agent's command."
        }
        return false
    }

    private func run(_ name: String, _ args: String) {
        Task {
            do {
                if isComposerCommand(name) {
                    try await setting(name, args)
                } else if name == "context" {
                    focused.wrappedValue = false
                    showingUsage = true
                } else if let onCommand {
                    try await onCommand(name, args)
                } else {
                    throw PairingError("That works in a thread.")
                }
                draft = ""
                error = nil
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    /// The desktop's runCommand for a composer setting; with no value, the settings open.
    private func setting(_ name: String, _ args: String) async throws {
        guard let current = settings else { throw PairingError("Wait for your computer to say which agent answers.") }
        if args.isEmpty && name != "plan" && name != "fast" {
            focused.wrappedValue = false
            picking = true
            return
        }
        let wanted = name == "model" ? agentProviders : name == "effort" || name == "fast" ? [current.provider] : []
        await withTaskGroup(of: Void.self) { group in
            for provider in wanted { group.addTask { _ = try? await connection.models(provider) } }
        }
        let known = connection.catalogs
        let asked = CommandSettings(
            recipient: current.provider, model: current.choice.model, fast: current.choice.fast,
            plan: current.interactionMode == "plan", catalogs: known)
        switch composerCommand(name, args, asked) {
        case .error(let message): throw PairingError(message)
        case .change(let change):
            settings = current.with(change, known) { from, to in
                let moved = from.onAgent(to)
                return to == from.provider ? from : remembered.map { moved.remembering($0) } ?? moved
            }
        }
    }

    /// A photo from the camera or the clipboard.
    private func add(_ image: UIImage, name: String) {
        guard photos.count + loadingPhotos < PastedImage.maxPerMessage else { return }
        loadingPhotos += 1
        Task {
            let photo = await Task.detached { pickedPhoto(image, name: name) }.value
            loadingPhotos -= 1
            if let photo { photos.append(photo) } else { error = "That photo is too big to send." }
        }
    }

    private func paste() {
        guard let image = UIPasteboard.general.image else {
            error = "There's no image on the clipboard."
            return
        }
        add(image, name: "pasted-\(photos.count + loadingPhotos + 1).png")
    }

    /// A message taken back out of the queue, after what's typed.
    private func restore(_ text: String, _ images: [PastedImage]) throws -> () -> Void {
        let back = images.compactMap(PickedPhoto.init(restoring:))
        guard photos.count + loadingPhotos + back.count <= PastedImage.maxPerMessage else {
            throw PairingError("Remove a photo first: a message can hold three.")
        }
        let before = (draft, photos)
        draft = [draft, text].map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
            .joined(separator: "\n\n")
        photos += back
        error = nil
        return {
            draft = before.0
            photos = before.1
        }
    }

    private func stop() {
        guard let chatId else { return }
        Task {
            do { try await connection.stop(chatId) } catch { self.error = error.localizedDescription }
        }
    }
}

/// The desktop's .composer-stop red, the same in light and dark.
private let stopRed = Color(red: 0xED / 255, green: 0x39 / 255, blue: 0x49 / 255)
