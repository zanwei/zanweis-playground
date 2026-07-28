const template = document.createElement("template");

template.innerHTML = `
  <style>
    :host {
      --shared-dialog-surface: #fff;
      --shared-dialog-ink: oklch(22% 0.008 250);
      --shared-dialog-muted: oklch(56% 0.008 250);
      --shared-dialog-line: oklch(88% 0.006 250);
      --shared-dialog-danger: oklch(52% 0.205 27);
      --shared-dialog-success: oklch(55% 0.15 148);
      --shared-dialog-shadow:
        0 4px 8px -2px rgba(16, 24, 40, 0.10),
        0 2px 4px -2px rgba(16, 24, 40, 0.06);
      --shared-dialog-panel-duration: 300ms;
      --shared-dialog-content-duration: 150ms;

      --duration-micro: 80ms;
      --duration-quick: 150ms;
      --duration-fast: 250ms;
      --duration-slow: 400ms;
      --ease-smooth-out: cubic-bezier(0.22, 1, 0.36, 1);
      --ease-in-out: ease-in-out;
      --ease-linear: linear;
      --distance-micro: 4px;
      --distance-base: 8px;
      --scale-large: 0.96;
      --blur-small: 2px;

      --text-swap-dur: var(--duration-quick);
      --text-swap-translate-y: var(--distance-micro);
      --text-swap-blur: var(--blur-small);
      --text-swap-ease: var(--ease-in-out);

      --modal-open-dur: var(--duration-fast);
      --modal-close-dur: var(--duration-quick);
      --modal-scale: var(--scale-large);
      --modal-scale-close: var(--scale-large);
      --modal-ease: var(--ease-smooth-out);

      --check-opacity-dur: var(--duration-fast);
      --check-path-dur: 200ms;
      --check-path-delay: var(--duration-micro);
      --check-ease-out: var(--ease-smooth-out);
      --check-ease-opacity: var(--ease-smooth-out);
      --check-ease-path: var(--ease-smooth-out);

      --delete-morph-dur: var(--shared-dialog-panel-duration);
      --delete-morph-ease: var(--ease-smooth-out);
      --matched-text-dur: var(--shared-dialog-content-duration);
      --success-content-dur: var(--duration-micro);
      --success-content-delay: 0ms;

      --ink: var(--shared-dialog-ink);
      --ink-muted: var(--shared-dialog-muted);
      --surface: var(--shared-dialog-surface);
      --surface-muted: oklch(98% 0.004 250);
      --line: var(--shared-dialog-line);
      --line-strong: oklch(82% 0.01 250);
      --danger: var(--shared-dialog-danger);
      --danger-soft: oklch(97% 0.018 27);
      --success: var(--shared-dialog-success);
      --success-soft: oklch(96% 0.035 148);
      --focus-ring: color-mix(in srgb, var(--ink) 22%, transparent);
      --button-shadow:
        var(--shared-dialog-shadow);
      --card-shadow:
        var(--shared-dialog-shadow);

      display: contents;
      color: var(--ink);
      font-family:
        Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI",
        system-ui, sans-serif;
      font-synthesis: none;
      font-kerning: normal;
      -webkit-font-smoothing: antialiased;
    }

    :host([hidden]) {
      display: none;
    }

    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }

    button {
      font: inherit;
    }

    dialog {
      width: min(24rem, calc(100vw - 1.5rem));
      max-width: none;
      max-height: calc(100dvh - 1rem);
      margin: auto;
      padding: 0;
      overflow: visible;
      border: 0;
      background: transparent;
      color: inherit;
    }

    dialog::backdrop {
      background: transparent;
    }

    dialog.is-closing::backdrop {
      background: transparent;
    }

    dialog:focus {
      outline: none;
    }

    .stage {
      position: relative;
      width: 100%;
      height: 13.5rem;
      contain: layout;
      isolation: isolate;
    }

    .confirm-card {
      position: relative;
      width: 100%;
      height: 100%;
      padding: 1.5rem;
    }

    .confirm-card::before {
      position: absolute;
      z-index: 0;
      inset: 0;
      border: 1px solid var(--line);
      border-radius: 1.125rem;
      background: var(--surface);
      box-shadow: var(--card-shadow);
      content: "";
      opacity: 1;
      transition: opacity var(--duration-quick) var(--ease-smooth-out);
    }

    .confirm-card.is-morphing::before {
      opacity: 0;
      transition: none;
    }

    .confirm-copy {
      position: relative;
      z-index: 1;
      display: flex;
      flex-direction: column;
      transition:
        transform var(--duration-quick) var(--ease-smooth-out),
        opacity var(--duration-quick) var(--ease-smooth-out);
    }

    .confirm-card.is-morphing .confirm-copy {
      z-index: 5;
      transform: none;
      opacity: 1;
      pointer-events: none;
      transition: none;
    }

    .confirm-card.is-morphed .confirm-copy {
      opacity: 0;
      pointer-events: none;
      transition: none;
    }

    .confirm-card.is-morphing .actions {
      z-index: 5;
      pointer-events: none;
    }

    .confirm-card.is-morphing .cancel {
      transform: none;
      opacity: 1;
      pointer-events: none;
      transition: none;
    }

    .confirm-card.is-morphed .cancel {
      opacity: 0;
      pointer-events: none;
      transition: none;
    }

    h2,
    p {
      margin: 0;
    }

    .title {
      max-width: 23ch;
      font-size: 1rem;
      font-weight: 630;
      letter-spacing: -0.018em;
      line-height: 1.35;
      text-wrap: balance;
    }

    .description {
      max-width: 37ch;
      margin-top: 0.5rem;
      color: var(--ink-muted);
      font-size: 0.9375rem;
      font-weight: 430;
      letter-spacing: -0.003em;
      line-height: 1.55;
      text-wrap: pretty;
    }

    .actions {
      position: absolute;
      z-index: 1;
      right: 1.5rem;
      bottom: 1.5rem;
      left: 1.5rem;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.625rem;
      height: 3rem;
    }

    .cancel,
    .done {
      min-width: 0;
      min-height: 3rem;
      border: 1px solid var(--line);
      border-radius: 0.75rem;
      background: var(--surface);
      cursor: pointer;
      font-size: 0.9375rem;
      font-weight: 600;
      letter-spacing: -0.01em;
      transition:
        transform var(--duration-quick) var(--ease-smooth-out),
        background-color var(--duration-quick) var(--ease-smooth-out),
        border-color var(--duration-quick) var(--ease-smooth-out),
        opacity var(--duration-quick) var(--ease-smooth-out);
    }

    .cancel {
      color: var(--ink);
    }

    .cancel:active,
    .done:active {
      transform: scale(0.98);
    }

    .cancel:focus-visible,
    .done:focus-visible,
    .delete-button:focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 2px;
    }

    .delete-slot {
      min-width: 0;
      height: 3rem;
    }

    .success-target {
      position: absolute;
      left: 50%;
      top: 50%;
      width: min(18.75rem, calc(100% - 1.5rem));
      height: 12.75rem;
      transform: translate(-50%, -50%);
      visibility: hidden;
      pointer-events: none;
    }

    .morph-surface {
      position: absolute;
      z-index: 4;
      left: calc(50% + 0.3125rem);
      top: calc(100% - 4.5rem);
      width: calc(50% - 1.8125rem);
      height: 3rem;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 0.75rem;
      background: var(--surface);
      box-shadow: none;
      contain: layout;
    }

    .morph-surface.is-success {
      border-width: 1px;
      border-radius: 1.125rem;
      box-shadow: var(--card-shadow);
    }

    .hold-fill {
      position: absolute;
      z-index: 0;
      inset: 0;
      background: var(--danger-soft);
      transform: scaleX(var(--hold-progress, 0));
      transform-origin: left center;
      opacity: 1;
      transition: opacity var(--duration-micro) var(--ease-smooth-out);
      will-change: transform;
    }

    .morph-surface[data-state="idle"] .hold-fill {
      transition:
        transform var(--duration-quick) var(--ease-smooth-out),
        opacity var(--duration-micro) var(--ease-smooth-out);
    }

    .morph-surface[data-state="morphing"] .hold-fill,
    .morph-surface[data-state="success"] .hold-fill {
      opacity: 0;
    }

    .morph-surface[data-state="morphing"] .hold-fill {
      transition: none;
    }

    .delete-button {
      position: absolute;
      z-index: 1;
      inset: 0;
      display: grid;
      width: 100%;
      height: 100%;
      place-items: center;
      padding: 0 1rem;
      touch-action: none;
      border: 0;
      border-radius: inherit;
      background: transparent;
      color: var(--danger);
      cursor: pointer;
      font-size: 0.9375rem;
      font-weight: 600;
      letter-spacing: -0.01em;
      -webkit-touch-callout: none;
      user-select: none;
      transition:
        transform var(--duration-quick) var(--ease-smooth-out),
        background-color var(--duration-quick) var(--ease-smooth-out),
        opacity var(--duration-micro) var(--ease-smooth-out);
    }

    .morph-surface[data-state="holding"] .delete-button,
    .morph-surface[data-state="armed"] .delete-button {
      transform: scale(0.98);
      background: transparent;
    }

    .morph-surface[data-state="awaiting"] .delete-button {
      transform: none;
      cursor: wait;
    }

    .morph-surface[data-state="morphing"] .delete-button {
      transform: none;
      opacity: 0;
      pointer-events: none;
      transition: none;
    }

    .morph-surface[data-state="success"] .delete-button {
      transform: translateY(calc(var(--distance-micro) * -1));
      opacity: 0;
      pointer-events: none;
    }

    .success-content {
      position: absolute;
      z-index: 2;
      inset: 0;
      display: flex;
      visibility: hidden;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      padding: 1rem;
      opacity: 0;
      pointer-events: none;
      transition: opacity var(--success-content-dur) var(--ease-smooth-out) var(--success-content-delay);
    }

    .morph-surface[data-state="morphing"] .success-content,
    .morph-surface[data-state="success"] .success-content {
      visibility: visible;
      opacity: 1;
    }

    .morph-surface[data-state="success"] .success-content {
      pointer-events: auto;
    }

    .success-message {
      display: flex;
      width: 100%;
      min-height: 0;
      flex-direction: column;
      align-items: center;
    }

    .check-disc.t-success-check {
      display: grid;
      width: 2.25rem;
      height: 2.25rem;
      flex: 0 0 auto;
      place-items: center;
      border: 0;
      border-radius: 50%;
      background: var(--success-soft);
      color: var(--success);
      line-height: 0;
    }

    .check-disc svg {
      display: block;
      width: 1.125rem;
      height: 1.125rem;
    }

    .success-title {
      margin-top: 0.5rem;
      font-size: 1rem;
      font-weight: 630;
      letter-spacing: -0.012em;
      line-height: 1.42;
      text-align: center;
      text-wrap: balance;
    }

    .success-description {
      max-width: 31ch;
      margin-top: 0.25rem;
      color: var(--ink-muted);
      font-size: 0.9375rem;
      font-weight: 430;
      letter-spacing: -0.003em;
      line-height: 1.5;
      text-align: center;
      text-wrap: pretty;
    }

    .done {
      width: 100%;
      margin-top: 0;
      background: var(--surface);
      color: var(--ink);
    }

    .done:disabled {
      cursor: default;
    }

    .reset-row {
      position: fixed;
      z-index: 6;
      left: 50%;
      bottom: max(1rem, env(safe-area-inset-bottom));
      display: none;
      justify-content: center;
      margin: 0;
      transform: translateX(-50%);
    }

    .reset-button {
      position: relative;
      min-width: 4rem;
      min-height: 2rem;
      padding: 0 0.75rem;
      border: 1px solid var(--line);
      border-radius: 0.5625rem;
      background: var(--surface);
      box-shadow: var(--button-shadow);
      color: var(--ink-muted);
      cursor: pointer;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: -0.006em;
      transition:
        transform var(--duration-quick) var(--ease-smooth-out),
        border-color var(--duration-quick) var(--ease-smooth-out),
        color var(--duration-quick) var(--ease-smooth-out);
    }

    .reset-button::before {
      position: absolute;
      inset: -0.375rem;
      content: "";
    }

    .reset-button:active {
      transform: scale(0.98);
    }

    .reset-button:focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 2px;
    }

    .reset-outside {
      position: fixed;
      left: 50%;
      bottom: max(1rem, env(safe-area-inset-bottom));
      display: none;
      transform: translateX(-50%);
    }

    :host([show-reset]) .reset-row {
      display: flex;
    }

    :host([show-reset]) .reset-outside {
      display: block;
    }

    .reset-outside:active {
      transform: translateX(-50%) scale(0.98);
    }

    dialog[open] + .reset-outside {
      visibility: hidden;
      pointer-events: none;
    }

    .sr-only {
      position: absolute !important;
      width: 1px !important;
      height: 1px !important;
      padding: 0 !important;
      overflow: hidden !important;
      clip: rect(0, 0, 0, 0) !important;
      white-space: nowrap !important;
      border: 0 !important;
    }

    @media (hover: hover) and (pointer: fine) {
      .cancel:hover,
      .done:hover,
      .reset-button:hover {
        border-color: var(--line-strong);
      }

      .reset-button:hover {
        color: var(--ink);
      }

      .delete-button:hover {
        background: var(--danger-soft);
      }
    }

    @media (max-height: 29rem) {
      dialog {
        overflow: auto;
        scrollbar-width: none;
      }

      dialog::-webkit-scrollbar {
        display: none;
      }
    }

    @media (max-width: 23rem) {
      dialog {
        width: calc(100vw - 1.25rem);
      }

      .confirm-card {
        padding: 1.25rem;
      }

      .actions {
        right: 1.25rem;
        bottom: 1.25rem;
        left: 1.25rem;
      }

      .morph-surface {
        left: calc(50% + 0.3125rem);
        top: calc(100% - 4.25rem);
        width: calc(50% - 1.5625rem);
      }

      .success-content {
        padding: 1rem;
      }
    }

    /* transitions.dev — Modal open / close */
    .t-modal {
      transform-origin: center;
      transform: scale(var(--modal-scale));
      opacity: 0;
      pointer-events: none;
      transition:
        transform var(--modal-open-dur) var(--modal-ease),
        opacity   var(--modal-open-dur) var(--modal-ease);
      will-change: transform, opacity;
    }
    .t-modal.is-open {
      transform: scale(1);
      opacity: 1;
      pointer-events: auto;
    }
    .t-modal.is-closing {
      transform: scale(var(--modal-scale-close));
      opacity: 0;
      pointer-events: none;
      transition:
        transform var(--modal-close-dur) var(--modal-ease),
        opacity   var(--modal-close-dur) var(--modal-ease);
    }

    @media (prefers-reduced-motion: reduce) {
      .t-modal { transition: none !important; }
    }

    /* transitions.dev — Text states swap */
    .t-text-swap {
      display: inline-block;
      transform: translateY(0);
      opacity: 1;
      transition:
        transform var(--text-swap-dur) var(--text-swap-ease),
        opacity   var(--text-swap-dur) var(--text-swap-ease);
      will-change: transform, opacity;
    }
    .t-text-swap.is-exit {
      transform: translateY(calc(var(--text-swap-translate-y) * -1));
      opacity: 0;
    }
    .t-text-swap.is-enter-start {
      transform: translateY(var(--text-swap-translate-y));
      opacity: 0;
      transition: none;
    }

    @media (prefers-reduced-motion: reduce) {
      .t-text-swap { transition: none !important; }
    }

    /* transitions.dev — Success check */
    .t-success-check {
      display: inline-block;
      transform-origin: center;
      opacity: 0;
      will-change: transform, opacity;
    }
    .t-success-check svg { display: block; overflow: visible; }
    .t-success-check svg path {
      stroke-dasharray: 20;
      stroke-dashoffset: 20;
    }

    .t-success-check[data-state="in"] {
      animation: t-check-fade var(--check-opacity-dur) var(--check-ease-opacity) forwards;
    }
    .t-success-check[data-state="in"] svg path {
      animation: t-check-draw var(--check-path-dur) var(--check-ease-path) var(--check-path-delay, 0ms) forwards;
    }

    @keyframes t-check-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes t-check-draw { to { stroke-dashoffset: 0; } }

    @media (prefers-reduced-motion: reduce) {
      .t-success-check { animation: none !important; opacity: 1; }
      .t-success-check svg path { animation: none !important; stroke-dashoffset: 0 !important; }
    }

    @media (prefers-reduced-motion: reduce) {
      .confirm-card::before,
      .confirm-copy,
      .cancel,
      .done,
      .reset-button,
      .delete-button,
      .success-content,
      .hold-fill {
        transition: none !important;
      }

      .morph-surface[data-state="idle"] .hold-fill {
        transition: none !important;
      }
    }

    .stage.is-resetting,
    .stage.is-resetting *,
    .stage.is-resetting *::before,
    .stage.is-resetting *::after {
      transition: none !important;
      animation: none !important;
    }

    @media (forced-colors: active) {
      .cancel:focus-visible,
      .done:focus-visible,
      .reset-button:focus-visible,
      .delete-button:focus-visible {
        outline: 1px solid CanvasText;
        outline-offset: 2px;
      }
    }
  </style>

  <dialog part="dialog" tabindex="-1" aria-labelledby="delete-title" aria-describedby="delete-description">
    <div class="stage t-modal" part="stage">
      <section class="confirm-card" part="confirmation">
        <div class="confirm-copy" part="confirmation-copy">
          <h2 class="title" id="delete-title" part="title"></h2>
          <p class="description" id="delete-description" part="description"></p>
        </div>

        <div class="actions">
          <button class="cancel" part="cancel-button" type="button">Cancel</button>
          <span class="delete-slot" aria-hidden="true"></span>
        </div>
      </section>

      <span class="success-target" aria-hidden="true"></span>

      <div class="morph-surface" data-state="idle" part="surface">
        <span class="hold-fill" aria-hidden="true"></span>
        <button
          class="delete-button"
          part="delete-button"
          type="button"
          aria-describedby="hold-instruction"
        >
          <span class="t-text-swap">Hold to delete</span>
        </button>
        <span id="hold-instruction" class="sr-only"></span>
        <span
          class="hold-progress sr-only"
          role="progressbar"
          aria-label="Hold progress"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow="0"
          aria-hidden="true"
          hidden
        ></span>

        <section class="success-content" part="success" aria-hidden="true">
          <div class="success-message">
            <span class="check-disc t-success-check" part="success-icon" data-state="out" aria-hidden="true">
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  d="M4.25 10.25 8.25 14.25 16 6.75"
                  stroke="currentColor"
                  stroke-width="2.25"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
            <h2 class="success-title" id="success-title" part="success-title">Delete succeeded</h2>
            <p class="success-description" id="success-description" part="success-description"></p>
          </div>
          <button class="done" part="done-button" type="button" disabled tabindex="-1">Done</button>
        </section>
      </div>
    </div>

    <div class="reset-row">
      <button class="reset-button reset-inside" part="reset-button" type="button">Reset</button>
    </div>

    <span class="success-announcement sr-only" aria-live="polite" aria-atomic="true"></span>
  </dialog>

  <button class="reset-button reset-outside" part="reset-button" type="button">Reset</button>
`;

