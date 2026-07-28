import SwiftUI

enum SelectorTheme {
  static let systemBackground = Color.white

  static let blue = Color(red: 3 / 255, green: 113 / 255, blue: 221 / 255)
  static let violet = Color(red: 162 / 255, green: 120 / 255, blue: 251 / 255)
  static let ultraText = Color(red: 124 / 255, green: 58 / 255, blue: 237 / 255)
  static let ink = Color(red: 26 / 255, green: 29 / 255, blue: 33 / 255)
  static let secondaryInk = Color(red: 142 / 255, green: 146 / 255, blue: 153 / 255)
  static let tertiaryInk = Color(red: 192 / 255, green: 192 / 255, blue: 194 / 255)
  static let track = Color(red: 225 / 255, green: 225 / 255, blue: 228 / 255)
  static let pillBackground = Color(red: 241 / 255, green: 242 / 255, blue: 243 / 255)
  static let rowPressed = Color(red: 245 / 255, green: 245 / 255, blue: 247 / 255)
  static let hairline = Color(red: 236 / 255, green: 236 / 255, blue: 238 / 255)
  static let shadow = Color.black

  private static let levelPalettes: [LevelPalette] = [
    LevelPalette(hex: [0x159DC5, 0x35B5D3, 0x65C9DD]),
    LevelPalette(hex: [0x0875D9, 0x2D8AE6, 0x5AA0ED]),
    LevelPalette(hex: [0x315FD3, 0x5F72E5, 0x7E8BED]),
    LevelPalette(hex: [0x5652D2, 0x8167E8, 0x9D7AF2]),
    LevelPalette(hex: [0x2E61D4, 0xA57BFD, 0x8B73F3]),
  ]

  private static let levelLabelColors: [RGBColor] = [
    RGBColor(hex: 0x1680B8),
    RGBColor(hex: 0x1768C4),
    RGBColor(hex: 0x4654C6),
    RGBColor(hex: 0x6840C7),
    RGBColor(hex: 0x7C3AED),
  ]

  static func intelligenceColors(at normalizedPosition: Double) -> [Color] {
    let scaledPosition = normalizedPosition.clamped(to: 0...1) * Double(levelPalettes.count - 1)
    let lowerIndex = Int(scaledPosition)
    let upperIndex = min(lowerIndex + 1, levelPalettes.count - 1)
    let progress = scaledPosition - Double(lowerIndex)
    let lowerPalette = levelPalettes[lowerIndex]
    let upperPalette = levelPalettes[upperIndex]

    return zip(lowerPalette.stops, upperPalette.stops).map { lower, upper in
      lower.interpolated(to: upper, progress: progress).color
    }
  }

  static func levelLabelColor(for tier: ModelTier) -> Color {
    levelLabelColors[tier.rawValue].color
  }
}

private struct LevelPalette: Sendable {
  let stops: [RGBColor]

  init(hex: [UInt32]) {
    stops = hex.map(RGBColor.init(hex:))
  }
}

private struct RGBColor: Sendable {
  let red: Double
  let green: Double
  let blue: Double

  init(hex: UInt32) {
    red = Double((hex >> 16) & 0xFF) / 255
    green = Double((hex >> 8) & 0xFF) / 255
    blue = Double(hex & 0xFF) / 255
  }

  var color: Color {
    Color(red: red, green: green, blue: blue)
  }

  func interpolated(to other: Self, progress: Double) -> Self {
    Self(
      red: red + (other.red - red) * progress,
      green: green + (other.green - green) * progress,
      blue: blue + (other.blue - blue) * progress
    )
  }

  private init(red: Double, green: Double, blue: Double) {
    self.red = red
    self.green = green
    self.blue = blue
  }
}

extension Comparable {
  fileprivate func clamped(to range: ClosedRange<Self>) -> Self {
    min(max(self, range.lowerBound), range.upperBound)
  }
}
