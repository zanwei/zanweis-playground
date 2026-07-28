import Foundation

/// A discrete intelligence level exposed by ``ModelSelector``.
public enum ModelTier: Int, CaseIterable, Codable, Hashable, Identifiable, Sendable {
  case light
  case medium
  case high
  case extraHigh
  case ultra

  public var id: Int { rawValue }

  public var title: String {
    switch self {
    case .light: "Light"
    case .medium: "Medium"
    case .high: "High"
    case .extraHigh: "Extra High"
    case .ultra: "Ultra"
    }
  }

  public var accessibilityValue: String {
    switch self {
    case .light: "Light, fastest"
    case .medium: "Medium, balanced"
    case .high: "High, smarter"
    case .extraHigh: "Extra High, much smarter"
    case .ultra: "Ultra, smartest, consumes usage limits faster"
    }
  }

  public var normalizedPosition: Double {
    Double(rawValue) / Double(Self.allCases.count - 1)
  }

  static func closest(to normalizedPosition: Double) -> Self {
    let maximum = Double(allCases.count - 1)
    let rawValue = Int((normalizedPosition.clamped(to: 0...1) * maximum).rounded())
    return Self(rawValue: rawValue) ?? .medium
  }

  func stepped(by offset: Int) -> Self {
    let nextValue = (rawValue + offset).clamped(to: 0...(Self.allCases.count - 1))
    return Self(rawValue: nextValue) ?? self
  }
}

extension Comparable {
  fileprivate func clamped(to range: ClosedRange<Self>) -> Self {
    min(max(self, range.lowerBound), range.upperBound)
  }
}
