// swift-tools-version: 6.2
import PackageDescription

// The app's code that knows no UI, built and tested on the Mac with `swift test`.
let package = Package(
    name: "RelayKit",
    platforms: [.iOS(.v26), .macOS(.v26)],
    products: [
        .library(name: "RelayRemote", targets: ["RelayRemote"]),
        .library(name: "RelayMarkdown", targets: ["RelayMarkdown"]),
    ],
    dependencies: [
        .package(url: "https://github.com/swiftlang/swift-markdown", from: "0.9.0"),
    ],
    targets: [
        .target(name: "RelayRemote"),
        /// Answers as blocks to draw: CommonMark with GitHub's tables, task lists and strikethrough,
        /// and math. A display formula's page is a render's, hence RelayRemote.
        .target(
            name: "RelayMarkdown",
            dependencies: ["RelayRemote", .product(name: "Markdown", package: "swift-markdown")]),
        .testTarget(
            name: "RelayRemoteTests",
            dependencies: ["RelayRemote", "RelayMarkdown"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
