import Testing

@testable import ChatGPTModelSelector

struct ModelTierTests {
  @Test("Continuous positions map to the nearest stable tier")
  func closestTier() {
    #expect(ModelTier.closest(to: -1) == .light)
    #expect(ModelTier.closest(to: 0.24) == .medium)
    #expect(ModelTier.closest(to: 0.51) == .high)
    #expect(ModelTier.closest(to: 2) == .ultra)
  }

  @Test("Stepping stops at both ends")
  func boundedStepping() {
    #expect(ModelTier.light.stepped(by: -1) == .light)
    #expect(ModelTier.medium.stepped(by: 1) == .high)
    #expect(ModelTier.ultra.stepped(by: 1) == .ultra)
  }

  @Test("Every tier has a stable normalized stop")
  func normalizedStops() {
    #expect(ModelTier.light.normalizedPosition == 0)
    #expect(ModelTier.high.normalizedPosition == 0.5)
    #expect(ModelTier.ultra.normalizedPosition == 1)
  }
}
