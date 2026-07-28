# Contributing

Thank you for contributing to Table of Content.

## Development

Use Node.js 18 or newer. The project has no dependency-install step. Run:

```sh
npm test
npm pack --dry-run
```

If the package provides a combined check command, run it before opening a pull
request:

```sh
npm run check
```

## Project guidelines

- Keep the component free of runtime dependencies.
- Prefer standards-based browser APIs and preserve Shadow DOM encapsulation.
- Preserve keyboard support, visible keyboard focus, accessible slider
  semantics, and reduced-motion behavior.
- Treat the documented attributes, properties, methods, events, CSS custom
  properties, and shadow parts as public API.
- Add or update tests for every behavior change.
- Update the English documentation when public API or browser requirements
  change.
- Do not commit source videos, extracted frames, sprite sheets, or other
  third-party reference media.

## Pull requests

Keep each pull request focused and explain the user-visible behavior it changes.
Include verification steps and screenshots or recordings when a visual or
motion change cannot be understood from tests alone. Reference an issue when
one exists.

By contributing, you agree that your contributions will be licensed under the
MIT License included in this repository.
