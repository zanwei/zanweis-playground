import Foundation

struct SliderGeometry: Sendable {
  let width: Double
  let knobDiameter: Double
  let stopCount: Int

  var span: Double {
    max(0, width - knobDiameter)
  }

  func knobX(for position: Double) -> Double {
    knobDiameter / 2 + clamped(position) * span
  }

  func normalizedPosition(for x: Double, fallback: Double) -> Double {
    guard span > 0 else { return clamped(fallback) }
    return clamped((x - knobDiameter / 2) / span)
  }

  func magnetizedPosition(
    _ rawPosition: Double,
    strength: Double,
    exponent: Double
  ) -> Double {
    guard stopCount > 1 else { return 0 }

    let intervalCount = Double(stopCount - 1)
    let scaledPosition = clamped(rawPosition) * intervalCount
    let nearestStop = scaledPosition.rounded()
    let normalizedDistance = min(abs(scaledPosition - nearestStop) * 2, 1)
    let influence = clamped(strength) * pow(1 - normalizedDistance, max(exponent, 0))
    return clamped((scaledPosition + (nearestStop - scaledPosition) * influence) / intervalCount)
  }

  private func clamped(_ value: Double) -> Double {
    min(max(value, 0), 1)
  }
}
