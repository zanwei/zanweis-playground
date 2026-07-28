# Table of Content

https://github.com/user-attachments/assets/840db62b-a734-404c-b186-c5661456525e

`<table-of-content>` is a dependency-free Web Component for navigating a
vertical content rail and previewing the selected section in a floating card.

The component is browser-only, framework-agnostic, and built with Custom
Elements, Shadow DOM, Pointer Events, and `requestAnimationFrame`. It does not
load images, fonts, frameworks, or CDN resources at runtime.

## Features

- Continuous pointer and touch scrubbing across a compact vertical rail
- Interruptible, near-critically-damped tick magnification
- Preview cards measured from their title and description typography
- Pointer, touch, and keyboard input with a vertical-slider accessibility model
- Container-responsive card width and configurable CSS custom properties
- `prefers-reduced-motion` and forced-colors support
- Shadow Parts for targeted styling
- Zero runtime dependencies

## Installation

Install the package after it has been published:

```sh
npm install table-of-content-component
```

Importing the package registers `<table-of-content>` and exports the component
class and deterministic geometry model:

```js
import TableOfContent, {
  TableOfContentModel,
} from "table-of-content-component";

console.log(TableOfContent, TableOfContentModel.GEOMETRY);
```

The package is browser-only. Import it from client-side code rather than from a
server-rendering process.

## Usage

Add the element to the page:

```html
<table-of-content
  label="Document contents"
  value="0"
></table-of-content>
```

Provide a non-empty array of up to 200 records through the `items` property:

```js
const toc = document.querySelector("table-of-content");

toc.items = [
  {
    id: "research",
    title: "Review the interaction",
    description: "Map pointer position, active ticks, and card alignment.",
  },
  {
    id: "release",
    title: "Ship the component",
    description: "Verify the package, documentation, and browser behavior.",
  },
];
```

Each item is normalized to `id`, `title`, and `description`. Copy is assigned
through `textContent`, and getters and event details return defensive copies.
For larger histories, group or downsample records before assigning them so the
rail remains legible and inexpensive to animate.

### Classic scripts

When a build tool is not available, load the deterministic model before the
component:

```html
<script src="./table-of-content-model.js"></script>
<script src="./table-of-content.js"></script>
```

These scripts expose `globalThis.TableOfContentModel` and
`globalThis.TableOfContent`.

## Interaction

- Pointer Y selects the nearest content tick.
- Neighboring ticks follow pointer-distance magnification with an interruptible
  spring.
- When closed, the preview appears directly beside the current selection.
  While already visible, it follows selection changes with damped motion.
- Card height follows the current title, description, wrapping, and font tokens.
- Leaving the rail closes the preview after a short grace period.
- Touch uses Pointer Capture and keeps the final preview visible briefly.
- Arrow keys select adjacent items.
- Home and End jump to the first and last items.
- Escape closes the preview and clears a pinned `open` state.
- Reduced motion keeps selection functional and removes interpolation.

## Attributes and properties

| API | Type | Default | Description |
| --- | --- | --- | --- |
| `label` / `.label` | String | `"Table of content"` | Accessible slider name. |
| `value` / `.value` | Number | `0` | Zero-based selected item index. Values are rounded and clamped. |
| `open` / `.open` | Boolean | `false` | Pins the preview open while present or true. |
| `.items` | Array | 38 placeholder items | Gets or replaces content sections. |

Properties assigned before the custom element is defined are upgraded when the
component constructor runs.

## Methods

| Method | Description |
| --- | --- |
| `.select(index, options?)` | Selects an item. `options.open` defaults to `true`; `options.emit` defaults to `true`. A pinned `open` state takes precedence. |
| `.close()` | Clears the pinned state and closes the preview. |

## Events

All events bubble and cross the Shadow DOM boundary.

| Event | Detail | When it fires |
| --- | --- | --- |
| `toc-change` | `{ index, item }` | The selected index changes. |
| `toc-open` | `{ index }` | The preview opens. |
| `toc-close` | `{ index }` | The preview closes. |

```js
toc.addEventListener("toc-change", (event) => {
  console.log(event.detail.index, event.detail.item);
});
```

## Styling

The host exposes these inherited CSS custom properties:

```css
table-of-content {
  --toc-background: #fff;
  --toc-surface: #fff;
  --toc-ink: oklch(22% 0.008 250);
  --toc-copy: oklch(56% 0.008 250);
  --toc-line: oklch(88% 0.006 250);
  --toc-accent: oklch(51% 0.09 251);
  --toc-title-size: 1rem;
  --toc-description-size: 1rem;
  --toc-title-lines: 2;
  --toc-description-lines: 4;
}
```

The title and description both resolve to 16px with the standard root size.
The card has no fixed content height: it remeasures when copy, wrapping, host
width, or text metrics change. Set either line-count token to `unset` to show
that field without a visual line clamp; the complete copy is always included
in the slider's accessible value text.

The shadow tree exposes these parts:

`viewport`, `stage`, `rail`, `ticks`, `tick`, `card`, `card-content`, `title`,
`description`.

```css
table-of-content::part(card) {
  border-radius: 1rem;
}
```

## Accessibility

- The rail uses the vertical `slider` pattern with an accessible name, range,
  current value, and descriptive value text.
- Arrow, Home, End, and Escape keys are supported.
- Keyboard focus has a visible high-contrast ring; pointer and touch focus do
  not add a persistent ring.
- The preview is represented in the slider value text, avoiding duplicate live
  announcements from rapidly changing visual content.
- Reduced-motion users receive immediate static states.
- Forced-colors users retain the keyboard focus indicator.

Embedding products should still test the component with their supported screen
readers, zoom levels, input devices, and color themes.

## Performance

The runtime contains no network requests or third-party code. Pointer movement
updates continuous geometry using a rail rectangle cached until resize or
scroll, while title replacement and card measurement occur only when the
discrete selected item changes. Tick transforms and opacity are
compositor-friendly; the single card height animation is the intentional
layout-bound part of the interaction.

## Browser support

The component targets current browsers with:

- Custom Elements and open Shadow DOM
- Pointer Events and Pointer Capture
- `ResizeObserver`
- CSS container queries
- OKLCH colors
- Individual transform properties

No legacy-browser compatibility layer is bundled.

## Development

The project has no install-time dependencies.

```sh
npm run dev
```

Open [http://localhost:4173](http://localhost:4173) to view the demo.
For the repository-only browser regression fixture, open
[http://localhost:4173/tests/browser-smoke.html](http://localhost:4173/tests/browser-smoke.html).

Run the deterministic tests, syntax checks, and package-content verification:

```sh
npm run check
```

Build the npm archive:

```sh
npm run pack:release
```

## License

Original source code in this repository is released under the
[MIT License](LICENSE). Reference media is not part of the license grant; see
[NOTICE](NOTICE).
