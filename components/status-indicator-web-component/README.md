# status-indicator

https://github.com/user-attachments/assets/916a91b4-478e-41cc-9446-59286ca17986

**[Live demo](https://zanwei.github.io/status-indicator-web-component/)**

A status indicator implemented as a dependency-free Web Component. Five statuses render as a row of dots; the selected dot expands into a labeled pill through a spring-driven morph that is interruptible and retargets mid-flight.

## Features

- Spring-driven dot ↔ pill morph (response 0.42 s, ζ 0.86), interruptible mid-flight.
- Click, drag to scrub across statuses, and full keyboard support (`radiogroup` semantics, arrow keys, Home/End).
- Hover background on dots, phase-continuous loader spin, stroke-drawn check on Done.
- `prefers-reduced-motion` support: state changes snap, color feedback stays.
- No runtime dependencies and no build step.
- Themable via CSS custom properties, applied live.

## Usage

```html
<script type="module" src="./status-indicator.js"></script>

<status-indicator value="in-progress"></status-indicator>
```

```js
const el = document.querySelector('status-indicator');

el.value = 'done';
el.addEventListener('change', (e) => {
  console.log(e.detail); // { value: 'done', index: 3, label: 'Done' }
});
```

The component sizes itself in `rem` (16 px base) and inherits `font-family`; load [Inter](https://fonts.google.com/specimen/Inter) on the host page for the exact design look.

## API

### Attributes

| Attribute | Description |
| --- | --- |
| `value` | Selected status id (`backlog` \| `in-progress` \| `needs-review` \| `done` \| `cancel` by default). Reflected on selection change. |
| `aria-label` | Accessible name of the inner radiogroup (defaults to "Status"). |

### Properties

| Property | Description |
| --- | --- |
| `value` | Get/set the selected status id. |
| `index` | Get/set the selected index. |
| `statuses` | Replace the status list: `[{ id, label, color, icon, spin? }]`. `icon` is a built-in name (`circle-dashed`, `loader`, `info`, `circle-check`, `circle-x`), raw SVG inner markup for a 24 × 24 viewBox, or a complete `<svg>` string. |
| `spring` | Get/set `{ response, zeta }` of the morph spring. |

### Events

| Event | Description |
| --- | --- |
| `change` | Bubbling, composed. `detail: { value, index, label }`. |

### Theming

| Token | Default | Role |
| --- | --- | --- |
| `--si-pill-bg` | `#efeff1` | Pill surface |
| `--si-label` | `#1a1b1e` | Label text |
| `--si-dot` | `#d5d7da` | Unselected dot |
| `--si-dot-hover` | `#c9ccd1` | Dot on hover |
| `--si-dot-hover-bg` | `rgba(26,27,30,.06)` | Hover background |
| `--si-focus-ring` | `#1a1b1e` | Keyboard focus outline |

## Local development

No dependencies or build step. Start any static file server from the repository root:

```bash
python3 -m http.server 5183
```

## License

[MIT](LICENSE). Icons are [Lucide](https://lucide.dev) glyphs (ISC license).
