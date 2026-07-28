# Contributing

Thank you for considering a contribution to `<model-picker>`.

## Before you begin

- Open an issue before starting a significant feature or behavior change.
- Keep the component free of runtime dependencies and based on native Custom Elements supported by modern browsers.
- Preserve the existing visual behavior, keyboard interaction, and public API unless the change explicitly intends to modify them.
- Provide a `prefers-reduced-motion` fallback for any new motion.

## Local verification

Start a static server:

```sh
python3 -m http.server 4173
```

Run the JavaScript syntax check:

```sh
node --check model-picker.js
```

Manually verify mouse, touch, and keyboard interaction, including the component's behavior at narrow viewport widths.

## Pull requests

Keep each pull request focused on one concern. Explain the motivation, behavioral differences, and verification steps. Include screenshots or a recording for visual changes.
