## Design Context

### Users

Frontend developers exploring an open-source Web Component. They should be able to understand the interaction immediately, inspect a polished implementation, and reuse or adapt the component without a framework or build step.

### Brand Personality

Restrained, playful, and refined. The component should feel physically responsive and quietly delightful, with clear cause-and-effect between the falling ball, peg collisions, and the committed model-effort result.

### Aesthetic Direction

A compact dark pinball surface with neutral hardware and a single lavender-white focal light. Collision feedback should directly reference the supplied screenshot: the moving ball remains the brightest point, while contacted grey pegs briefly become lavender nodes surrounded by thin concentric rings. Motion should remain precise and low-noise rather than arcade-like or neon-heavy.

### Design Principles

1. Make physics legible: every visual effect must correspond to a real collision or trajectory state.
2. Keep one focal point: the active ball is brightest; peg halos and paths stay subordinate.
3. Prefer instant decay: collision rings must return to zero opacity, and the trajectory is only a short live tail that disappears immediately after the ball passes.
4. Preserve the compact component: do not add controls, labels, badges, or decorative UI.
5. Keep the implementation inspectable: native Web Components, CSS, SVG, and deterministic physics with no runtime dependencies.
6. Respect motion sensitivity: provide a static or immediate reduced-motion result with no path or halo animation.
