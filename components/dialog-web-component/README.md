# Shared Element Transition Dialog

https://github.com/user-attachments/assets/03215a2a-1204-4e2b-8d76-f5c4db711d3d

A dependency-free hold-to-delete Web Component. The confirmation surface,
text, and buttons transition into a compact success dialog with the Web
Animations API.

## Features

- Hold progress for pointer and keyboard input
- Shared-element transitions between confirmation and success states
- Native `<dialog>`, Shadow DOM, focus restoration, and reduced motion
- Cancelable async delete requests
- No runtime dependencies

## Usage

```html
<script type="module" src="./index.js"></script>

<delete-confirm-dialog
  open
  item-name="North Star project"
  hold-duration="1000"
></delete-confirm-dialog>
```

```js
const dialog = document.querySelector("delete-confirm-dialog");

dialog.showModal();
dialog.close();
dialog.reset();
```

The component does not delete data. Without a listener it completes the visual
demo automatically. For async work, cancel the default request and settle it
explicitly:

```js
dialog.addEventListener("delete-request", async (event) => {
  event.preventDefault();

  try {
    await deleteProject(event.detail.itemName);
    dialog.complete();
  } catch {
    dialog.fail();
  }
});
```

Attributes: `open`, `item-name`, `hold-duration`, and the demo-only
`show-reset`.

Events: `delete-request`, `delete-success`, `delete-error`, `cancel`,
`dialog-open`, `dialog-close`, and `dialog-reset`. Events bubble and cross the
shadow boundary.

Public parts include `dialog`, `confirmation`, `surface`, `delete-button`,
`cancel-button`, `done-button`, and the success content parts.

```css
delete-confirm-dialog {
  --shared-dialog-surface: #fff;
  --shared-dialog-ink: oklch(22% 0.008 250);
  --shared-dialog-danger: oklch(52% 0.205 27);
  --shared-dialog-success: oklch(55% 0.15 148);
  --shared-dialog-panel-duration: 300ms;
  --shared-dialog-content-duration: 150ms;
}
```

## Development

```sh
npm run dev
```

Open `http://localhost:4173`.

The component targets current browsers with Custom Elements, Shadow DOM,
native `<dialog>`, `inert`, and the Web Animations API. Inter is supplied by
the host page.

## License

[MIT](./LICENSE)