export class DeleteConfirmDialog extends HTMLElement {
  static observedAttributes = ["open", "item-name", "hold-duration"];

  constructor() {
    super();

    this.attachShadow({ mode: "open" });
    this.shadowRoot.append(template.content.cloneNode(true));

    this._dialog = this.shadowRoot.querySelector("dialog");
    this._stage = this.shadowRoot.querySelector(".stage");
    this._card = this.shadowRoot.querySelector(".confirm-card");
    this._surface = this.shadowRoot.querySelector(".morph-surface");
    this._deleteSlot = this.shadowRoot.querySelector(".delete-slot");
    this._successTarget = this.shadowRoot.querySelector(".success-target");
    this._deleteButton = this.shadowRoot.querySelector(".delete-button");
    this._cancelButton = this.shadowRoot.querySelector(".cancel");
    this._doneButton = this.shadowRoot.querySelector(".done");
    this._resetButtons = [
      ...this.shadowRoot.querySelectorAll(".reset-button"),
    ];
    this._label = this.shadowRoot.querySelector(".t-text-swap");
    this._progress = this.shadowRoot.querySelector(".hold-progress");
    this._check = this.shadowRoot.querySelector(".t-success-check");
    this._checkPath = this._check.querySelector("path");
    this._successContent = this.shadowRoot.querySelector(".success-content");
    this._confirmCopy = this.shadowRoot.querySelector(".confirm-copy");
    this._confirmTitle = this.shadowRoot.querySelector(".title");
    this._confirmDescription = this.shadowRoot.querySelector(".description");
    this._successTitle = this.shadowRoot.querySelector(".success-title");
    this._successDescription =
      this.shadowRoot.querySelector(".success-description");
    this._announcement = this.shadowRoot.querySelector(".success-announcement");

    this._state = "idle";
    this._raf = 0;
    this._swapTimer = 0;
    this._closeTimer = 0;
    this._suppressClickTimer = 0;
    this._swapToken = 0;
    this._lastAnnouncedProgress = -1;
    this._returnFocus = null;
    this._morphAnimation = null;
    this._matchedGeometryAnimations = [];
    this._morphRun = 0;
    this._openRevealRaf = 0;
    this._resetReleaseRaf = 0;
    this._resizeObserver = null;
    this._connected = false;
    this._listenersAttached = false;
    this._globalListenersAttached = false;
    this._reflectingOpen = false;
    this._pointerId = null;
    this._activeKey = null;
    this._holdSource = null;
    this._suppressCommitClick = false;
    this._pendingInvoker = null;
    this._queuedCloseReason = null;

    this._handlePointerDown = this._handlePointerDown.bind(this);
    this._handlePointerMove = this._handlePointerMove.bind(this);
    this._handlePointerEnd = this._handlePointerEnd.bind(this);
    this._handleDeleteClick = this._handleDeleteClick.bind(this);
    this._handleKeyDown = this._handleKeyDown.bind(this);
    this._handleKeyUp = this._handleKeyUp.bind(this);
    this._suppressHeldKeyDown = this._suppressHeldKeyDown.bind(this);
    this._handleDialogClick = this._handleDialogClick.bind(this);
    this._handleDialogCancel = this._handleDialogCancel.bind(this);
    this._handlePostCommitPointerEnd =
      this._handlePostCommitPointerEnd.bind(this);
    this._handleWindowBlur = this._handleWindowBlur.bind(this);
    this._handleVisibilityChange = this._handleVisibilityChange.bind(this);
    this._handlePageHide = this._handlePageHide.bind(this);
    this._handleStageResize = this._handleStageResize.bind(this);
  }

