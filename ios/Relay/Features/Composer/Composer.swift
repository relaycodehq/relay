import PhotosUI
import RelayRemote
import SwiftUI

/// What the composer hands over to send.
struct ComposerSend {
    /// The message's own id: a draft that failed to go is sent again with it, so it can't land twice.
    var id = UUID().uuidString.lowercased()
    var text: String
    var images: [PastedImage]
    var settings: ResumeSettings
    /// Into the running answer rather than behind it.
    var steer = false
    /// Set for later rather than now.
    var sendAt: Int64?
    /// The draft to send from the computer's composer, which holds part of it.
    var throughDraft: String?
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
    /// The draft it writes, kept here and shared with the computer; nil keeps nothing.
    var draftKey: String?
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
    @Environment(ReadAloud.self) private var reader
    @State private var draft = ""
    @State private var photos: [PickedPhoto] = []
    @State private var picked: [PhotosPickerItem] = []
    @State private var loadingPhotos = 0
    @State private var sending = false
    @State private var error: String?
    @State private var dictation = DictationSession()
    /// Where dictated words go while typing (Android's DictationInput).
    @State private var cursor: SwiftUI.TextSelection?
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
    /// Whose draft the field holds, `computer\nkey`; nil until one loaded.
    @State private var draftLoaded: String?
    /// Whose unsent photos `photos` are, `computer\nkey` as `draftLoaded`.
    @State private var photosLoaded: String?
    /// The send that failed last, tried again as it was while the draft stays the same.
    @State private var failed: Attempt?

    private var draftAt: (computer: String, key: String)? {
        guard let computer = connection.active, let draftKey else { return nil }
        return (computer, draftKey)
    }
    private var draftID: String? { draftAt.map { "\($0.computer)\n\($0.key)" } }

