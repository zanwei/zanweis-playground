# Connected Filmstrip

https://github.com/user-attachments/assets/c195170c-3275-4673-8e75-bef6bff4ecb6

A connected-filmstrip image lightbox as a zero-dependency ES module.

Images are laid out edge to edge as one rigid strip. Navigating slides the strip while a clip window morphs between the fitted rects of the outgoing and incoming image — both layers driven by a single progress curve, so switching photos reads as one continuous surface gliding by, not two pictures swapping.

## Demo

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

The demo opens straight into the preview. Navigate with the on-screen arrows or <kbd>←</kbd> / <kbd>→</kbd>, close with <kbd>Esc</kbd>, the close button, or a click on the backdrop.

## Usage

```html
<link rel="stylesheet" href="lightbox.css" />
<script type="module">
  import { Lightbox } from './lightbox.js';

  const lb = new Lightbox([
    'photos/a.jpg',
    { src: 'photos/b.jpg', alt: 'Accessible description' },
  ]);

  lb.open(0);
</script>
```

## API

| Member | Description |
| --- | --- |
| `new Lightbox(sources)` | `sources` is an array of URL strings or `{ src, alt }` objects. DOM is created once and appended to `<body>`. |
| `open(index)` | Loads and decodes all images on first call, then shows the stage at `index`. |
| `goTo(index)` | Animates to another image. Interruptible at any time. |
| `close()` | Fades the stage out and restores focus to the opener. |

## Motion design

| Moment | Timing |
| --- | --- |
| Navigation | 550 ms · `cubic-bezier(0.4, 0, 0, 1)` — soft start, long deceleration tail |
| Mid-flight retarget | 400 ms · `cubic-bezier(0.05, 0.7, 0.1, 1)` — non-zero initial slope picks up the current velocity |
| Open / close | 220 ms scale + fade in, 160 ms fade out (asymmetric on purpose) |
| Reduced motion | 150 ms two-phase fade-through, no translation |

Input during the visible phase of a navigation (time progress < 50%) retargets from the current computed position with the deceleration-only curve — the ease-in head is never replayed. Input during the quiet tail is treated as a fresh from-rest navigation so the rhythm stays consistent.

## Features

- Morphing clip window + zero-gap filmstrip, one shared progress curve
- Interruptible: rapid navigation retargets from the current position and velocity
- Integer-pixel resting geometry — no sub-pixel bleed at the zero-gap seam
- Focus containment via `inert`, dialog semantics, screen-reader announcements
- `prefers-reduced-motion` fallback (fade-through, no movement)
- Resilient loading: one broken image cannot break the viewer
- Zero dependencies, no build step

## Repository layout

| File | Purpose |
| --- | --- |
| `lightbox.js` | The component: DOM, events, lifecycle, motion |
| `geometry.js` | Pure layout math: fit-contain rects, strip offsets, clip rects |
| `lightbox.css` | Stage and chrome styles |
| `index.html` | Demo page |

## License

[MIT](LICENSE)
