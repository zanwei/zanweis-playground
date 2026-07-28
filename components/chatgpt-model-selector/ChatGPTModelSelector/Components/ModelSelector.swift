import SwiftUI

/// Controls how ``ModelSelector`` presents its settings panel.
public enum ModelSelectorPresentation: Sendable {
  /// Preserves the compact custom design and opens above the trigger.
  case overlayAbove
  /// Preserves the compact custom design and opens below the trigger.
  case overlayBelow
  /// Uses a system popover when the selector is hosted inside a clipped container.
  case systemPopover
}

/// A compact model-intelligence picker with five discrete levels.
public struct ModelSelector: View {
  private let modelName: String
  private let presentation: ModelSelectorPresentation
  @Binding private var selection: ModelTier

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var isExpanded = false
  @State private var panel: Panel = .menu
  @State private var isDraggingSlider = false
  @ScaledMetric(relativeTo: .body) private var preferredWidth = 250.0
  @ScaledMetric(relativeTo: .body) private var triggerHeight = 36.0
  @ScaledMetric(relativeTo: .body) private var menuHeight = 166.0
  @ScaledMetric(relativeTo: .body) private var advancedHeight = 101.0

  private enum Panel {
    case menu
    case advanced
  }

  /// Creates a model selector bound to the caller's selected tier.
  public init(
    modelName: String,
    selection: Binding<ModelTier>,
    presentation: ModelSelectorPresentation = .overlayAbove
  ) {
    self.modelName = modelName
    self.presentation = presentation
    _selection = selection
  }

  public var body: some View {
    presentationContent
      .sensoryFeedback(.selection, trigger: selection)
  }

  private var controlWidth: Double {
    min(max(preferredWidth, 250), 340)
  }

  @ViewBuilder
  private var presentationContent: some View {
    switch presentation {
    case .overlayAbove:
      overlaySelector(opensAbove: true)
    case .overlayBelow:
      overlaySelector(opensAbove: false)
    case .systemPopover:
      triggerButton
        .popover(
          isPresented: $isExpanded,
          attachmentAnchor: .rect(.bounds),
          arrowEdge: .bottom
        ) {
          popoverContent
        }
    }
  }

  private func overlaySelector(opensAbove: Bool) -> some View {
    ZStack(alignment: opensAbove ? .bottom : .top) {
      if isExpanded {
        selectorCard
          .offset(y: opensAbove ? -(triggerHeight + 8) : triggerHeight + 8)
          .transition(
            .scale(scale: 0.96, anchor: opensAbove ? .bottom : .top)
              .combined(with: .opacity)
              .combined(with: .offset(y: opensAbove ? 4 : -4))
          )
          .zIndex(1)
      }

      triggerButton
    }
    .frame(width: controlWidth, height: triggerHeight)
    .zIndex(isExpanded ? 10 : 0)
  }

  @ViewBuilder
  private var popoverContent: some View {
    #if os(iOS)
      selectorCard
        .presentationCompactAdaptation(.popover)
    #else
      selectorCard
    #endif
  }

  private var triggerButton: some View {
    Button(action: toggleExpanded) {
      ZStack {
        HStack(spacing: 6) {
          Image(systemName: "bolt.fill")
            .font(.system(size: 12, weight: .semibold))
            .accessibilityHidden(true)

          HStack(spacing: 5) {
            Text(modelName)
              .fontWeight(.semibold)

            Text(selection.title)
              .foregroundStyle(SelectorTheme.levelLabelColor(for: selection))
              .contentTransition(.numericText())
              .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: selection)
          }
          .font(.subheadline)
          .lineLimit(1)
          .minimumScaleFactor(0.8)
        }
        .foregroundStyle(SelectorTheme.ink)

        Image(systemName: "chevron.up")
          .font(.system(size: 10, weight: .semibold))
          .foregroundStyle(SelectorTheme.secondaryInk)
          .rotationEffect(.degrees(isExpanded ? 0 : 180))
          .frame(maxWidth: .infinity, alignment: .trailing)
          .padding(.trailing, 13)
          .accessibilityHidden(true)
      }
      .frame(width: controlWidth, height: triggerHeight)
      .background(SelectorTheme.pillBackground, in: Capsule())
      .contentShape(Capsule())
    }
    .buttonStyle(PressScaleButtonStyle())
    .accessibilityLabel("\(modelName), \(selection.title)")
    .accessibilityHint(isExpanded ? "Closes model settings" : "Opens model settings")
    .accessibilityValue(selection.accessibilityValue)
    .animation(reduceMotion ? nil : .smooth(duration: 0.2), value: isExpanded)
  }

  private var selectorCard: some View {
    ZStack {
      MenuPanel(
        modelName: modelName,
        selection: selection,
        showAdvanced: showAdvanced
      )
      .opacity(panel == .menu ? 1 : 0)
      .offset(x: panel == .menu ? 0 : -10)
      .allowsHitTesting(panel == .menu)
      .accessibilityHidden(panel != .menu)

      AdvancedPanel(
        selection: $selection,
        isDraggingSlider: $isDraggingSlider,
        isActive: panel == .advanced,
        showMenu: showMenu
      )
      .compositingGroup()
      .opacity(panel == .advanced ? 1 : 0)
      .offset(x: panel == .advanced ? 0 : 10)
      .allowsHitTesting(panel == .advanced)
      .accessibilityHidden(panel != .advanced)
    }
    .frame(
      width: controlWidth,
      height: panel == .menu ? menuHeight : advancedHeight
    )
    .background(SelectorTheme.systemBackground)
    .clipShape(.rect(cornerRadius: 16, style: .continuous))
    .shadow(color: SelectorTheme.shadow.opacity(0.05), radius: 0.5)
    .shadow(color: SelectorTheme.shadow.opacity(0.06), radius: 3, y: 2)
    .shadow(color: SelectorTheme.shadow.opacity(0.13), radius: 16, y: 12)
    .animation(reduceMotion ? nil : .smooth(duration: 0.22), value: panel)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Model settings")
  }

  private func toggleExpanded() {
    withAnimation(reduceMotion ? nil : .smooth(duration: 0.22)) {
      isExpanded.toggle()
      if isExpanded {
        panel = .menu
      }
    }
  }

  private func showAdvanced() {
    withAnimation(reduceMotion ? nil : .smooth(duration: 0.2)) {
      panel = .advanced
    }
  }

  private func showMenu() {
    withAnimation(reduceMotion ? nil : .smooth(duration: 0.2)) {
      panel = .menu
    }
  }
}