    private var running: Bool { chatId.map { connection.running($0, rootId: rootId) } ?? false }
    private var text: String { draft.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var empty: Bool { text.isEmpty && photos.isEmpty && computerShots.isEmpty }

    /// Screenshots the computer's composer has in this draft; they go with it from there.
    private var computerShots: [Int] {
        guard let at = draftAt, (connection.overview?.bridge ?? 1) >= Bridge.drafts else { return [] }
        return connection.drafts.shared(at.computer, at.key)?.extras?.screenshots ?? []
    }

    /// The send as it'd go now, for telling a retry of the one that failed from a new one.
    private func attempt(steer: Bool, sendAt: Int64?) -> Attempt {
        Attempt(
            target: draftID ?? chatId ?? projectId ?? "", text: text, photos: photos.map(\.id), settings: settings,
            steer: steer, sendAt: sendAt)
    }

    /// The failed send will go at the time it was set for.
    private var retryingScheduled: Bool {
        guard let failed, failed.sendAt != nil else { return false }
        return failed.same(as: attempt(steer: false, sendAt: nil))
    }
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
                if let shown = error.map({ retryingScheduled ? "\($0) Tap send to retry at the original time." : $0 })
                    ?? dictation.error
                {
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
                if let at = draftAt {
                    DraftNotes(computer: at.computer, key: at.key)
                }
                if !photos.isEmpty || loadingPhotos > 0 || !computerShots.isEmpty {
                    PhotoStrip(photos: photos, loading: loadingPhotos, computerShots: computerShots) { id in
                        photos.removeAll { $0.id == id }
                    }
                    .padding(.top, 4)
                }
                TextField(running ? "Queue a message" : placeholder, text: $draft, selection: $cursor, axis: .vertical)
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
            Button("Switch to \(agentName(incoming))") {
                if let pending = switching { submit(steer: pending.steer, sendAt: pending.sendAt, confirmed: true) }
            }
            Button("Keep \(agentName(holder ?? ""))", role: .cancel) {}
        } message: {
            let from = agentName(holder ?? "")
            let next = agentName(incoming)
            Text(
                "\(from) has been working in this thread. \(next) cannot see its session, tool results, or the files it read.\n\n"
                    + "\(from) will write a handoff note first. \(next) continues from that note and the recent messages, so expect some context to be lost."
            )
        }
        // Background only: the microphone prompt, Control Center or a call banner leave it
        // inactive, and the first of those stopped the dictation it was asking for.
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { dictation.stop() }
        }
        .onDisappear { dictation.stop() }
        // One voice at a time: reading aloud ends dictation, and dictating ends a reading.
        .onChange(of: reader.key) { _, key in
            if key != nil { dictation.stop() }
        }
        .task(id: draftID) {
            loadDraft()
            loadPhotos()
        }
        .onChange(of: photos.map(\.id)) {
            if let id = photosLoaded { UnsentPhotos.keep(photos, for: id) }
        }
        .onChange(of: draft) { _, now in
            if let at = draftAt, draftLoaded == draftID { connection.drafts.editText(at.computer, at.key, now) }
        }
        // Changed on the computer or another phone: the field takes it.
        .onChange(of: draftAt.map { connection.drafts.changes($0.computer, $0.key) }) {
            guard let at = draftAt, draftLoaded == draftID else { return }
            let now = connection.drafts.text(at.computer, at.key)
            if now != draft { draft = now }
        }
        .onAppear {
            handle?.restore = restore
            handle?.compose = { text, earlier in draft = composeInto(draft, text, earlier: earlier) }
            handle?.quote = { markdown in
                Task {
                    // Keep the words already spoken; a dictation update mustn't overwrite the quote.
                    if dictation.phase != .idle { await dictation.finish() }
                    draft = appendQuote(draft, markdown)
                    cursor = SwiftUI.TextSelection(insertionPoint: draft.endIndex)
                    focused.wrappedValue = true
                }
            }
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
                UsagePage(provider: provider, context: context, cost: cost, compact: compact).fitsSheet()
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
                        .font(.mono(size: 18))
                        .frame(width: 26, height: 36)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .accessibilityLabel("Commands")
            }
            if dictation.phase == .listening {
                Button("Discard dictation", systemImage: "xmark") { dictation.cancel() }
                    .labelStyle(.iconOnly)
                    .font(.system(size: 16))
                    .foregroundStyle(.secondary)
                    .frame(width: 30, height: 36)
                    .contentShape(.rect)
                    .buttonStyle(.plain)
                    .transition(.opacity)
            }
            if connection.canDictate {
                DictationButton(session: dictation) {
                    reader.stop()
                    // At the cursor while typing, after the draft otherwise.
                    let at = focused.wrappedValue ? cursor.flatMap { characterRange($0, in: draft) } : nil
                    dictation.start(in: draft, at: at, with: connection) { placed in
                        draft = placed.text
                        let end = draft.index(draft.startIndex, offsetBy: min(placed.end, draft.count))
                        cursor = SwiftUI.TextSelection(insertionPoint: end)
                    }
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
            .buttonStyle(.accentCircle(tint: stops ? stopRed : nil))
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

    /// Who the draft goes to: the picked agent, or the one it @mentions.
    private var incoming: String { settings.map { sendRecipient(text, picked: $0.provider) } ?? "" }

    private var switchTitle: String { "Switch to \(agentName(incoming))?" }

    private func submit(steer: Bool = false, sendAt: Int64? = nil, confirmed: Bool = false) {
        if !confirmed, startsWithCommand(text), !command(text) { return }
        // A `/btw` question goes beside the conversation; nobody takes over.
        let side = rootId == nil && text.range(of: "^/btw\\s", options: [.regularExpression, .caseInsensitive]) != nil
        if !confirmed, !side, let settings, takesOver(sendRecipient(text, picked: settings.provider), holder: holder) {
            switching = (steer, sendAt)
            return
        }
        Task {
            if dictation.phase != .idle { await dictation.finish() }
            let body = text
            let sent = photos
            let at = draftAt
            let through = draftKey.map(connection.sendsThroughComputer) ?? false
            guard !body.isEmpty || !sent.isEmpty || through else { return }
            // Sent again unchanged after failing: as it was, under its own id, so it can't go twice.
            let fresh = attempt(steer: steer, sendAt: sendAt)
            let attempt = !steer && sendAt == nil ? failed.flatMap { $0.same(as: fresh) ? $0 : nil } ?? fresh : fresh
            failed = nil
            // Cleared as it goes, so leaving mid-send keeps no draft; it comes back if sending fails.
            if let at { connection.drafts.hold(at.computer, at.key) }
            sending = true
            error = nil
            draft = ""
            photos = []
            defer { sending = false }
            do {
                guard let settings else { throw PairingError("Wait for your computer to say which agent answers.") }
                try await send(
                    ComposerSend(
                        id: attempt.id, text: body, images: sent.map(\.image), settings: settings, steer: attempt.steer,
                        sendAt: attempt.sendAt, throughDraft: through ? draftKey : nil))
                if let at { connection.drafts.went(at.computer, at.key, text: body, throughComputer: through) }
            } catch {
                if let at { connection.drafts.release(at.computer, at.key) }
                failed = attempt
                self.error = error.localizedDescription
                if draft.isEmpty { draft = body }
                if photos.isEmpty { photos = sent }
            }
            // The draft ignored edits while the send held it: what was typed meanwhile goes in now.
            if let at { connection.drafts.editText(at.computer, at.key, draft) }
        }
    }

    // MARK: Commands

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
        return commandItems(draft, provider: provider, commands: agentCommands, hidden: [])
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
    /// The draft's saved text into the field. What the field held for another draft stays
    /// with that one; only text put in before any draft loaded goes after the saved text.
    private func loadDraft() {
        guard let at = draftAt, let id = draftID else {
            draftLoaded = nil
            return
        }
        connection.drafts.load(at.computer)
        let saved = connection.drafts.text(at.computer, at.key).trimmingCharacters(in: .whitespacesAndNewlines)
        let typed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        if draftLoaded != nil {
            draft = saved
        } else if !saved.isEmpty {
            draft = !typed.isEmpty && typed != saved ? "\(saved)\n\n\(typed)" : saved
        }
        draftLoaded = id
        connection.drafts.editText(at.computer, at.key, draft)
    }

    /// The draft's unsent photos into the strip, as `loadDraft` does its text; ones picked before
    /// any draft loaded go after them.
    private func loadPhotos() {
        guard let id = draftID else {
            photosLoaded = nil
            return
        }
        let held = UnsentPhotos.take(id)
        photos = photosLoaded != nil ? held : Array((held + photos).prefix(PastedImage.maxPerMessage))
        photosLoaded = id
        UnsentPhotos.keep(photos, for: id)
    }

    private func restore(_ text: String, _ images: [PastedImage]) throws -> () -> Void {
        let back = images.compactMap(PickedPhoto.init(restoring:))
        guard photos.count + loadingPhotos + back.count <= PastedImage.maxPerMessage else {
            throw PairingError("Remove a photo first: a message can hold three.")
        }
        // A side question stays one only at the start of the message.
        if text.hasPrefix("/btw "), !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !photos.isEmpty {
            throw PairingError("Send or clear the current draft before restoring this side question.")
        }
        let body = [draft, text].map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
            .joined(separator: "\n\n")
        guard body.count <= 32_000 else { throw PairingError("Send or shorten the current draft before restoring this message.") }
        let before = (draft, photos)
        draft = body
        cursor = SwiftUI.TextSelection(insertionPoint: draft.endIndex)
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

/// A send as it went: where, what, on which settings, and its id.
private struct Attempt {
    let target: String
    let text: String
    let photos: [PickedPhoto.ID]
    let settings: ResumeSettings?
    let steer: Bool
    let sendAt: Int64?
    var id = UUID().uuidString.lowercased()

    func same(as other: Attempt) -> Bool {
        target == other.target && text == other.text && photos == other.photos && settings == other.settings
    }
}
