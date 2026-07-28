import ChatGPTModelSelector
import SwiftUI

struct DemoContentView: View {
  @State private var selectedTier: ModelTier = .medium

  var body: some View {
    ZStack {
      Color.platformBackground
        .ignoresSafeArea()

      ModelSelector(
        modelName: "GPT-5.4",
        selection: $selectedTier
      )
    }
  }
}

extension Color {
  fileprivate static let platformBackground: Color = {
    #if os(macOS)
      Color(nsColor: .windowBackgroundColor)
    #else
      Color(uiColor: .systemBackground)
    #endif
  }()
}

#Preview("Model selector demo") {
  DemoContentView()
}
