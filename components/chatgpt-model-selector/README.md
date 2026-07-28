# ChatGPT Model Selector

A ChatGPT-inspired model intelligence picker in two zero-dependency implementations:

- **JavaScript:** a standards-based Web Component that runs directly in the browser.
- **SwiftUI:** a reusable Swift Package for iOS 17+ and macOS 14+, plus a native demo app.

The two versions share the same five intelligence levels, magnetic snapping, animated color progression, reduced-motion behavior, and Ultra celebration.

## Demo

https://github.com/user-attachments/assets/1025109b-c19d-42a1-8fb4-a035cc104bbf

## JavaScript version

Open [`index.html`](./index.html) in a browser, or include the component in your own page:

```html
<script src="JavaScript/chatgpt-model-selector.js"></script>

<chatgpt-model-selector
  model-name="GPT-5.4"
  value="1"
></chatgpt-model-selector>
```

Listen for selection changes through the standard `change` event:

```js
const selector = document.querySelector('chatgpt-model-selector');

selector.addEventListener('change', (event) => {
  console.log(event.detail.index, event.detail.tier, event.detail.model);
});
```

### Web Component API

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `model-name` | string | `GPT-5.4` | Model label shown in the trigger and menu |
| `value` | integer 0–4 | `1` | Light, Medium, High, Extra High, or Ultra |

- `value` gets or sets the tier index.
- `tier` returns the current tier name.
- `change` emits `{ index, tier, model }` in `event.detail`.

The component supports modern browsers with Web Components, Shadow DOM, Canvas 2D, and `ResizeObserver`.

## SwiftUI version

### Requirements

- Xcode 16 or newer
- Swift 6.0 or newer
- iOS 17 or newer
- macOS 14 or newer
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) only when regenerating the iOS demo project

### Add the package

In Xcode, choose **File → Add Package Dependencies** and enter:

```text
https://github.com/zanwei/chatgpt-model-selector
```

Or add the package in `Package.swift`:

```swift
dependencies: [
  .package(
    url: "https://github.com/zanwei/chatgpt-model-selector.git",
    branch: "main"
  )
]
```

Then add the `ChatGPTModelSelector` library product to your target.

### Use the component

```swift
import ChatGPTModelSelector
import SwiftUI

struct ComposerView: View {
  @State private var tier: ModelTier = .medium

  var body: some View {
    ModelSelector(
      modelName: "GPT-5.4",
      selection: $tier
    )
  }
}
```

The binding is the source of truth: user interaction updates it, and external writes move the selector to the corresponding tier.

### Run the native demo without Xcode

```bash
swift run ChatGPTModelSelectorDemo
```

### Generate the iOS demo project

```bash
xcodegen generate
open ChatGPTModelSelector.xcodeproj
```

Run the `ChatGPTModelSelectorDemo` scheme on iPhone or iPad.

## Features

- Five discrete tiers: Light, Medium, High, Extra High, and Ultra
- Strong magnetic drag behavior with spring snapping
- Smooth cyan-to-violet color progression
- 60 fps Canvas particle rendering with work paused while hidden
- VoiceOver adjustable-control support
- Dynamic Type, a consistent light appearance, and Reduce Motion support
- Original overlay presentation by default, with optional below-trigger and system-popover modes
- Deterministic geometry and tier unit tests
- CI validation for Swift, iOS, and JavaScript

## Development

```bash
swift build -Xswiftc -warnings-as-errors
swift test
xcrun swift-format lint --recursive \
  ChatGPTModelSelector \
  ChatGPTModelSelectorDemo \
  ChatGPTModelSelectorTests
node --check JavaScript/chatgpt-model-selector.js
```

The checked-in app icon is reproducible:

```bash
swift scripts/generate_app_icon.swift \
  ChatGPTModelSelector/Assets.xcassets/AppIcon.appiconset/AppIcon.png
```

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) before opening a pull request.

## Repository layout

```text
ChatGPTModelSelector/       SwiftUI library sources
ChatGPTModelSelectorDemo/   Native demo executable
ChatGPTModelSelectorTests/  Swift package and Xcode tests
JavaScript/                 JavaScript Web Component
index.html                  Browser demo
```

## Disclaimer

This is an independent, ChatGPT-inspired interface experiment. It is not affiliated with or endorsed by OpenAI.

## License

[MIT](./LICENSE)
