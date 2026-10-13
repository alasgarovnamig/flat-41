// swift-tools-version: 6.0
// EvTapCore — platform-neutral core of the EvTap iOS app: Codable DTOs, API client, realtime,
// formatting, pricing and validation. No UIKit / SwiftUI so it also builds and tests on Linux
// (`swift test` inside this folder).
import PackageDescription

let package = Package(
    name: "EvTapCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "EvTapCore", targets: ["EvTapCore"]),
    ],
    targets: [
        .target(
            name: "EvTapCore",
            path: "Sources/EvTapCore"
        ),
        .testTarget(
            name: "EvTapCoreTests",
            dependencies: ["EvTapCore"],
            path: "Tests/EvTapCoreTests"
        ),
    ],
    swiftLanguageModes: [.v6]
)
