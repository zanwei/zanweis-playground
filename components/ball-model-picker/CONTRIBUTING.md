# Contributing

Thank you for considering a contribution to `<ball-model-picker>`.

## Before you begin

- Open an issue before starting a significant feature or behavior change.
- Keep the component free of runtime dependencies and based on native Custom Elements supported by modern browsers.
- Preserve the ball physics, visual behavior, keyboard interaction, and public API unless the change explicitly intends to modify them.
- Add deterministic coverage for changes to gravity, collisions, pocket capture, or result selection.
- Provide a `prefers-reduced-motion` fallback for any new motion.

## Local verification

Start a static server:

```sh
python3 -m http.server 4173
```

Run the automated checks:

```sh
npm test
node --check src/ball-model-picker.js
node --check src/pinball-physics.js
```

Manually verify the Again action, close and reopen behavior, repeated runs, narrow viewport layout, and reduced-motion mode.

## Pull requests

Keep each pull request focused on one concern. Explain the motivation, behavioral differences, and verification steps. Include screenshots or a recording for visual changes.
