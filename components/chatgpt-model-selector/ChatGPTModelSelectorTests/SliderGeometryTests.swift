import Testing

@testable import ChatGPTModelSelector

struct SliderGeometryTests {
  private let geometry = SliderGeometry(width: 218, knobDiameter: 34, stopCount: 5)

  @Test("Knob and progress share the same bounded endpoint")
  func boundedEndpoints() {
    #expect(geometry.knobX(for: -1) == 17)
    #expect(geometry.knobX(for: 0.5) == 109)
    #expect(geometry.knobX(for: 2) == 201)
  }

  @Test("Pointer locations normalize inside the draggable span")
  func normalizedPointerLocations() {
    #expect(geometry.normalizedPosition(for: -100, fallback: 0.5) == 0)
    #expect(geometry.normalizedPosition(for: 109, fallback: 0.5) == 0.5)
    #expect(geometry.normalizedPosition(for: 500, fallback: 0.5) == 1)
  }

  @Test("Magnetism preserves interval midpoints and attracts nearby values")
  func magneticStops() {
    let midpoint = geometry.magnetizedPosition(0.375, strength: 0.9, exponent: 1.45)
    let nearHigh = geometry.magnetizedPosition(0.48, strength: 0.9, exponent: 1.45)

    #expect(midpoint == 0.375)
    #expect(nearHigh > 0.48)
    #expect(nearHigh <= 0.5)
  }

  @Test("Degenerate tracks return their fallback without division by zero")
  func degenerateTrack() {
    let collapsed = SliderGeometry(width: 20, knobDiameter: 34, stopCount: 5)
    #expect(collapsed.normalizedPosition(for: 10, fallback: 0.75) == 0.75)
  }
}
