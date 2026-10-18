import RelayRemote
import SwiftUI

/// First run, or another computer: scan the code Relay shows on the computer. The field behind
/// the words is the scanner: it folds up into the viewfinder, locks onto the code, and the code
/// bursts back into it; the computer's ring going out across it is the pairing going through.
struct PairingView: View {
    @Binding var incoming: IncomingPair?
    @Binding var holding: Bool

    /// In Relay's own colours: pairing another computer shouldn't wear the one already paired's.
    var body: some View {
        PairingScreen(incoming: $incoming, holding: $holding).defaultTheme()
    }
}

private struct PairingScreen: View {
    @Environment(Connection.self) private var connection
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colors) private var colors
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Opened over the app, from Settings or a link, rather than being the app's first screen.
    @Environment(\.isPresented) private var presented
    /// A link that arrived from the Camera app or a tap on a relay-remote:// link;
    /// cleared on Continue, as its code works only once.
    @Binding var incoming: IncomingPair?
    /// Up from the start of a pairing until Continue, so the root doesn't swap this screen for
    /// the threads the moment the computer says yes.
    @Binding var holding: Bool
    @State private var scan = PairingScan()
    @State private var pasting = false
    @State private var pasted = ""
    /// A pairing's under way.
    @State private var pairing = false
    /// The camera and local network prompts are up, before the scan starts.
    @State private var asking = false
    /// The computer being paired with, or last paired with.
    @State private var name = ""
    @State private var error: String?
    /// The camera read a code that isn't Relay's.
    @State private var notOurs = false

    var body: some View {
        ZStack {
            glow
            ScanStage(scan: scan, palette: RipplePalette(colors)) { reason in error = reason }
                .ignoresSafeArea()
            hint
            close
            welcome.shown(scan.face == .idle, away: -12)
            VStack(spacing: 0) {
                Spacer()
                ZStack(alignment: .top) {
                    copy("Pair with your computer", "On your computer, open Relay, go to Settings → Phone and scan the code shown there.", error: error)
                        .shown(scan.face == .idle, away: 18)
                    copy("Paired with \(name)", "Its threads show up here as soon as they start.")
                        .shown(scan.face == .paired, away: -12)
                }
                Spacer().frame(height: 40)
                ZStack(alignment: .bottom) {
                    pairActions.shown(scan.face == .idle, away: 46)
                    Button {
                        holding = false
                        incoming = nil
                        dismiss()
                    } label: {
                        Text("Continue").accentGlassLabel()
                    }
                    .accentGlass(colors)
                    .shown(scan.face == .paired, away: 46)
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 8)
        }
        .animation(.spring(duration: 0.5, bounce: 0.15), value: scan.face)
        .statusBarHidden(scan.cameraCovers)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .relayBackground()
        .alert("Pairing link", isPresented: $pasting) {
            TextField("relay-remote://pair?…", text: $pasted)
            Button("Pair") { take(pasted) }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Copy the link under the code in Relay's Settings → Phone.")
        }
        .task(id: incoming?.id) {
            if let incoming { await pair(incoming.link) }
        }
        .task(id: notOurs) {
            guard notOurs else { return }
            try? await Task.sleep(for: .seconds(2.5))
            notOurs = false
        }
        .onAppear {
            scan.reduceMotion = reduceMotion
            scan.onRead = { read($0) }
        }
        .onChange(of: reduceMotion) { _, now in scan.reduceMotion = now }
    }

    /// The theme's accent, faintly, behind where the field meets the sky.
    private var glow: some View {
        GeometryReader { g in
            EllipticalGradient(
                colors: [colors.accent.opacity(colors.dark ? 0.16 : 0.1), .clear], center: .center,
                // Fractions of the whole frame: gone at 70% of the way to its edge.
                startRadiusFraction: 0, endRadiusFraction: 0.35
            )
            .frame(width: g.size.width * 1.2, height: g.size.height * 0.68)
            .position(x: g.size.width / 2, y: g.size.height * 0.36)
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }

    /// Who's asking, above the field, before a scan starts.
    private var welcome: some View {
        VStack(spacing: 4) {
            Image("RelayMark")
                .resizable()
                .scaledToFit()
                .frame(width: 56, height: 56)
                .shadow(color: colors.accent.opacity(0.5), radius: 12)
            Text("Relay")
                .font(.system(size: 34, weight: .heavy))
                .tracking(-0.6)
            Text("Your agents, in your pocket")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        // The mark level with the close button, the words clear of the field's far edge.
        .padding(.top, 8)
        .allowsHitTesting(false)
        .accessibilityElement(children: .combine)
    }

    private var hint: some View {
        let text =
            switch scan.face {
            case .scan: notOurs ? "That isn't a Relay pairing code." : "Point at the code on your computer"
            default: "Pairing with \(name)…"
            }
        return GeometryReader { g in
            Text(text)
                .font(.subheadline)
                .foregroundStyle(scan.cameraCovers ? AnyShapeStyle(.white) : AnyShapeStyle(.secondary))
                .shadow(color: .black.opacity(scan.cameraCovers ? 0.5 : 0), radius: 6, y: 1)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .frame(width: g.size.width)
                .position(x: g.size.width / 2, y: g.size.height * 0.623)
                .contentTransition(.opacity)
        }
        .ignoresSafeArea()
        .opacity(scan.face == .pairing || (scan.face == .scan && scan.cameraCovers) ? 1 : 0)
        .allowsHitTesting(false)
    }

    /// Scanning, it closes the camera; opened over the app, it backs out of pairing.
    private var close: some View {
        let shown = scan.face == .scan || (scan.face == .idle && presented)
        return VStack {
            HStack {
                Button {
                    if scan.face == .scan { scan.close() } else { dismiss() }
                } label: {
                    Image(systemName: "xmark")
                        .font(.body.weight(.semibold))
                        .frame(width: 30, height: 30)
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .controlSize(.large)
                .accessibilityLabel(scan.face == .scan ? "Close camera" : "Close")
                Spacer()
            }
            Spacer()
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
        .opacity(shown ? 1 : 0)
        .allowsHitTesting(shown)
        .accessibilityHidden(!shown)
    }

    private func copy(_ title: String, _ text: String, error: String? = nil) -> some View {
        VStack(spacing: 8) {
            Text(title)
                .font(.title2.bold())
            Text(text)
                .foregroundStyle(.secondary)
            if let error {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .padding(.top, 4)
            }
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
    }

    private var pairActions: some View {
        VStack(spacing: 12) {
            if CodeCameras.canScan {
                Button {
                    error = nil
                    asking = true
                    Task {
                        defer { asking = false }
                        guard await ScanPermissions.camera() else {
                            error = "Relay can't use the camera. Allow it in Settings, or paste the pairing link instead."
                            return
                        }
                        await ScanPermissions.localNetwork()
                        scan.start()
                    }
                } label: {
                    Label("Scan code", systemImage: "camera").accentGlassLabel()
                }
                .accentGlass(colors)
            }
            Button {
                pasting = true
            } label: {
                Text("Paste a pairing link").frame(maxWidth: .infinity)
            }
            .buttonStyle(.glass)
            .controlSize(.large)
            // Reaching the computer from outside its network takes Tailscale on both.
            Link(destination: URL(string: "https://apps.apple.com/app/tailscale/id1470499037")!) {
                HStack(spacing: 4) {
                    Text("Away from home?").foregroundStyle(.secondary)
                    Text("Get Tailscale").fontWeight(.medium).foregroundStyle(.primary)
                    Image(systemName: "arrow.up.right").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                }
                .font(.footnote)
                .padding(.vertical, 4)
            }
        }
        .disabled(pairing || asking)
    }

    /// The camera read a code: pair with it if it's Relay's.
    private func read(_ text: String) -> Bool {
        guard let link = parsePairingURL(text) else {
            notOurs = true
            return false
        }
        Task { await pair(link) }
        return true
    }

    private func take(_ text: String) {
        guard let link = parsePairingURL(text) else {
            error = "That isn't a Relay pairing code."
            return
        }
        Task { await pair(link) }
    }

    private func pair(_ link: PairingLink) async {
        pairing = true
        name = link.name
        error = nil
        holding = true
        scan.pairingWithoutScan()
        defer { pairing = false }
        do {
            try await connection.pair(link)
            scan.paired()
        } catch {
            self.error = error.localizedDescription
            holding = false
            scan.failed()
        }
    }
}

extension PairingView {
    init() { self.init(incoming: .constant(nil), holding: .constant(false)) }
}

extension View {
    /// The accent as glass the field shows through, where `.glassProminent` fills it in solid.
    fileprivate func accentGlass(_ colors: RelayColors) -> some View {
        buttonStyle(.plain)
            .glassEffect(.clear.tint(colors.accent.opacity(colors.dark ? 0.45 : 0.65)).interactive(), in: .capsule)
    }

    /// A large glass button's size, white on the accent.
    fileprivate func accentGlassLabel() -> some View {
        foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 50)
            .contentShape(.capsule)
    }

    /// In place, or faded and slid `away` points down (up when negative) when not `on`.
    fileprivate func shown(_ on: Bool, away: CGFloat) -> some View {
        opacity(on ? 1 : 0)
            .offset(y: on ? 0 : away)
            .allowsHitTesting(on)
            .accessibilityHidden(!on)
    }
}
