// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "ChatGPTModelSelector",
  platforms: [
    .iOS(.v17),
    .macOS(.v14),
  ],
  products: [
    .library(
      name: "ChatGPTModelSelector",
      targets: ["ChatGPTModelSelector"]
    ),
    .executable(
      name: "ChatGPTModelSelectorDemo",
      targets: ["ChatGPTModelSelectorDemo"]
    ),
  ],
  targets: [
    .target(
      name: "ChatGPTModelSelector",
      path: "ChatGPTModelSelector",
      exclude: ["Assets.xcassets"]
    ),
    .executableTarget(
      name: "ChatGPTModelSelectorDemo",
      dependencies: ["ChatGPTModelSelector"],
      path: "ChatGPTModelSelectorDemo"
    ),
    .testTarget(
      name: "ChatGPTModelSelectorTests",
      dependencies: ["ChatGPTModelSelector"],
      path: "ChatGPTModelSelectorTests"
    ),
  ]
)
