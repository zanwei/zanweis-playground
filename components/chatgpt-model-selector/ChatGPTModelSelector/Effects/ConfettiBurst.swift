import SwiftUI

struct ConfettiBurst: View {
  let trigger: Int

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var startedAt: Date?

  private let animationDuration = 0.24

  var body: some View {
    TimelineView(
      .animation(
        minimumInterval: 1.0 / 60.0,
        paused: reduceMotion || startedAt == nil
      )
    ) { timeline in
      Canvas(opaque: false, colorMode: .nonLinear, rendersAsynchronously: false) { context, size in
        guard let startedAt else { return }
        let elapsed = timeline.date.timeIntervalSince(startedAt)
        let progress = min(max(elapsed / animationDuration, 0), 1)
        drawParticles(in: &context, size: size, progress: progress)
      }
    }
    .task(id: trigger) {
      guard trigger > 0, !reduceMotion else {
        startedAt = nil
        return
      }

      startedAt = .now
      try? await Task.sleep(for: .milliseconds(280))
      guard !Task.isCancelled else { return }
      startedAt = nil
    }
  }

  private func drawParticles(
    in context: inout GraphicsContext,
    size: CGSize,
    progress: Double
  ) {
    let easedProgress = 1 - pow(1 - progress, 3)
    let radius = 17 + 17 * easedProgress
    let opacity = pow(1 - progress, 1.5)
    let particleSize = 5 * (1 - 0.3 * progress)
    let center = CGPoint(x: size.width / 2, y: size.height / 2)

    for index in 0..<14 {
      let angle = Double(index) / 14 * Double.pi * 2
      let rect = CGRect(
        x: center.x + cos(angle) * radius - particleSize / 2,
        y: center.y + sin(angle) * radius - particleSize / 2,
        width: particleSize,
        height: particleSize
      )
      context.fill(
        Path(ellipseIn: rect),
        with: .color(particleColor(for: index).opacity(opacity))
      )
    }
  }

  private func particleColor(for index: Int) -> Color {
    switch index % 4 {
    case 0:
      Color(red: 201 / 255, green: 176 / 255, blue: 240 / 255)
    case 1:
      Color(red: 191 / 255, green: 165 / 255, blue: 242 / 255)
    case 2:
      Color(red: 212 / 255, green: 195 / 255, blue: 247 / 255)
    default:
      Color(red: 183 / 255, green: 158 / 255, blue: 245 / 255)
    }
  }
}
