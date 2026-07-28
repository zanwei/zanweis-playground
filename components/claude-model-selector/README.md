# Claude Model Selector

A Claude-inspired effort picker as a zero-dependency Web Component.

Inspired by Claude desktop.

## Demo

Open [`index.html`](./index.html) in a browser, or include the component in your own page:

```html
<script type="module" src="./JavaScript/claude-model-selector.js"></script>

<claude-model-selector value="0"></claude-model-selector>
```

Listen for selection changes through the standard `change` event:

```js
const selector = document.querySelector("claude-model-selector");

selector.addEventListener("change", (event) => {
  console.log(event.detail.index, event.detail.level);
});
```

### Web Component API

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | number 0–5 | `0` | Low, Medium, High, Extra, Max, or Ultracode |
| `open` | boolean | `false` | Whether the effort panel is open |
| `disabled` | boolean | `false` | Disables all interaction |

- `value` gets or sets the continuous slider position (snaps to an integer level on release).
- `level` returns the current level name.
- `open` / `disabled` mirror the attributes.
- `openPanel()`, `close()`, and `toggle()` control the panel.
- `input` emits while dragging or adjusting.
- `change` emits when the selection settles on a level.

Both events include `{ index, level, value }` in `event.detail`.

The component supports modern browsers with Web Components, Shadow DOM, Canvas 2D, and `ResizeObserver`.

## Features

- Six discrete effort levels: Low, Medium, High, Extra, Max, and Ultracode
- Magnetic drag behavior with spring snapping
- Animated Ultracode pixel field on the top tier
- Keyboard support, focus styles, Escape / outside-click to close
- `prefers-reduced-motion` support

### CSS variables

```css
claude-model-selector {
  --effort-accent: #8c73c9;
  --effort-track: #edeae8;
  --effort-surface: #ffffff;
  --effort-width: min(22.5rem, calc(100vw - 2rem));
}
```

## Development

```bash
python3 -m http.server 4173
node --check JavaScript/claude-model-selector.js
```

## Repository layout

```text
JavaScript/                 JavaScript Web Component
index.html                  Browser demo
```

## Disclaimer

This is an independent, Claude-inspired interface experiment. It is not affiliated with or endorsed by Anthropic.

## License

[MIT](./LICENSE)
