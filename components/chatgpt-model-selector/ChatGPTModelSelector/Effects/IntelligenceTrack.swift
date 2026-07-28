import SwiftUI

struct IntelligenceTrack: View {
  let position: Double
  let knobDiameter: Double
  let trackHeight: Double
  let isActive: Bool

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.scenePhase) private var scenePhase

  private static let particles = TrackParticle.makeParticles(count: 12, seed: 0x54A7_2026)

  var body: some View {
    ZStack {
      Canvas(opaque: false, colorMode: .nonLinear, rendersAsynchronously: false) { context, size in
        drawBackground(in: &context, size: size)
      }

      TimelineView(
        .animation(
          minimumInterval: 1.0 / 60.0,
          paused: !isActive || reduceMotion || scenePhase != .active
        )
      ) { timeline in
        Canvas(opaque: false, colorMode: .nonLinear, rendersAsynchronously: false) {
          context, size in
          drawActiveTrack(
            in: &context,
            size: size,
            elapsed: reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate
          )
        }
      }
      .mask(TrackProgressMask(position: position, knobDiameter: knobDiameter))
    }
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }

  private func drawBackground(in context: inout GraphicsContext, size: CGSize) {
    let trackY = (size.height - trackHeight) / 2
    let trackRect = CGRect(x: 0, y: trackY, width: size.width, height: trackHeight)
    let span = max(0, size.width - knobDiameter)

    context.fill(
      Path(roundedRect: trackRect, cornerRadius: trackHeight / 2),
      with: .color(SelectorTheme.track)
    )
    drawTicks(in: &context, trackY: trackY, span: span)
  }

  private func drawActiveTrack(
    in context: inout GraphicsContext,
    size: CGSize,
    elapsed: TimeInterval
  ) {
    let trackY = (size.height - trackHeight) / 2
    let trackRect = CGRect(x: 0, y: trackY, width: size.width, height: trackHeight)
    let trackPath = Path(roundedRect: trackRect, cornerRadius: trackHeight / 2)

    let gradient = Gradient(colors: SelectorTheme.intelligenceColors(at: position))
    context.drawLayer { activeLayer in
      activeLayer.clip(to: trackPath)
      activeLayer.fill(
        trackPath,
        with: .linearGradient(
          gradient,
          startPoint: CGPoint(x: 0, y: trackY),
          endPoint: CGPoint(x: size.width, y: trackY)
        )
      )

      drawParticles(
        in: &activeLayer,
        size: size,
        trackY: trackY,
        elapsed: elapsed
      )
    }
  }

  private func drawTicks(
    in context: inout GraphicsContext,
    trackY: Double,
    span: Double
  ) {
    for tier in ModelTier.allCases {
      let centerX = knobDiameter / 2 + tier.normalizedPosition * span
      let rect = CGRect(
        x: centerX - 2.5,
        y: trackY + trackHeight / 2 - 2.5,
        width: 5,
        height: 5
      )
      context.fill(Path(ellipseIn: rect), with: .color(SelectorTheme.tertiaryInk))
    }
  }

  private func drawParticles(
    in context: inout GraphicsContext,
    size: CGSize,
    trackY: Double,
    elapsed: TimeInterval
  ) {
    let wrapWidth = size.width + 6

    for particle in Self.particles {
      let origin = particle.horizontalPosition * size.width
      var x = (origin - elapsed * particle.speed).truncatingRemainder(dividingBy: wrapWidth)
      if x < -3 { x += wrapWidth }

      let phase =
        reduceMotion
        ? particle.phase
        : elapsed * particle.twinkle + particle.phase
      let wave = 0.5 + 0.5 * sin(phase)
      let opacity = 0.06 + 0.74 * wave * wave
      let y = trackY + 4 + particle.verticalPosition * max(0, trackHeight - 8)
      let rect = CGRect(
        x: x - particle.radius,
        y: y - particle.radius,
        width: particle.radius * 2,
        height: particle.radius * 2
      )

      context.fill(
        Path(ellipseIn: rect),
        with: .color(.white.opacity(opacity))
      )
    }
  }
}

private struct TrackProgressMask: Shape {
  var position: Double
  let knobDiameter: Double

  var animatableData: Double {
    get { position }
    set { position = newValue }
  }

  func path(in rect: CGRect) -> Path {
    let geometry = SliderGeometry(
      width: rect.width,
      knobDiameter: knobDiameter,
      stopCount: ModelTier.allCases.count
    )
    return Path(
      CGRect(x: rect.minX, y: rect.minY, width: geometry.knobX(for: position), height: rect.height))
  }
}

private struct TrackParticle: Sendable {
  let horizontalPosition: Double
  let verticalPosition: Double
  let radius: Double
  let phase: Double
  let twinkle: Double
  let speed: Double

  static func makeParticles(count: Int, seed: UInt64) -> [Self] {
    var generator = SeededGenerator(seed: seed)
    return (0..<count).map { _ in
      Self(
        horizontalPosition: generator.nextUnit(),
        verticalPosition: generator.nextUnit(),
        radius: 0.8 + generator.nextUnit() * 0.9,
        phase: generator.nextUnit() * Double.pi * 2,
        twinkle: 2.5 + generator.nextUnit() * 4.5,
        speed: 85 + generator.nextUnit() * 50
      )
    }
  }
}

private struct SeededGenerator: Sendable {
  private var state: UInt64

  init(seed: UInt64) {
    state = seed
  }

  mutating func nextUnit() -> Double {
    state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
    return Double(state >> 11) / Double(1 << 53)
  }
}
