import RelayRemote
import SwiftUI
import VisionKit

/// First run, or another computer: scan the code Relay shows on the computer.
struct PairingView: View {
    @Environment(Connection.self) private var connection
    @Environment(\.dismiss) private var dismiss
    /// A link that arrived from the Camera app or a tap on a relay-remote:// link;
    /// cleared once it paired, as its code works only once.
    @Binding var incoming: IncomingPair?
    @State private var scanning = false
    @State private var pasting = false
    @State private var pasted = ""
    @State private var pairingWith: String?
    @State private var error: String?

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "qrcode.viewfinder")
                .font(.system(size: 64, weight: .light))
                .foregroundStyle(.tint)
            VStack(spacing: 8) {
                Text("Pair with your computer")
                    .font(.title2.bold())
                Text("On your computer, open Relay, go to Settings → Phone and scan the code shown there.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
            }
            if let pairingWith {
                ProgressView("Pairing with \(pairingWith)…")
            }
            if let error {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }
            Spacer()
            VStack(spacing: 12) {
                if DataScannerViewController.isSupported {
                    Button {
                        scanning = true
                    } label: {
                        Label("Scan code", systemImage: "camera").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glassProminent)
                    .controlSize(.large)
                }
                Button("Paste a pairing link") { pasting = true }
                    .buttonStyle(.glass)
                    .controlSize(.large)
            }
            .disabled(pairingWith != nil)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .relayBackground()
        .sheet(isPresented: $scanning) {
            CodeScanner { text in
                scanning = false
                take(text)
            }
            .ignoresSafeArea()
        }
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
    }

    private func take(_ text: String) {
        guard let link = parsePairingURL(text) else {
            error = "That isn't a Relay pairing code."
            return
        }
        Task { await pair(link) }
    }

    private func pair(_ link: PairingLink) async {
        pairingWith = link.name
        error = nil
        defer { pairingWith = nil }
        do {
            try await connection.pair(link)
            incoming = nil
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

extension PairingView {
    init() { self.init(incoming: .constant(nil)) }
}

/// VisionKit's live QR scanner; hands over the first code it recognizes.
struct CodeScanner: UIViewControllerRepresentable {
    let found: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        try? scanner.startScanning()
        return scanner
    }

    func updateUIViewController(_ controller: DataScannerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(found: found) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let found: (String) -> Void
        private var done = false

        init(found: @escaping (String) -> Void) { self.found = found }

        func dataScanner(
            _ scanner: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]
        ) {
            for item in items {
                guard !done, case .barcode(let code) = item, let text = code.payloadStringValue else { continue }
                done = true
                scanner.stopScanning()
                found(text)
            }
        }
    }
}
