// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "VVoiceCore", platforms: [.iOS(.v18), .macOS(.v14)], products: [.library(name: "VVoiceCore", targets: ["VVoiceCore"])], targets: [.target(name: "VVoiceCore"), .testTarget(name: "VVoiceCoreTests", dependencies: ["VVoiceCore"])])