  connectedCallback() {
    this._connected = true;

    if (!this._listenersAttached) {
      this._deleteButton.addEventListener("pointerdown", this._handlePointerDown);
      this._deleteButton.addEventListener("pointermove", this._handlePointerMove);
      this._deleteButton.addEventListener("pointerup", this._handlePointerEnd);
      this._deleteButton.addEventListener("pointercancel", this._handlePointerEnd);
      this._deleteButton.addEventListener("lostpointercapture", this._handlePointerEnd);
      this._deleteButton.addEventListener("keydown", this._handleKeyDown);
      this._deleteButton.addEventListener("blur", () => this._cancelHold());
      this._deleteButton.addEventListener("click", this._handleDeleteClick);
      this._deleteButton.addEventListener("contextmenu", (event) => event.preventDefault());

      this._cancelButton.addEventListener("click", () => {
        this._emit("cancel");
        this.close("cancel");
      });
      this._doneButton.addEventListener("click", () =>
        this.reset(this._doneButton),
      );
      this._resetButtons.forEach((button) => {
        button.addEventListener("click", () => this.reset(button));
      });
      this._dialog.addEventListener("click", this._handleDialogClick, true);
      this._dialog.addEventListener(
        "pointerup",
        this._handlePostCommitPointerEnd,
        true,
      );
      this._dialog.addEventListener(
        "pointercancel",
        this._handlePostCommitPointerEnd,
        true,
      );
      this._dialog.addEventListener("cancel", this._handleDialogCancel);
      this._listenersAttached = true;
    }

    if (!this._globalListenersAttached) {
      window.addEventListener("blur", this._handleWindowBlur);
      window.addEventListener("pagehide", this._handlePageHide);
      window.addEventListener("keydown", this._suppressHeldKeyDown, true);
      window.addEventListener("keyup", this._handleKeyUp, true);
      document.addEventListener("visibilitychange", this._handleVisibilityChange);
      this._globalListenersAttached = true;
    }

    this._renderCopy();
    this._calibrateCheck();
    if (typeof ResizeObserver === "function") {
      this._resizeObserver = new ResizeObserver(this._handleStageResize);
      this._resizeObserver.observe(this._stage);
    }

    if (this.hasAttribute("open")) {
      queueMicrotask(() => {
        if (this.isConnected && this.hasAttribute("open")) this._show();
      });
    }
  }