private struct MenuPanel: View {
  let modelName: String
  let selection: ModelTier
  let showAdvanced: () -> Void

  var body: some View {
    VStack(spacing: 0) {
      SelectorInfoRow(title: "Model", value: modelName)
      SelectorInfoRow(title: "Effort", value: selection.title)
      SelectorInfoRow(title: "Speed", value: "Fast")

      Divider()
        .overlay(SelectorTheme.hairline)
        .padding(.horizontal, 3)
        .padding(.vertical, 5)

      Button(action: showAdvanced) {
        HStack(spacing: 5) {
          Text("Advanced")
          Image(systemName: "chevron.up")
            .font(.system(size: 10, weight: .semibold))
        }
        .font(.subheadline)
        .foregroundStyle(SelectorTheme.secondaryInk)
        .frame(height: 32)
        .padding(.horizontal, 12)
        .contentShape(.rect(cornerRadius: 10))
      }
      .buttonStyle(RowButtonStyle())
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.horizontal, 8)
    .padding(.top, 8)
    .padding(.bottom, 6)
  }
}

private struct SelectorInfoRow: View {
  let title: String
  let value: String
  @ScaledMetric(relativeTo: .body) private var rowHeight = 36.0

  var body: some View {
    HStack(spacing: 8) {
      Text(title)
        .fontWeight(.semibold)
        .foregroundStyle(SelectorTheme.ink)

      Spacer(minLength: 8)

      Text(value)
        .foregroundStyle(SelectorTheme.secondaryInk)
        .lineLimit(1)
        .minimumScaleFactor(0.8)

      Image(systemName: "chevron.right")
        .font(.system(size: 10, weight: .semibold))
        .foregroundStyle(SelectorTheme.tertiaryInk)
        .accessibilityHidden(true)
    }
    .font(.subheadline)
    .padding(.horizontal, 10)
    .frame(height: rowHeight)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(title), \(value)")
  }
}

private struct AdvancedPanel: View {
  @Binding var selection: ModelTier
  @Binding var isDraggingSlider: Bool
  let isActive: Bool
  let showMenu: () -> Void

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    VStack(spacing: 13) {
      header

      IntelligenceSlider(
        selection: $selection,
        isDragging: $isDraggingSlider,
        isActive: isActive
      )
    }
    .padding(.horizontal, 16)
    .padding(.top, 13)
    .padding(.bottom, 15)
  }

  @ViewBuilder
  private var header: some View {
    ZStack {
      if selection == .ultra {
        Text("Consumes usage limits faster")
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(
            LinearGradient(
              colors: [SelectorTheme.ultraText, Color.purple],
              startPoint: .leading,
              endPoint: .trailing
            )
          )
          .transition(.opacity.combined(with: .offset(y: 3)))
      } else if isDraggingSlider {
        HStack {
          Text("Faster")
          Spacer()
          Text("Smarter")
        }
        .font(.subheadline)
        .foregroundStyle(SelectorTheme.secondaryInk)
        .transition(.opacity.combined(with: .offset(y: 3)))
      } else {
        HStack {
          Button(action: showMenu) {
            HStack(spacing: 5) {
              Text("Advanced")
              Image(systemName: "chevron.right")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(SelectorTheme.tertiaryInk)
            }
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)

          Spacer()

          Image(systemName: "bolt.fill")
            .foregroundStyle(SelectorTheme.blue)
            .accessibilityHidden(true)
        }
        .font(.subheadline)
        .foregroundStyle(SelectorTheme.secondaryInk)
        .transition(.opacity.combined(with: .offset(y: 3)))
      }
    }
    .frame(height: 22)
    .animation(reduceMotion ? nil : .smooth(duration: 0.2), value: selection)
    .animation(reduceMotion ? nil : .smooth(duration: 0.2), value: isDraggingSlider)
  }
}

private struct PressScaleButtonStyle: ButtonStyle {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
      .animation(reduceMotion ? nil : .easeOut(duration: 0.14), value: configuration.isPressed)
  }
}

private struct RowButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .background(
        configuration.isPressed ? SelectorTheme.rowPressed : .clear,
        in: .rect(cornerRadius: 10)
      )
  }
}

#Preview("Expanded selector") {
  ModelSelectorPreview()
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(SelectorTheme.systemBackground)
}

private struct ModelSelectorPreview: View {
  @State private var selection = ModelTier.medium

  var body: some View {
    ModelSelector(modelName: "GPT-5.4", selection: $selection)
  }
}
