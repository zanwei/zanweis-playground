# Model Picker

https://github.com/user-attachments/assets/42718194-2f05-42fb-8e1a-b5ef4acbc412

The component combines a three-model matrix (Sol / Terra / Luna), five reasoning-effort levels (Low → Pro), an ULTRA lever, and a compact trigger that reflects the current selection.

## Origin and attribution

This project recreates [**maria's demo**](https://x.com/maria_rcks/status/2076176709221552447?s=20) as an independently implemented, zero-dependency Web Component.

The original concept and visual design belong to maria. This repository contains only the independent implementation.

## Usage

Import the component module and add `<model-picker>` to your page:

```html
<script type="module" src="./model-picker.js"></script>

<model-picker></model-picker>
```

You can provide an initial state with HTML attributes:

```html
<model-picker model="terra" tier="4" ultra></model-picker>
```

## API

### Attributes

| Attribute | Description |
| --- | --- |
| `model` | `sol` \| `terra` \| `luna`; defaults to `sol` |
| `tier` | `0`–`4`, mapping from Low to Pro; defaults to `2` (High) |
| `ultra` | Boolean attribute that enables ULTRA mode |
| `open` | Boolean attribute that controls whether the picker panel is open |

State changes are reflected to the corresponding attributes. Read `element.value` to get the current value:

```js
{
  model: 'sol',
  tierIndex: 2,
  tier: 'High',
  ultra: false
}
```

Use the `open()` and `close()` methods to control the panel programmatically.

### Events

The component dispatches a bubbling, composed `change` event when the user commits a selection or toggles ULTRA:

```js
const picker = document.querySelector('model-picker');

picker.addEventListener('change', (event) => {
  console.log(event.detail);
  // { model, tierIndex, tier, ultra, label }
});
```

## Interaction

- Click an effort-level dot or scrub horizontally across a model row.
- Continue dragging vertically to hand the active progress bar to another model row.
- Click or drag the lever to toggle ULTRA mode.
- Use the arrow keys to navigate the matrix, Space or Enter to toggle ULTRA, and Escape to close the panel.
- Motion automatically respects `prefers-reduced-motion`.

## Local development

No dependencies or build step are required. Start any static file server from the repository root:

```sh
python3 -m http.server 4173
```

Then open `http://127.0.0.1:4173`.

Run the syntax check before submitting changes:

```sh
node --check model-picker.js
```

## Repository structure

| File | Purpose |
| --- | --- |
| `model-picker.js` | Component behavior and encapsulated Shadow DOM styles |
| `index.html` | Minimal demo page |
| `reasoning-mixer-design-dna.json` | Design palette, motion, and particle specifications |

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) before contributing.

## Disclaimer

This is an unofficial, independent interface recreation. It is not affiliated with or endorsed by maria, X, or OpenAI. Model names in the component are used only to demonstrate the interaction.

## License

[MIT](./LICENSE) © 2026 zanwei