  disconnectedCallback() {
    this._connected = false;
    cancelAnimationFrame(this._raf);
    clearTimeout(this._swapTimer);
    clearTimeout(this._closeTimer);
    clearTimeout(this._suppressClickTimer);
    cancelAnimationFrame(this._openRevealRaf);
    cancelAnimationFrame(this._resetReleaseRaf);
    this._morphAnimation?.cancel();
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    this._stage.classList.remove("is-open", "is-closing", "is-resetting");
    if (this._globalListenersAttached) {
      window.removeEventListener("blur", this._handleWindowBlur);
      window.removeEventListener("pagehide", this._handlePageHide);
      window.removeEventListener("keydown", this._suppressHeldKeyDown, true);
      window.removeEventListener("keyup", this._handleKeyUp, true);
      document.removeEventListener("visibilitychange", this._handleVisibilityChange);
      this._globalListenersAttached = false;
    }
    if (this._dialog.open) this._dialog.close();
    this._resetState();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue || !this._connected) return;

    if (name === "item-name" || name === "hold-duration") {
      this._renderCopy();
      return;
    }

    if (name === "open" && !this._reflectingOpen) {
      if (newValue === null) {
        this._requestClose("attribute");
      } else {
        this._show();
      }
    }
  }

  get isOpen() {
    return this._dialog.open && !this._dialog.classList.contains("is-closing");
  }

  get open() {
    return this.hasAttribute("open");
  }

  set open(value) {
    this.toggleAttribute("open", Boolean(value));
  }

  showModal(invoker = null) {
    if (this.isOpen) return;
    this._pendingInvoker = invoker instanceof HTMLElement ? invoker : null;

    if (this.hasAttribute("open")) {
      this._show();
      return;
    }
    this.setAttribute("open", "");
  }

  close(reason = "programmatic") {
    this._reflectingOpen = true;
    this.removeAttribute("open");
    this._reflectingOpen = false;
    this._requestClose(reason);
  }

  reset(invoker = null) {
    if (!this.isConnected) {
      this.setAttribute("open", "");
      return;
    }

    this._beginInstantReset();
    clearTimeout(this._closeTimer);
    this._reflectingOpen = true;
    this.setAttribute("open", "");
    this._reflectingOpen = false;

    if (!this._dialog.open) {
      this._pendingInvoker = invoker instanceof HTMLElement ? invoker : null;
      this._show();
    } else {
      this._dialog.classList.remove("is-closing");
      this._stage.classList.remove("is-closing");
      this._stage.classList.add("is-open");
      this._resetState();
      this._applySurfaceGeometry(this._geometryFor(this._deleteSlot));

      requestAnimationFrame(() => {
        if (!this._dialog.open || this._state !== "idle") return;
        this._applySurfaceGeometry(this._geometryFor(this._deleteSlot));
        this._dialog.focus({ preventScroll: true });
      });
    }

    this._emit("dialog-reset");
  }

  complete() {
    if (this._state !== "awaiting") return false;

    this._startSuccessMorph();
    return true;
  }

  fail(message = "Delete failed. Try again.") {
    if (this._state !== "awaiting") return false;

    const itemName =
      this.getAttribute("item-name")?.trim() || "North Star project";
    this._beginInstantReset();
    this._resetState();
    this._applySurfaceGeometry(this._geometryFor(this._deleteSlot));
    this._announcement.textContent = String(message);
    this._deleteButton.focus({ preventScroll: true });
    this._emit("delete-error", {
      itemName,
      message: String(message),
    });
    return true;
  }

  _beginInstantReset() {
    cancelAnimationFrame(this._resetReleaseRaf);
    this._stage.classList.add("is-resetting");
    void this._stage.offsetWidth;

    this._resetReleaseRaf = requestAnimationFrame(() => {
      this._resetReleaseRaf = requestAnimationFrame(() => {
        this._stage.classList.remove("is-resetting");
        this._resetReleaseRaf = 0;
      });
    });
  }

  _show() {
    if (!this.isConnected) return;
    this._queuedCloseReason = null;
    if (this.isOpen) return;

    cancelAnimationFrame(this._openRevealRaf);
    this._openRevealRaf = 0;
    clearTimeout(this._closeTimer);
    this._dialog.classList.remove("is-closing");
    this._stage.classList.remove("is-closing");
    this._resetState();

    const requestedInvoker = this._pendingInvoker;
    this._pendingInvoker = null;

    if (!this._dialog.open) {
      this._returnFocus =
        requestedInvoker || this._deepActiveElement();
      this._dialog.showModal();
    } else if (requestedInvoker) {
      this._returnFocus = requestedInvoker;
    }

    this._applySurfaceGeometry(this._geometryFor(this._deleteSlot));

    const reveal = () => {
      this._openRevealRaf = 0;
      if (
        !this.isConnected ||
        !this._dialog.open ||
        this._dialog.classList.contains("is-closing")
      ) {
        return;
      }
      this._stage.classList.add("is-open");
      this._applySurfaceGeometry(this._geometryFor(this._deleteSlot));
      this._dialog.focus({ preventScroll: true });
    };

    if (this._stage.classList.contains("is-resetting")) {
      reveal();
    } else {
      this._openRevealRaf = requestAnimationFrame(reveal);
    }

    this._emit("dialog-open");
  }

  _requestClose(reason) {
    if (this._state === "morphing") {
      this._queuedCloseReason ||= reason;
      return;
    }

    if (!this._dialog.open || this._dialog.classList.contains("is-closing")) return;

    cancelAnimationFrame(this._openRevealRaf);
    this._openRevealRaf = 0;
    this._cancelHold();
    this._dialog.classList.add("is-closing");
    this._stage.classList.remove("is-open");
    this._stage.classList.add("is-closing");

    const closeMs = this._reducedMotion
      ? 0
      : this._readDuration("--modal-close-dur", 150);
    this._closeTimer = window.setTimeout(() => {
      this._dialog.close();
      this._dialog.classList.remove("is-closing");
      this._stage.classList.remove("is-closing");
      this._resetState();

      if (this._returnFocus?.isConnected) {
        this._returnFocus.focus({ preventScroll: true });
      }

      this._emit("dialog-close", { reason });
    }, closeMs);
  }

  _resetState() {
    this._morphRun += 1;
    cancelAnimationFrame(this._raf);
    cancelAnimationFrame(this._openRevealRaf);
    this._openRevealRaf = 0;
    clearTimeout(this._swapTimer);
    clearTimeout(this._suppressClickTimer);
    this._morphAnimation?.cancel();
    this._morphAnimation = null;
    this._cancelMatchedGeometryAnimations();

    this._state = "idle";
    this._releaseActivePointer();
    this._lastAnnouncedProgress = -1;
    this._surface.classList.remove("is-success");
    this._surface.dataset.state = "idle";
    this._surface.style.removeProperty("--hold-progress");
    this._surface.style.removeProperty("left");
    this._surface.style.removeProperty("top");
    this._surface.style.removeProperty("width");
    this._surface.style.removeProperty("height");
    this._surface.style.removeProperty("will-change");
    this._card.classList.remove("is-morphing", "is-morphed");
    this._deleteButton.disabled = false;
    this._deleteButton.tabIndex = 0;
    this._deleteButton.removeAttribute("aria-hidden");
    this._deleteButton.removeAttribute("aria-disabled");
    this._deleteButton.removeAttribute("aria-busy");
    this._cancelButton.disabled = false;
    this._cancelButton.removeAttribute("aria-hidden");
    this._confirmCopy.inert = false;
    this._confirmCopy.removeAttribute("aria-hidden");
    this._doneButton.disabled = true;
    this._doneButton.tabIndex = -1;
    this._progress.setAttribute("aria-valuenow", "0");
    this._progress.setAttribute("aria-hidden", "true");
    this._progress.hidden = true;
    this._successContent.setAttribute("aria-hidden", "true");
    this._announcement.textContent = "";
    this._check.setAttribute("data-state", "out");
    this._dialog.removeAttribute("aria-label");
    this._dialog.removeAttribute("aria-busy");
    this._dialog.setAttribute("aria-labelledby", "delete-title");
    this._dialog.setAttribute("aria-describedby", "delete-description");
    this._activeKey = null;
    this._queuedCloseReason = null;
    this._holdSource = null;
    this._suppressCommitClick = false;
    this._swapText("Hold to delete", true);
  }

  _renderCopy() {
    const itemName = this.getAttribute("item-name")?.trim() || "North Star project";
    const seconds = this._holdDuration / 1000;

    this.shadowRoot.querySelector("#delete-title").textContent = `Delete “${itemName}”?`;
    this.shadowRoot.querySelector("#delete-description").textContent =
      "This permanently removes the project and its activity. Press and hold to confirm.";
    this.shadowRoot.querySelector("#success-description").textContent =
      `${itemName} deleted.`;
    this.shadowRoot.querySelector("#hold-instruction").textContent =
      `Press and hold for ${seconds.toFixed(1)} seconds to permanently delete.`;
  }

  get _holdDuration() {
    const requested = Number.parseInt(this.getAttribute("hold-duration") || "", 10);
    return Number.isFinite(requested) ? Math.min(5000, Math.max(600, requested)) : 1000;
  }

  get _reducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  _handlePointerDown(event) {
    if (event.button !== 0 || this._state !== "idle") return;

    event.preventDefault();
    this._pointerId = event.pointerId;
    this._holdSource = "pointer";
    this._deleteButton.setPointerCapture(event.pointerId);
    this._deleteButton.focus({ preventScroll: true });
    this._startHold();
  }

  _handlePointerMove(event) {
    if (
      !["holding", "armed"].includes(this._state) ||
      event.pointerId !== this._pointerId
    ) {
      return;
    }

    const rect = this._deleteButton.getBoundingClientRect();
    const tolerance = 12;
    const outside =
      event.clientX < rect.left - tolerance ||
      event.clientX > rect.right + tolerance ||
      event.clientY < rect.top - tolerance ||
      event.clientY > rect.bottom + tolerance;

    if (outside) {
      this._cancelHold();
    }
  }

  _handlePointerEnd(event) {
    if (event.pointerId !== this._pointerId) return;

    const shouldCommit = this._state === "armed";
    this._releaseActivePointer();
    if (shouldCommit) {
      this._requestDelete();
    } else {
      this._cancelHold();
    }
  }

  _handleDeleteClick(event) {
    event.preventDefault();
    if (
      event.detail !== 0 ||
      this._state !== "idle" ||
      this._suppressCommitClick
    ) {
      return;
    }

    this._holdSource = "assistive";
    this._state = "armed";
    this._surface.dataset.state = "armed";
    this._surface.style.setProperty("--hold-progress", "1");
    this._progress.setAttribute("aria-valuenow", "100");
    this._requestDelete();
  }

  _handleKeyDown(event) {
    if (![" ", "Enter"].includes(event.key)) return;

    event.preventDefault();
    if (event.repeat || this._state !== "idle") return;
    this._activeKey = event.key;
    this._holdSource = "keyboard";
    this._startHold();
  }

  _handleKeyUp(event) {
    if (!this._activeKey || event.key !== this._activeKey) return;

    event.preventDefault();
    const shouldCommit = this._state === "armed";
    this._activeKey = null;
    if (shouldCommit) {
      this._requestDelete();
    } else {
      this._cancelHold();
    }

    if (this._state === "morphing" || this._state === "success") {
      this._deleteButton.disabled = true;
      if (this._state === "success") {
        this._doneButton.focus({ preventScroll: true });
      }
    }
  }

  _suppressHeldKeyDown(event) {
    if (this._activeKey && event.key === this._activeKey) {
      event.preventDefault();
    }
  }

  _handleDialogClick(event) {
    if (this._suppressCommitClick) {
      this._suppressCommitClick = false;
      clearTimeout(this._suppressClickTimer);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

  }

  _handleDialogCancel(event) {
    event.preventDefault();
    if (this._state === "morphing") return;
    if (this._state === "success") {
      this.close("success-dismiss");
      return;
    }
    this._emit("cancel");
    this.close("escape");
  }

  _handlePostCommitPointerEnd() {
    if (!this._suppressCommitClick) return;

    clearTimeout(this._suppressClickTimer);
    this._suppressClickTimer = window.setTimeout(() => {
      this._suppressCommitClick = false;
    }, 0);
  }

  _handleWindowBlur() {
    this._releaseActiveKey();
    this._cancelHold();
  }

  _handleVisibilityChange() {
    if (document.hidden) {
      this._releaseActiveKey();
      this._cancelHold();
    }
  }

  _handlePageHide() {
    this._releaseActiveKey();
    this._cancelHold();
  }

  _startHold() {
    if (this._state !== "idle") return;

    this._state = "holding";
    this._surface.dataset.state = "holding";
    this._progress.setAttribute("aria-hidden", "false");
    this._progress.hidden = false;
    this._deleteButton.setAttribute("aria-busy", "true");

    const start = performance.now();
    const duration = this._holdDuration;

    const tick = (now) => {
      if (this._state !== "holding") return;

      const progress = Math.min(1, (now - start) / duration);
      const percent = Math.round(progress * 100);
      this._surface.style.setProperty("--hold-progress", progress.toFixed(4));

      const progressBucket = Math.floor(percent / 10) * 10;
      if (progressBucket !== this._lastAnnouncedProgress) {
        this._lastAnnouncedProgress = progressBucket;
        this._progress.setAttribute("aria-valuenow", String(percent));
      }

      if (progress >= 1) {
        this._state = "armed";
        this._surface.dataset.state = "armed";
        return;
      }

      this._raf = requestAnimationFrame(tick);
    };

    this._raf = requestAnimationFrame(tick);
  }

  _cancelHold() {
    if (!["holding", "armed"].includes(this._state)) return;

    cancelAnimationFrame(this._raf);
    this._releaseActivePointer();
    this._activeKey = null;
    this._state = "idle";
    this._surface.dataset.state = "idle";
    this._surface.style.setProperty("--hold-progress", "0");
    this._progress.setAttribute("aria-valuenow", "0");
    this._progress.setAttribute("aria-hidden", "true");
    this._progress.hidden = true;
    this._deleteButton.removeAttribute("aria-busy");
  }

  _requestDelete() {
    if (this._state !== "armed") return;

    cancelAnimationFrame(this._raf);
    const requestRun = ++this._morphRun;
    this._state = "awaiting";
    this._suppressCommitClick = this._holdSource === "pointer";
    clearTimeout(this._suppressClickTimer);
    if (this._suppressCommitClick) {
      this._suppressClickTimer = window.setTimeout(() => {
        this._suppressCommitClick = false;
      }, 800);
    }
    this._releaseActivePointer();
    this._surface.dataset.state = "awaiting";
    this._surface.style.setProperty("--hold-progress", "1");
    this._progress.setAttribute("aria-valuenow", "100");
    this._dialog.removeAttribute("aria-labelledby");
    this._dialog.removeAttribute("aria-describedby");
    this._dialog.setAttribute(
      "aria-label",
      `Deleting ${this.getAttribute("item-name")?.trim() || "North Star project"}`,
    );
    this._dialog.setAttribute("aria-busy", "true");
    this._dialog.focus({ preventScroll: true });
    this._deleteButton.disabled = true;
    this._deleteButton.tabIndex = -1;
    this._deleteButton.setAttribute("aria-hidden", "true");
    this._deleteButton.setAttribute("aria-disabled", "true");
    this._deleteButton.removeAttribute("aria-busy");
    this._cancelButton.disabled = true;
    this._cancelButton.setAttribute("aria-hidden", "true");
    this._confirmCopy.inert = true;
    this._confirmCopy.setAttribute("aria-hidden", "true");
    this._progress.hidden = true;
    this._swapText("Deleting…");

    const shouldComplete = this._emit(
      "delete-request",
      {
        itemName: this.getAttribute("item-name") || "North Star project",
      },
      { cancelable: true },
    );

    if (
      requestRun !== this._morphRun ||
      this._state !== "awaiting" ||
      !this.isConnected
    ) {
      return;
    }

    if (shouldComplete) this.complete();
  }

  _startSuccessMorph() {
    if (this._state !== "awaiting") return;

    const run = ++this._morphRun;
    this._state = "morphing";
    this._surface.dataset.state = "morphing";

    const first = this._geometryFor(this._card);
    const target = this._geometryFor(this._successTarget);
    const firstStyle = getComputedStyle(this._card, "::before");
    const fromShadow = firstStyle.boxShadow;
    const closedRadius = firstStyle.borderTopLeftRadius;
    const matchedPairs = this._captureMatchedGeometryPairs();

    this._card.classList.add("is-morphing");
    this._surface.classList.add("is-success");
    this._applySurfaceGeometry(target);
    this._showCheck();
    matchedPairs.forEach((pair) => {
      pair.targetRect = pair.target.getBoundingClientRect();
      if (pair.scaleMode === "font") {
        pair.targetFontSize =
          Number.parseFloat(getComputedStyle(pair.target).fontSize) ||
          pair.sourceFontSize;
      }
    });
    const lastStyle = getComputedStyle(this._surface);
    const toShadow = lastStyle.boxShadow;
    const openRadius = lastStyle.borderTopLeftRadius;

    if (this._reducedMotion || typeof this._surface.animate !== "function") {
      this._finishMorph(run);
      return;
    }

    const duration = this._readDuration("--delete-morph-dur", 400);
    const easing =
      getComputedStyle(this).getPropertyValue("--delete-morph-ease").trim() ||
      "cubic-bezier(0.22, 1, 0.36, 1)";
    const textDuration = this._readDuration("--matched-text-dur", 100);

    this._surface.style.willChange =
      "left, top, width, height, border-radius, box-shadow";
    const animation = this._surface.animate(
      [
        {
          left: `${first.left}px`,
          top: `${first.top}px`,
          width: `${first.width}px`,
          height: `${first.height}px`,
          borderRadius: closedRadius,
          boxShadow: fromShadow,
        },
        {
          left: `${target.left}px`,
          top: `${target.top}px`,
          width: `${target.width}px`,
          height: `${target.height}px`,
          borderRadius: openRadius,
          boxShadow: toShadow,
        },
      ],
      {
        duration,
        easing,
        fill: "both",
      },
    );
    animation.pause();
    animation.currentTime = 0;
    this._morphAnimation = animation;
    this._startMatchedGeometry(matchedPairs, textDuration, easing);
    animation.play();
    this._matchedGeometryAnimations.forEach((matchedAnimation) =>
      matchedAnimation.play(),
    );

    animation.finished
      .then(() => {
        if (
          run !== this._morphRun ||
          this._state !== "morphing" ||
          this._morphAnimation !== animation
        ) {
          return;
        }
        animation.cancel();
        this._morphAnimation = null;
        this._finishMorph(run);
      })
      .catch(() => {});
  }

  _finishMorph(run) {
    if (run !== this._morphRun || this._state !== "morphing") return;

    this._state = "success";
    this._surface.dataset.state = "success";
    this._surface.style.removeProperty("will-change");
    this._card.classList.add("is-morphed");
    this._cancelMatchedGeometryAnimations();
    this._dialog.removeAttribute("aria-label");
    this._dialog.removeAttribute("aria-busy");
    this._dialog.setAttribute("aria-labelledby", "success-title");
    this._dialog.setAttribute("aria-describedby", "success-description");
    this._successContent.setAttribute("aria-hidden", "false");
    this._doneButton.disabled = false;
    this._doneButton.tabIndex = 0;
    this._announceSuccess();
    if (!this._activeKey && this._holdSource === "keyboard") {
      this._doneButton.focus({ preventScroll: true });
    }

    this._emit("delete-success", {
      itemName: this.getAttribute("item-name") || "North Star project",
    });

    const queuedCloseReason = this._queuedCloseReason;
    this._queuedCloseReason = null;
    if (queuedCloseReason) {
      this.close(queuedCloseReason);
    }
  }

  _showCheck() {
    this._check.setAttribute("data-state", "out");
    void this._check.offsetWidth;
    this._check.setAttribute("data-state", "in");
  }

  _captureMatchedGeometryPairs() {
    return [
      {
        source: this._confirmTitle,
        target: this._successTitle,
        scaleMode: "font",
      },
      {
        source: this._confirmDescription,
        target: this._successDescription,
        scaleMode: "font",
      },
      {
        source: this._cancelButton,
        target: this._doneButton,
        scaleMode: "box",
      },
    ].map((pair) => ({
      ...pair,
      sourceRect: pair.source.getBoundingClientRect(),
      sourceFontSize:
        pair.scaleMode === "font"
          ? Number.parseFloat(getComputedStyle(pair.source).fontSize) || 16
          : null,
    }));
  }

  _startMatchedGeometry(pairs, duration, easing) {
    this._cancelMatchedGeometryAnimations();
    const fadeDuration = this._readDuration("--success-content-dur", 80);

    pairs.forEach((pair) => {
      const currentTargetRect = pair.target.getBoundingClientRect();
      const sourceCenterX =
        pair.sourceRect.left + pair.sourceRect.width / 2;
      const sourceCenterY =
        pair.sourceRect.top + pair.sourceRect.height / 2;
      const targetStartCenterX =
        currentTargetRect.left + currentTargetRect.width / 2;
      const targetStartCenterY =
        currentTargetRect.top + currentTargetRect.height / 2;
      const targetEndCenterX =
        pair.targetRect.left + pair.targetRect.width / 2;
      const targetEndCenterY =
        pair.targetRect.top + pair.targetRect.height / 2;
      const usesBoxScale = pair.scaleMode === "box";
      const targetStartScaleX = usesBoxScale
        ? pair.sourceRect.width / Math.max(currentTargetRect.width, 1)
        : pair.sourceFontSize / pair.targetFontSize;
      const targetStartScaleY = usesBoxScale
        ? pair.sourceRect.height / Math.max(currentTargetRect.height, 1)
        : targetStartScaleX;
      const sourceEndScaleX = usesBoxScale
        ? pair.targetRect.width / Math.max(pair.sourceRect.width, 1)
        : pair.targetFontSize / pair.sourceFontSize;
      const sourceEndScaleY = usesBoxScale
        ? pair.targetRect.height / Math.max(pair.sourceRect.height, 1)
        : sourceEndScaleX;

      pair.source.style.transformOrigin = "center center";
      pair.target.style.transformOrigin = "center center";
      pair.source.style.willChange = "transform, opacity";
      pair.target.style.willChange = "transform";

      const targetMotion = pair.target.animate(
        [
          {
            transform: `translate(${sourceCenterX - targetStartCenterX}px, ${sourceCenterY - targetStartCenterY}px) scale(${targetStartScaleX}, ${targetStartScaleY})`,
          },
          { transform: "translate(0, 0) scale(1, 1)" },
        ],
        { duration, easing, fill: "both" },
      );
      const sourceMotion = pair.source.animate(
        [
          { transform: "translate(0, 0) scale(1, 1)" },
          {
            transform: `translate(${targetEndCenterX - sourceCenterX}px, ${targetEndCenterY - sourceCenterY}px) scale(${sourceEndScaleX}, ${sourceEndScaleY})`,
          },
        ],
        { duration, easing, fill: "both" },
      );
      const sourceFade = pair.source.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: fadeDuration, easing, fill: "both" },
      );

      [targetMotion, sourceMotion, sourceFade].forEach((animation) => {
        animation.pause();
        animation.currentTime = 0;
        this._matchedGeometryAnimations.push(animation);
      });
    });
  }

  _cancelMatchedGeometryAnimations() {
    this._matchedGeometryAnimations.forEach((animation) => animation.cancel());
    this._matchedGeometryAnimations = [];

    [
      this._confirmTitle,
      this._confirmDescription,
      this._successTitle,
      this._successDescription,
      this._cancelButton,
      this._doneButton,
    ].forEach((element) => {
      if (!element) return;
      element.style.removeProperty("transform-origin");
      element.style.removeProperty("will-change");
    });
  }

  _announceSuccess() {
    const itemName = this.getAttribute("item-name")?.trim() || "North Star project";
    this._announcement.textContent = "";
    requestAnimationFrame(() => {
      if (this._state === "success") {
        this._announcement.textContent =
          `Delete succeeded. ${itemName} was permanently deleted.`;
      }
    });
  }

  _geometryFor(element) {
    const stageRect = this._stage.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const scaleX = stageRect.width / this._stage.offsetWidth || 1;
    const scaleY = stageRect.height / this._stage.offsetHeight || 1;

    return {
      left: (elementRect.left - stageRect.left) / scaleX,
      top: (elementRect.top - stageRect.top) / scaleY,
      width: elementRect.width / scaleX,
      height: elementRect.height / scaleY,
    };
  }

  _applySurfaceGeometry(geometry) {
    this._surface.style.left = `${geometry.left}px`;
    this._surface.style.top = `${geometry.top}px`;
    this._surface.style.width = `${geometry.width}px`;
    this._surface.style.height = `${geometry.height}px`;
  }

  _handleStageResize() {
    if (!this._dialog.open) return;

    if (this._state === "morphing") {
      const run = this._morphRun;
      const animation = this._morphAnimation;
      this._morphAnimation = null;
      animation?.cancel();
      this._applySurfaceGeometry(this._geometryFor(this._successTarget));
      this._finishMorph(run);
      return;
    }

    const target =
      this._state === "success" ? this._successTarget : this._deleteSlot;
    this._applySurfaceGeometry(this._geometryFor(target));
  }

  _deepActiveElement() {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    return active instanceof HTMLElement ? active : null;
  }

  _calibrateCheck() {
    const length = Math.ceil(this._checkPath.getTotalLength()) + 1;
    this._checkPath.style.strokeDasharray = String(length);
    this._checkPath.style.strokeDashoffset = String(length);
  }

  _swapText(next, immediate = false) {
    clearTimeout(this._swapTimer);
    const token = ++this._swapToken;

    if (immediate || this._reducedMotion || this._label.textContent === next) {
      this._label.textContent = next;
      this._label.classList.remove("is-exit", "is-enter-start");
      return;
    }

    this._label.classList.add("is-exit");
    const duration = this._readDuration("--text-swap-dur", 150);

    this._swapTimer = window.setTimeout(() => {
      if (token !== this._swapToken) return;

      this._label.textContent = next;
      this._label.classList.remove("is-exit");
      this._label.classList.add("is-enter-start");
      void this._label.offsetHeight;
      this._label.classList.remove("is-enter-start");
    }, duration);
  }

  _readDuration(property, fallback) {
    const raw = getComputedStyle(this).getPropertyValue(property).trim();
    if (!raw) return fallback;

    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) return fallback;
    return raw.endsWith("s") && !raw.endsWith("ms") ? value * 1000 : value;
  }

  _emit(type, detail = null, options = {}) {
    return this.dispatchEvent(
      new CustomEvent(type, {
        bubbles: true,
        composed: true,
        detail,
        ...options,
      }),
    );
  }

  _releaseActivePointer() {
    const pointerId = this._pointerId;
    this._pointerId = null;
    if (pointerId === null) return;

    if (this._deleteButton.hasPointerCapture(pointerId)) {
      this._deleteButton.releasePointerCapture(pointerId);
    }
  }

  _releaseActiveKey() {
    if (!this._activeKey) return;

    this._activeKey = null;
    if (this._state === "morphing" || this._state === "success") {
      this._deleteButton.disabled = true;
      if (this._state === "success") {
        this._doneButton.focus({ preventScroll: true });
      }
    }
  }
}

if (!customElements.get("delete-confirm-dialog")) {
  customElements.define("delete-confirm-dialog", DeleteConfirmDialog);
}

export default DeleteConfirmDialog;
