# Contributing

Thanks for contributing to ChatGPT Model Selector.

## Before opening a pull request

1. Keep the JavaScript and SwiftUI behavior aligned when a change affects shared interaction semantics.
2. Preserve keyboard, VoiceOver, Reduce Motion, and the component's light appearance.
3. Avoid adding runtime dependencies unless the tradeoff is discussed first.
4. Add or update tests for selection math, magnetic snapping, and boundary behavior.

Run the local checks:

```bash
swift build -Xswiftc -warnings-as-errors
swift test
xcrun swift-format lint --recursive \
  ChatGPTModelSelector \
  ChatGPTModelSelectorDemo \
  ChatGPTModelSelectorTests
node --check JavaScript/chatgpt-model-selector.js
```

For changes to the iOS demo, regenerate the project with `xcodegen generate` and build the `ChatGPTModelSelectorDemo` scheme.

## Pull requests

- Keep each pull request focused on one coherent change.
- Explain the user-visible impact and include screenshots for visual changes.
- Call out platform-specific behavior or intentional differences between implementations.
- Do not include generated build products, DerivedData, or local IDE state.
