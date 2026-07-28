# Liquid Connector

https://github.com/user-attachments/assets/134772a6-6ff0-439d-9449-e6601739d0d7

Liquid Connector is a dependency-free Web Component that recreates a liquid
card-to-prompt interaction with SVG path math. The white surface is generated
as a real path: the coupled seam, corner tangencies, waist, peel, and topology
change do not use an SVG filter, mask, canvas, bitmap metaball, or shader.

The component is intentionally small and browser-only. It includes the custom
element, its path solver, a deterministic animation step API, reduced-motion
behavior, and an optional geometry overlay.

## Features

- Continuous SVG path geometry for overlap, coupling, peel, and separation
- Fixed output-card dimensions during the peel
- Independent input-content and send-button strain during collapse
- Direction-aware merge and detach behavior
- Shadow DOM encapsulation with four color custom properties
- Keyboard input, focus handling, and `prefers-reduced-motion` support
- Runtime peel parameters for inspecting and tuning the coupling model
- No runtime dependencies

## Inspiration and attribution

This is an independent implementation inspired by the visual interaction in
[Mikk Martin's motion reference](https://x.com/mikkmartin/status/2077706511405453754).

No source code, downloadable media, or other assets from the reference are
included or redistributed. This project is not affiliated with or endorsed by
Mikk Martin, X, or Notion. The Notion name and mark shown in the demo remain
the property of their respective owner and are not licensed under the MIT
License. See [NOTICE](./NOTICE) for the full attribution and trademark notice.

## Installation

Install the package after it has been published:

```sh
npm install liquid-connector-web-component
```

For a local package archive:

```sh
npm install ./liquid-connector-web-component-0.1.0.tgz
```

## Usage

Importing the package registers `<liquid-connector>` and also exposes the
component class and path engine as ES module exports:

```js
import LiquidConnector, {
  LiquidPath,
} from "liquid-connector-web-component";

console.log(LiquidConnector, LiquidPath.DEFAULT_PEEL_PARAMETERS);
```

Add the element to the page:

```html
<liquid-connector
  open
  gap="10"
  provider="Notion"
  eyebrow="MCP Connector"
  placeholder="Ask anything..."
  connect-label="Connect"
  skip-label="Skip"
  prompt-label="Prompt"
  send-label="Send prompt"
  stage-label="Liquid connector prompt"
></liquid-connector>
```

The package is browser-only and requires Custom Elements, Shadow DOM, SVG
`foreignObject`, and `globalThis`. Import it from client-side code rather than
from a server-rendering process.

### Classic scripts

When a build tool is not available, load the path engine before the component:

```html
<script src="./liquid-path.js"></script>
<script src="./liquid-connector.js"></script>
```

The scripts expose `globalThis.LiquidPath` and
`globalThis.LiquidConnector`.

## Attributes

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `open` | Boolean | absent | Shows the connector card when present. |
| `gap` | Number | `10` | Resting separation in pixels, clamped from `-60` to `10`. |
| `debug` | Boolean | absent | Shows the path, corner circles, coupling circles, and waist overlay. |
| `provider` | String | `Notion` | Provider label displayed in the output card. |
| `eyebrow` | String | `MCP Connector` | Secondary label displayed above the provider. |
| `placeholder` | String | `Ask anything...` | Prompt placeholder. |
| `connect-label` | String | `Connect` | Visible Connect button label. |
| `skip-label` | String | `Skip` | Visible Skip button label. |
| `prompt-label` | String | `Prompt` | Accessible prompt label. |
| `send-label` | String | `Send prompt` | Accessible send-button label. |
| `stage-label` | String | `Liquid connector prompt` | Accessible SVG stage label. |
| `emit-frames` | Boolean | absent | Enables the diagnostic `liquid-frame` event stream. |

## JavaScript API

```js
const connector = document.querySelector("liquid-connector");

connector.toggle();
connector.setGap(6, { immediate: true });
connector.value = "Summarize this page";

connector.setPeelParameters({
  detachGap: 6,
  transition: 6.5,
  couplingRadius: 5,
  pull: 2.5,
});

connector.step(1000 / 60);
```

### Properties

| Property | Type | Description |
| --- | --- | --- |
| `open` | Boolean | Reflects the `open` attribute and starts the corresponding transition when changed. |
| `gap` | Number | Gets or changes the resting gap. |
| `value` | String | Gets or changes the prompt value. |
| `peelParameters` | Object | Gets a copy of the normalized peel parameters or applies a partial update. |

### Methods

| Method | Description |
| --- | --- |
| `toggle(force?)` | Opens, closes, or toggles the component. |
| `setGap(value, options?)` | Changes the resting gap. Pass `{ immediate: true }` to render without animation. |
| `setPeelParameters(partial)` | Applies and returns normalized peel parameters. |
| `resetPeelParameters()` | Restores the default peel parameters. |
| `step(milliseconds?)` | Pauses scheduled playback, advances deterministically, and returns the current frame. A later `toggle()` or `setGap()` resumes normal playback. |

The default peel parameters are:

```js
{
  detachGap: 6,
  transition: 6.5,
  couplingRadius: 5,
  pull: 2.5,
}
```

Invalid and out-of-range values are normalized by the path engine.

## Events

All component events bubble and cross the shadow boundary.

| Event | Detail | When it fires |
| --- | --- | --- |
| `connect` | none | The Connect button is activated. |
| `skip` | none | The Skip button is activated and the component starts closing. |
| `submit` | `{ value }` | The enabled send button is activated, or Enter is pressed without Shift. This event is cancelable. |
| `liquid-toggle` | `{ open }` | The `open` state changes through the API or attribute. |
| `liquid-frame` | Frame summary | Each rendered animation frame or deterministic step, while `emit-frames` or `debug` is present. |

`liquid-frame` is opt-in because it is a high-frequency diagnostic event. Its detail includes
`gap`, `mode`, `phase`, `faceGap`, `strain`, `stretch`, `waistWidth`,
`velocity`, `open`, and the active `peelParameters`.

```js
connector.addEventListener("submit", (event) => {
  console.log(event.detail.value);
});
```

## Styling

The component exposes these inherited CSS custom properties on its host:

```css
liquid-connector {
  --liquid-surface: #fdfdfd;
  --liquid-ink: #191919;
  --liquid-muted: #686868;
  --liquid-blue: #1e55c7;
  width: min(520px, 100%);
}
```

For targeted styling, the shadow tree exposes:

```text
surface, outline, focus-outline, connector-card, identity, icon,
provider-copy, eyebrow, provider, skip-button, connect-button,
prompt-card, prompt, send-button
```

For example:

```css
liquid-connector::part(connect-button) {
  border-color: color-mix(in srgb, currentColor 25%, transparent);
}
```

The closing card content uses a short CSS blur to match the motion reference.
That blur is limited to the HTML content layer; it is not used to construct
the SVG surface or its liquid topology.

## Path engine

`LiquidPath.createLiquidFrame(gap, velocity, options)` returns the current SVG
path and its render measurements. The exported `LiquidPath` object also
contains the immutable geometry, motion, transition, parameter defaults, and
normalization helpers used by the component.

The stable integration point is the Web Component API. Treat frame fields and
low-level solver helpers as advanced APIs that may evolve during the `0.x`
release series.

## Accessibility

- Controls use native buttons and a native textarea.
- Enter submits; Shift+Enter inserts a line break.
- Focus is moved back to the prompt before the output card becomes inert.
- Visible focus styles are preserved inside the shadow root.
- Reduced-motion users are taken directly to each static state.

Product teams should provide surrounding instructions and labels appropriate
to their own workflow and should test the component with their supported
assistive technologies.

## Development

The project has no install-time dependencies.

```sh
npm run dev
```

Open `http://localhost:4173` to use the demo and parameter inspector.

Run the tests and verify the package contents:

```sh
npm run check
```

Build the npm archive:

```sh
npm run pack:release
```

## Browser support

The component targets current browsers with Custom Elements, Shadow DOM, SVG
`foreignObject`, and the `inert` property. Test against the browser matrix of
the product that embeds it; no legacy-browser compatibility layer is bundled.

## License

The original source code in this repository is released under the
[MIT License](./LICENSE). Third-party names and marks are excluded from that
license grant as described in [NOTICE](./NOTICE).
