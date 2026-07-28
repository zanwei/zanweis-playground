import SwiftUI

struct IntelligenceSlider: View {
  @Binding var selection: ModelTier
  @Binding var isDragging: Bool
  let isActive: Bool

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var dragPosition: Double?
  @State private var celebrationTrigger = 0
  @State private var celebrationTask: Task<Void, Never>?

  @ScaledMetric(relativeTo: .body) private var knobDiameter = 34.0
  @ScaledMetric(relativeTo: .body) private var trackHeight = 28.0
  @ScaledMetric(relativeTo: .body) private var controlHeight = 38.0
  private let snapDuration = 0.22
  private let snapBounce = 0.02
  private let magneticStrength = 0.9

  var body: some View {
    GeometryReader { proxy in
      let width = proxy.size.width
      let geometry = sliderGeometry(width: width)
      let position = dragPosition ?? selection.normalizedPosition
      let knobX = geometry.knobX(for: position)

      IntelligenceTrack(
        position: position,
        knobDiameter: knobDiameter,
        trackHeight: trackHeight,
        isActive: isActive
      )
      .frame(width: width, height: proxy.size.height)
      .overlay {
        knobWithCelebration
          .offset(x: knobX - width / 2)
      }
      .contentShape(Rectangle())
      .gesture(dragGesture(width: width))
    }
    .frame(height: controlHeight)
    .animation(
      reduceMotion || isDragging
        ? nil
        : .spring(duration: snapDuration, bounce: snapBounce),
      value: selection
    )
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Model intelligence")
    .accessibilityValue(selection.accessibilityValue)
    .accessibilityHint(
      "Swipe up or down to change. Lower values are faster; higher values are smarter."
    )
    .accessibilityAdjustableAction(adjustSelection)
    .onDisappear {
      celebrationTask?.cancel()
    }
    .onChange(of: isActive) {
      guard !isActive else { return }
      celebrationTask?.cancel()
      isDragging = false
      dragPosition = nil
    }
  }

  private var knobWithCelebration: some View {
    ZStack {
      ConfettiBurst(trigger: celebrationTrigger)
        .frame(width: 100, height: 100)

      Circle()
        .fill(SelectorTheme.systemBackground)
        .frame(width: knobDiameter, height: knobDiameter)
        .shadow(color: SelectorTheme.shadow.opacity(0.1), radius: 1, y: 1)
        .shadow(
          color: SelectorTheme.shadow.opacity(isDragging ? 0.18 : 0.14),
          radius: isDragging ? 5 : 3,
          y: isDragging ? 4 : 2
        )
        .scaleEffect(isDragging ? 1.04 : 1)
    }
    .frame(width: 100, height: 100)
    .compositingGroup()
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }

  private func dragGesture(width: Double) -> some Gesture {
    DragGesture(minimumDistance: 0)
      .onChanged { value in
        if !isDragging {
          celebrationTask?.cancel()
          isDragging = true
        }

        let geometry = sliderGeometry(width: width)
        let rawPosition = geometry.normalizedPosition(
          for: value.location.x,
          fallback: selection.normalizedPosition
        )
        let position = magnetizedPosition(rawPosition, geometry: geometry)
        dragPosition = position
        let nextSelection = ModelTier.closest(to: position)
        if selection != nextSelection {
          selection = nextSelection
        }
      }
      .onEnded { value in
        let geometry = sliderGeometry(width: width)
        let rawPosition = geometry.normalizedPosition(
          for: value.location.x,
          fallback: selection.normalizedPosition
        )
        let position = magnetizedPosition(rawPosition, geometry: geometry)
        let target = ModelTier.closest(to: position)
        selection = target
        isDragging = false

        withAnimation(
          reduceMotion
            ? nil
            : .spring(duration: snapDuration, bounce: snapBounce)
        ) {
          dragPosition = nil
        }

        scheduleCelebrationIfNeeded(for: target)
      }
  }

  private func sliderGeometry(width: Double) -> SliderGeometry {
    SliderGeometry(
      width: width,
      knobDiameter: knobDiameter,
      stopCount: ModelTier.allCases.count
    )
  }

  private func magnetizedPosition(_ rawPosition: Double, geometry: SliderGeometry) -> Double {
    geometry.magnetizedPosition(rawPosition, strength: magneticStrength, exponent: 1.45)
  }

  private func adjustSelection(_ direction: AccessibilityAdjustmentDirection) {
    switch direction {
    case .increment:
      selection = selection.stepped(by: 1)
    case .decrement:
      selection = selection.stepped(by: -1)
    @unknown default:
      return
    }

    scheduleCelebrationIfNeeded(for: selection)
  }

  private func scheduleCelebrationIfNeeded(for tier: ModelTier) {
    guard tier == .ultra, !reduceMotion else { return }
    celebrationTask?.cancel()
    celebrationTask = Task { @MainActor in
      try? await Task.sleep(for: .milliseconds(120))
      guard !Task.isCancelled, selection == .ultra else { return }
      celebrationTrigger += 1
    }
  }
}
