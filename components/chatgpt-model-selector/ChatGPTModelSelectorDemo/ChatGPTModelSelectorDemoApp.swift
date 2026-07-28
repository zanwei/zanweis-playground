import ChatGPTModelSelector
import SwiftUI

#if os(macOS)
  import AppKit
#endif

@main
struct ChatGPTModelSelectorDemoApp: App {
  #if os(macOS)
    init() {
      NSApplication.shared.setActivationPolicy(.regular)
      NSApplication.shared.activate()
    }
  #endif

  var body: some Scene {
    #if os(macOS)
      WindowGroup {
        DemoContentView()
          .frame(minWidth: 640, minHeight: 520)
      }
      .defaultSize(width: 720, height: 600)
    #else
      WindowGroup {
        DemoContentView()
      }
    #endif
  }

}
