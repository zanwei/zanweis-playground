# Ball Model Picker

https://github.com/user-attachments/assets/25e9015e-2113-40e2-92d3-c5badb78ac43

A pinball-style reasoning effort picker implemented as a zero-dependency Web Component. A glowing ball moves through an elastic peg field, settles into one of six effort levels, and updates the read-only result meter only after landing.

## Origin and attribution

This project recreates the interface shown in [this original X post](https://x.com/filicroval/status/2076405207710232610?s=20) as an independently implemented Web Component.

The original concept and visual design belong to their respective creator(s). This repository contains only the independent implementation.

## Features

- Fixed-step gravity simulation at 240 Hz.
- Elastic circle collisions across 27 pegs.
- Contact-synchronous lavender peg halos and an SVG trail of the real ball trajectory.
- Preserved tangential momentum, repeat contacts, and side-wall rebounds.
- Six read-only result levels: Auto, Light, Medium, High, Extra High, and Ultra.
- Responsive layout with a `prefers-reduced-motion` fallback.
- No runtime dependencies and no build step.

## Usage

Import the component module and add `<ball-model-picker>` to the page:

```html
<script type="module" src="./src/ball-model-picker.js"></script>

<ball-model-picker open></ball-model-picker>
```

The `open` boolean attribute controls whether the panel is expanded:

```js
const picker = document.querySelector('ball-model-picker');

picker.toggleAttribute('open', true);
console.log(picker.value);
// { index: 2, id: 'medium', label: 'Medium' }
```

## API

### Attributes

| Attribute | Description |
| --- | --- |
| `open` | Boolean attribute that expands or collapses the picker panel. |

### Properties

| Property | Description |
| --- | --- |
| `value` | Returns `{ index, id, label }` for the committed result. |

### Events

The component dispatches a bubbling, composed `change` event after the ball settles:

```js
picker.addEventListener('change', (event) => {
  console.log(event.detail);
  // { index, id, label, phase: 'landed' }
});
```

## Interaction

- Press **Again** to release a new ball.
- The existing result remains committed while the ball is in play.
- Real peg contacts drive the ball path; the destination is not selected in advance.
- The close button collapses the panel, and the compact trigger reopens it.
- Native button semantics provide keyboard activation and focus treatment.
- Reduced-motion users receive an immediate weighted result without the traversal effects.

## Local development

No dependencies or build step are required. Start any static file server from the repository root:

```sh
python3 -m http.server 4173
```

Then open `http://127.0.0.1:4173`.

Run the automated physics and route checks before submitting changes:

```sh
npm test
```

## Repository structure

| Path | Purpose |
| --- | --- |
| `src/ball-model-picker.js` | Custom Element behavior and encapsulated Shadow DOM styles. |
| `src/pinball-physics.js` | Fixed-step gravity, circle collisions, and pocket settling. |
| `src/plinko-route.js` | Weighted result fallback used by reduced-motion mode. |
| `tests/` | Deterministic physics and route tests. |
| `index.html` | Minimal local demo page. |

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) before contributing.

## Disclaimer

This is an unofficial, independent interface recreation. It is not affiliated with or endorsed by the original creator(s), X, or OpenAI. Names and labels in the component are used only to demonstrate the interaction.

## License

[MIT](./LICENSE) © 2026 zanwei
