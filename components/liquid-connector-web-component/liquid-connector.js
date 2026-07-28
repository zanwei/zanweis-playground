(function installLiquidConnector(global) {
  "use strict";

  const Path = global.LiquidPath;
  if (!Path) {
    throw new Error("liquid-path.js must load before liquid-connector.js");
  }

  const {
    DEFAULT_PEEL_PARAMETERS,
    LIQUID_GEOMETRY,
    LIQUID_MOTION,
    clamp,
    createLiquidFrame,
    finiteNumber,
    normalizePeelParameters,
    openingTension,
    resolveLiquidMode,
    resolveScrubMode,
    sampleMeasuredTransition,
  } = Path;

  const template = document.createElement("template");
  template.innerHTML = `
    <style>
      :host {
        --liquid-surface: #fdfdfd;
        --liquid-ink: #191919;
        --liquid-muted: #686868;
        --liquid-blue: #1e55c7;
        display: block;
        width: 520px;
        max-width: 100%;
        aspect-ratio: 520 / 300;
        contain: layout style;
        color: var(--liquid-ink);
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
        font-synthesis: none;
        -webkit-font-smoothing: antialiased;
        text-rendering: geometricPrecision;
      }

      *,
      *::before,
      *::after {
        box-sizing: border-box;
      }

      svg.stage {
        display: block;
        width: 100%;
        height: 100%;
        overflow: visible;
      }

      .surface-fill,
      .outline-edge,
      .surface,
      .debug-layer,
      .debug-layer path {
        pointer-events: none;
        vector-effect: non-scaling-stroke;
      }

      .surface-fill {
        fill: var(--liquid-surface);
        stroke: none;
      }

      .outline-edge {
        fill: none;
        stroke: #dedede;
        stroke-width: 1.5;
      }

      .surface {
        fill: none;
        stroke: #e2e2e2;
        stroke-width: 0.65;
      }

      :host(:focus-within) .surface {
        stroke: color-mix(in srgb, var(--liquid-blue) 42%, #e2e2e2);
        stroke-width: 1.1;
      }

      .content {
        width: 100%;
        height: 100%;
        color: var(--liquid-ink);
      }

      .output-content {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        padding: 0 12px 0 24px;
        transform-origin: 50% 100%;
      }

      .output-object {
        --output-blur: 0px;
        filter: blur(var(--output-blur));
      }

      .output-smear {
        pointer-events: none;
        opacity: 0;
      }

      :host([data-animating]) .output-content {
        will-change: opacity, transform;
      }

      :host([data-animating]) .input-content {
        will-change: transform;
      }

      .identity {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: 13px;
        margin-right: auto;
        transform: translateY(-2px);
      }

      .notion-mark {
        display: block;
        width: 31px;
        height: 33px;
        flex: 0 0 31px;
        color: #111111;
      }

      .provider-copy {
        display: block;
        min-width: 0;
        line-height: 1;
      }

      .eyebrow {
        display: block;
        overflow: hidden;
        color: var(--liquid-muted);
        font-size: 11px;
        font-weight: 500;
        line-height: 13px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .provider-name {
        display: block;
        margin-top: 1px;
        font-size: 17px;
        font-weight: 600;
        letter-spacing: -0.015em;
        line-height: 18px;
      }

      button,
      textarea {
        font: inherit;
      }

      button {
        position: relative;
        border: 0;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }

      button::before {
        position: absolute;
        top: 50%;
        left: 50%;
        width: max(100%, 44px);
        height: max(100%, 44px);
        content: "";
        transform: translate(-50%, -50%);
      }

      button:focus-visible {
        outline: 2px solid #2b70e8;
        outline-offset: 2px;
      }

      button:disabled {
        cursor: default;
      }

      .actions {
        display: flex;
        flex: 0 0 auto;
        align-items: center;
        gap: 21px;
        transform: translateY(-1px);
      }

      .skip {
        width: 32px;
        min-height: 32px;
        padding: 0;
        background: transparent;
        color: #525252;
        font-size: 14px;
        font-weight: 600;
        line-height: 1;
      }

      .connect {
        width: 97px;
        height: 35px;
        padding: 0;
        border: 1px solid #ccd9f2;
        border-radius: 999px;
        background: #fdfdfd;
        box-shadow:
          0 1px 2px rgba(31, 73, 150, 0.06),
          inset 0 0 0 0.5px rgba(255, 255, 255, 0.8);
        color: var(--liquid-blue);
        font-size: 15px;
        font-weight: 600;
        line-height: 1;
      }

      .connect:not(:disabled):hover {
        border-color: #adc4ec;
        background: #fafcff;
      }

      .connect:not(:disabled):active {
        transform: scale(0.97);
      }

      .input-content {
        position: relative;
        transform-origin: 50% 100%;
      }

      textarea {
        position: absolute;
        top: 19px;
        right: 24px;
        left: 23px;
        width: calc(100% - 47px);
        height: 54px;
        padding: 0;
        resize: none;
        border: 0;
        outline: 0;
        background: transparent;
        color: #242424;
        font-size: 18px;
        font-weight: 400;
        letter-spacing: 0.009em;
        line-height: 1.4;
      }

      textarea::placeholder {
        color: #535353;
        opacity: 1;
      }

      textarea:focus-visible {
        border-radius: 4px;
        outline: 2px solid #2b70e8;
        outline-offset: 4px;
      }

      .send {
        --send-offset-y: 0px;
        --send-height: 34px;
        --send-radius-y: 17px;
        --send-arrow-scale-y: 1;
        position: absolute;
        right: 14px;
        bottom: 17px;
        display: grid;
        width: 34px;
        height: var(--send-height);
        padding: 0;
        place-items: center;
        border-radius: 17px / var(--send-radius-y);
        background: #dedede;
        color: #ffffff;
        transform: translateY(var(--send-offset-y));
        transform-origin: 50% 50%;
      }

      .send:disabled {
        cursor: default;
      }

      .send:not(:disabled) {
        background: #2369df;
      }

      .send:not(:disabled):active {
        transform:
          translateY(var(--send-offset-y))
          scale(0.97);
      }

      .send svg {
        display: block;
        width: 15px;
        height: 15px;
        transform: scaleY(var(--send-arrow-scale-y));
        transform-origin: 50% 50%;
      }

      .debug-layer {
        display: none;
      }

      :host([debug]) .debug-layer {
        display: block;
      }

      .debug-actual,
      .debug-output,
      .debug-input,
      .debug-contact-zone,
      .debug-contact-band,
      .debug-waist {
        fill: none;
        stroke-linecap: round;
        stroke-linejoin: round;
        vector-effect: non-scaling-stroke;
      }

      .debug-actual {
        stroke: #ff9348;
        stroke-width: 1.25;
      }

      .debug-output {
        stroke: #78a4ff;
        stroke-width: 1;
      }

      .debug-input {
        stroke: #78a4ff;
        stroke-width: 1;
      }

      .debug-contact-zone {
        stroke: #ff5353;
        stroke-opacity: 0.9;
        stroke-width: 1;
      }

      .debug-contact-band {
        stroke: #ff5353;
        stroke-dasharray: 2 3;
        stroke-opacity: 0.68;
        stroke-width: 0.85;
      }

      .debug-waist {
        stroke: #ff5353;
        stroke-dasharray: 3 3;
        stroke-width: 1;
      }

      @media (prefers-reduced-motion: reduce) {
        .connect,
        .send {
          transition-duration: 0ms;
        }
      }
    </style>

    <svg class="stage" viewBox="0 0 520 300" role="group" aria-label="Liquid connector prompt">
      <path class="surface-fill" part="surface"></path>
      <path class="outline-edge" part="outline"></path>
      <path class="surface" part="focus-outline"></path>

      <foreignObject class="output-object" part="connector-card" x="40" y="57" width="440" height="68">
        <div class="content output-content" xmlns="http://www.w3.org/1999/xhtml">
          <div class="identity" part="identity">
            <svg class="notion-mark" part="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z"></path>
            </svg>
            <span class="provider-copy" part="provider-copy">
              <span class="eyebrow" part="eyebrow">MCP Connector</span>
              <span class="provider-name" part="provider">Notion</span>
            </span>
          </div>
          <div class="actions">
            <button class="skip" part="skip-button" type="button">Skip</button>
            <button class="connect" part="connect-button" type="button">Connect</button>
          </div>
        </div>
      </foreignObject>

      <foreignObject class="input-object" part="prompt-card" x="40" y="135" width="440" height="134">
        <div class="content input-content" xmlns="http://www.w3.org/1999/xhtml">
          <textarea part="prompt" rows="2" aria-label="Prompt" placeholder="Ask anything..."></textarea>
          <button class="send" part="send-button" type="button" aria-label="Send prompt" disabled>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 13V3M8 3 4.5 6.5M8 3l3.5 3.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path>
            </svg>
          </button>
        </div>
      </foreignObject>

      <g class="debug-layer" aria-hidden="true">
        <path class="debug-input"></path>
        <path class="debug-output"></path>
        <path class="debug-contact-zone"></path>
        <path class="debug-contact-band"></path>
        <path class="debug-actual"></path>
        <path class="debug-waist"></path>
      </g>
    </svg>
  `;

  function targetGap(value, fallback = LIQUID_GEOMETRY.restGap) {
    return clamp(
      finiteNumber(value, fallback),
      LIQUID_GEOMETRY.minGap,
      LIQUID_GEOMETRY.maxGap,
    );
  }

  /**
   * A browser-only Web Component that renders a liquid connector with
   * deterministic SVG path math.
   *
   * @fires connect
   * @fires skip
   * @fires submit
   * @fires liquid-toggle
   * @fires liquid-frame
   */
  class LiquidConnector extends HTMLElement {
    static get observedAttributes() {
      return [
        "open",
        "gap",
        "debug",
        "provider",
        "eyebrow",
        "placeholder",
        "connect-label",
        "skip-label",
        "prompt-label",
        "send-label",
        "stage-label",
      ];
    }

    constructor() {
      super();
      this.attachShadow({ mode: "open" }).append(
        template.content.cloneNode(true),
      );
      this._fillPath =
        this.shadowRoot.querySelector(".surface-fill");
      this._paths = [
        ...this.shadowRoot.querySelectorAll(
          ".outline-edge, .surface",
        ),
      ];
      this._debugPaths = {
        actual: this.shadowRoot.querySelector(".debug-actual"),
        output: this.shadowRoot.querySelector(".debug-output"),
        input: this.shadowRoot.querySelector(".debug-input"),
        contactZone: this.shadowRoot.querySelector(
          ".debug-contact-zone",
        ),
        contactBand: this.shadowRoot.querySelector(
          ".debug-contact-band",
        ),
        waist: this.shadowRoot.querySelector(".debug-waist"),
      };
      this._outputObject = this.shadowRoot.querySelector(".output-object");
      this._stage = this.shadowRoot.querySelector(".stage");
      this._inputObject = this.shadowRoot.querySelector(".input-object");
      this._outputContent = this.shadowRoot.querySelector(".output-content");
      this._inputContent = this.shadowRoot.querySelector(".input-content");
      this._providerName = this.shadowRoot.querySelector(".provider-name");
      this._eyebrow = this.shadowRoot.querySelector(".eyebrow");
      this._textarea = this.shadowRoot.querySelector("textarea");
      this._connect = this.shadowRoot.querySelector(".connect");
      this._skip = this.shadowRoot.querySelector(".skip");
      this._send = this.shadowRoot.querySelector(".send");
      this._outputSmears = [-2, 2].map((offset) => {
        const clone = this._outputContent.cloneNode(true);
        clone.classList.add("output-smear");
        clone.setAttribute("aria-hidden", "true");
        clone.inert = true;
        clone.dataset.offset = String(offset);
        for (const button of clone.querySelectorAll("button")) {
          button.tabIndex = -1;
        }
        this._outputObject.append(clone);
        return clone;
      });
      this._restGap = LIQUID_GEOMETRY.restGap;
      this._peelParameters = normalizePeelParameters(
        DEFAULT_PEEL_PARAMETERS,
      );
      this._gap = LIQUID_GEOMETRY.hiddenGap;
      this._targetGap = LIQUID_GEOMETRY.hiddenGap;
      this._velocity = 0;
      this._mode = "merged";
      this._tearAge = -1;
      this._tearStrength = 0;
      this._direction = "idle";
      this._motionKind = "idle";
      this._transitionAge = 0;
      this._peakOpeningTension = 0;
      this._frame = null;
      this._raf = 0;
      this._lastTime = 0;
      this._connected = false;
      this._reducedMotion =
        typeof matchMedia === "function"
          ? matchMedia("(prefers-reduced-motion: reduce)")
          : { matches: false };
      this._tick = this._tick.bind(this);

      this._onConnect = () => {
        this.dispatchEvent(
          new CustomEvent("connect", { bubbles: true, composed: true }),
        );
      };
      this._onSkip = () => {
        this._textarea.focus({ preventScroll: true });
        this.toggle(false);
        this.dispatchEvent(
          new CustomEvent("skip", { bubbles: true, composed: true }),
        );
      };
      this._onSend = () => {
        if (this._send.disabled) return;
        this.dispatchEvent(
          new CustomEvent("submit", {
            bubbles: true,
            cancelable: true,
            composed: true,
            detail: { value: this.value },
          }),
        );
      };
      this._onInput = () => this._syncInputState();
      this._onKeyDown = (event) => {
        if (
          event.key === "Enter" &&
          !event.shiftKey &&
          !event.isComposing &&
          event.keyCode !== 229
        ) {
          event.preventDefault();
          this._onSend();
        }
      };
      this._onReducedMotionChange = (event) => {
        if (event.matches) this._finishImmediately();
      };
    }

    connectedCallback() {
      if (this._connected) return;
      this._connected = true;
      this._restGap = targetGap(
        this.getAttribute("gap"),
        LIQUID_GEOMETRY.restGap,
      );
      this._gap = this.open
        ? this._restGap
        : LIQUID_GEOMETRY.hiddenGap;
      this._targetGap = this._gap;
      this._mode = resolveLiquidMode(
        undefined,
        this._gap,
        0,
        this._peelParameters,
      );
      this._direction = "idle";
      this._motionKind = "idle";
      this._transitionAge = 0;
      this._peakOpeningTension = 0;
      this._syncCopy();
      this._syncInputState();
      this._render();

      this._connect.addEventListener("click", this._onConnect);
      this._skip.addEventListener("click", this._onSkip);
      this._send.addEventListener("click", this._onSend);
      this._textarea.addEventListener("input", this._onInput);
      this._textarea.addEventListener("keydown", this._onKeyDown);
      if (this._reducedMotion.addEventListener) {
        this._reducedMotion.addEventListener(
          "change",
          this._onReducedMotionChange,
        );
      } else {
        this._reducedMotion.addListener?.(
          this._onReducedMotionChange,
        );
      }
    }

    disconnectedCallback() {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
      this._lastTime = 0;
      this.removeAttribute("data-animating");
      this._connect.removeEventListener("click", this._onConnect);
      this._skip.removeEventListener("click", this._onSkip);
      this._send.removeEventListener("click", this._onSend);
      this._textarea.removeEventListener("input", this._onInput);
      this._textarea.removeEventListener("keydown", this._onKeyDown);
      if (this._reducedMotion.removeEventListener) {
        this._reducedMotion.removeEventListener(
          "change",
          this._onReducedMotionChange,
        );
      } else {
        this._reducedMotion.removeListener?.(
          this._onReducedMotionChange,
        );
      }
      this._connected = false;
    }

    attributeChangedCallback(name, oldValue, newValue) {
      if (!this._connected) return;
      if (name === "gap") {
        this._restGap = targetGap(this.getAttribute("gap"), this._restGap);
        if (this.open) this._setTarget(this._restGap);
      } else if (name === "open") {
        if (!this.open) {
          this._moveFocusFromOutput();
          this._outputObject.style.pointerEvents = "none";
          this._outputObject.setAttribute("aria-hidden", "true");
          this._outputContent.inert = true;
          this._connect.disabled = true;
          this._skip.disabled = true;
        }
        this._setTarget(
          this.open ? this._restGap : LIQUID_GEOMETRY.hiddenGap,
        );
        if (oldValue !== newValue) {
          this.dispatchEvent(
            new CustomEvent("liquid-toggle", {
              bubbles: true,
              composed: true,
              detail: { open: this.open },
            }),
          );
        }
      } else if (name === "debug") {
        this._render();
        this._emitFrame();
      } else {
        this._syncCopy();
      }
    }

    get open() {
      return this.hasAttribute("open");
    }

    set open(value) {
      this.toggle(Boolean(value));
    }

    get gap() {
      return this._restGap;
    }

    set gap(value) {
      this.setGap(value);
    }

    get peelParameters() {
      return { ...this._peelParameters };
    }

    set peelParameters(value) {
      this.setPeelParameters(value);
    }

    get value() {
      return this._textarea.value;
    }

    set value(value) {
      this._textarea.value = String(value ?? "");
      this._syncInputState();
    }

    /**
     * Opens or closes the connector.
     * @param {boolean} [force]
     * @returns {boolean} The resulting open state.
     */
    toggle(force = !this.open) {
      const next = Boolean(force);
      if (next === this.open) return this.open;
      this.toggleAttribute("open", next);
      return this.open;
    }

    /**
     * Sets the resting surface gap.
     * @param {number} value
     * @param {{ immediate?: boolean }} [options]
     */
    setGap(value, { immediate = false } = {}) {
      const next = targetGap(value, this._restGap);
      this._restGap = next;
      if (this.getAttribute("gap") !== String(next)) {
        this.setAttribute("gap", String(next));
      }
      if (!this.open) this.toggle(true);

      if (immediate || this._reducedMotion.matches) {
        cancelAnimationFrame(this._raf);
        this._raf = 0;
        this.removeAttribute("data-animating");
        this._gap = next;
        this._targetGap = next;
        this._velocity = 0;
        this._tearAge = -1;
        this._tearStrength = 0;
        this._direction = "scrub";
        this._motionKind = "idle";
        this._transitionAge = 0;
        this._peakOpeningTension = 0;
        this._render();
        this._emitFrame();
      } else {
        this._setTarget(next);
      }
    }

    /**
     * Updates one or more peel parameters and returns the normalized values.
     * @param {Partial<{detachGap: number, transition: number, couplingRadius: number, pull: number}>} [parameters]
     * @returns {{detachGap: number, transition: number, couplingRadius: number, pull: number, peelStart: number}}
     */
    setPeelParameters(parameters = {}) {
      const update =
        parameters && typeof parameters === "object"
          ? parameters
          : {};
      this._peelParameters = normalizePeelParameters({
        ...this._peelParameters,
        ...update,
      });

      if (this._connected) {
        this._mode =
          this._gap > this._peelParameters.detachGap
            ? "detached"
            : "merged";
        this._tearAge = -1;
        this._tearStrength = 0;
        this._render();
        this._emitFrame();
      }

      return this.peelParameters;
    }

    /**
     * Restores the default peel parameters.
     */
    resetPeelParameters() {
      return this.setPeelParameters(DEFAULT_PEEL_PARAMETERS);
    }

    /**
     * Advances an in-flight transition without scheduling animation frames.
     * Repeated calls provide deterministic manual playback for capture and
     * testing; calling toggle() or setGap() resumes normal animation.
     *
     * @param {number} [milliseconds]
     * @returns {object} The rendered LiquidPath frame.
     */
    step(milliseconds = 1000 / 60) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
      this._lastTime = 0;
      this.removeAttribute("data-animating");
      const delta = clamp(
        finiteNumber(milliseconds, 1000 / 60) / 1000,
        0,
        0.5,
      );
      this._advance(delta);
      this._render();
      this._emitFrame();
      return this._frame;
    }

    _syncCopy() {
      const provider = this.getAttribute("provider") || "Notion";
      const eyebrow = this.getAttribute("eyebrow") || "MCP Connector";
      const connectLabel =
        this.getAttribute("connect-label") || "Connect";
      const skipLabel = this.getAttribute("skip-label") || "Skip";
      const promptLabel =
        this.getAttribute("prompt-label") || "Prompt";
      const sendLabel =
        this.getAttribute("send-label") || "Send prompt";
      const stageLabel =
        this.getAttribute("stage-label") ||
        "Liquid connector prompt";
      for (const node of this.shadowRoot.querySelectorAll(
        ".provider-name",
      )) {
        node.textContent = provider;
      }
      for (const node of this.shadowRoot.querySelectorAll(".eyebrow")) {
        node.textContent = eyebrow;
      }
      for (const node of this.shadowRoot.querySelectorAll(".connect")) {
        node.textContent = connectLabel;
      }
      for (const node of this.shadowRoot.querySelectorAll(".skip")) {
        node.textContent = skipLabel;
      }
      this._textarea.placeholder =
        this.getAttribute("placeholder") || "Ask anything...";
      this._textarea.setAttribute("aria-label", promptLabel);
      this._send.setAttribute("aria-label", sendLabel);
      this._stage.setAttribute("aria-label", stageLabel);
    }

    _syncInputState() {
      this._send.disabled = !this.value.trim();
    }

    _moveFocusFromOutput() {
      const active = this.shadowRoot.activeElement;
      if (active && this._outputContent.contains(active)) {
        this._textarea.focus({ preventScroll: true });
      }
    }

    _finishImmediately() {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
      this.removeAttribute("data-animating");
      this._gap = this._targetGap;
      this._velocity = 0;
      this._tearAge = -1;
      this._tearStrength = 0;
      this._direction = "idle";
      this._motionKind = "idle";
      this._transitionAge = 0;
      this._peakOpeningTension = 0;
      this._mode = resolveLiquidMode(
        this._mode,
        this._gap,
        0,
        this._peelParameters,
      );
      this._render();
      this._emitFrame();
    }

    _setTarget(value) {
      this._targetGap = targetGap(value, this._targetGap);
      if (this._reducedMotion.matches) {
        this._finishImmediately();
        return;
      }

      this._direction =
        this._targetGap < this._gap ? "closing" : "opening";
      const startsAtHidden =
        Math.abs(this._gap - LIQUID_GEOMETRY.hiddenGap) < 1.5;
      const startsAtRest = Math.abs(this._gap - this._restGap) < 1.5;
      const targetsHidden =
        Math.abs(
          this._targetGap - LIQUID_GEOMETRY.hiddenGap,
        ) < 0.1;
      const targetsRest =
        Math.abs(this._targetGap - this._restGap) < 0.1;
      this._motionKind =
        this._direction === "opening" &&
        startsAtHidden &&
        targetsRest
          ? "opening"
          : this._direction === "closing" &&
              startsAtRest &&
              targetsHidden
            ? "closing"
            : "spring";
      this._transitionAge = 0;
      this._peakOpeningTension = 0;
      if (!this._raf) {
        this._lastTime = performance.now();
        this._raf = requestAnimationFrame(this._tick);
        this.setAttribute("data-animating", "");
      }
    }

    _tick(now) {
      const delta = Math.min(
        0.032,
        Math.max(0.001, (now - this._lastTime) / 1000),
      );
      this._lastTime = now;
      this._advance(delta);
      this._render();
      this._emitFrame();
      if (this._raf) this._raf = requestAnimationFrame(this._tick);
    }

    _advance(delta) {
      this._transitionAge += delta;
      if (
        this._motionKind === "opening" ||
        this._motionKind === "closing"
      ) {
        const sample = sampleMeasuredTransition(
          this._motionKind,
          this._transitionAge,
          LIQUID_GEOMETRY.hiddenGap,
          this._restGap,
        );
        this._gap = sample.gap;
        this._velocity = sample.velocity;
        if (this._tearAge >= 0) this._tearAge += delta;

        if (sample.done) {
          this._gap = this._targetGap;
          this._velocity = 0;
          this._raf = 0;
          this._direction = "idle";
          this._motionKind = "idle";
          this._transitionAge = 0;
          this.removeAttribute("data-animating");
        }
        return;
      }

      const steps = Math.max(1, Math.ceil(delta / (1 / 120)));
      const dt = delta / steps;

      for (let index = 0; index < steps; index += 1) {
        const acceleration =
          LIQUID_MOTION.stiffness * (this._targetGap - this._gap) -
          LIQUID_MOTION.damping * this._velocity;
        this._velocity += acceleration * dt;
        this._gap += this._velocity * dt;
      }
      if (this._tearAge >= 0) this._tearAge += delta;

      if (
        Math.abs(this._targetGap - this._gap) <
          LIQUID_MOTION.settleDistance &&
        Math.abs(this._velocity) < LIQUID_MOTION.settleVelocity
      ) {
        this._gap = this._targetGap;
        this._velocity = 0;
        this._raf = 0;
        this._direction = "idle";
        this._motionKind = "idle";
        this._transitionAge = 0;
        this.removeAttribute("data-animating");
      }
    }

    _render() {
      const previousMode = this._mode;
      if (this._direction === "opening") {
        this._peakOpeningTension = Math.max(
          this._peakOpeningTension,
          openingTension(this._velocity),
        );
      }

      let nextMode;
      if (this._direction === "scrub") {
        nextMode = resolveScrubMode(
          previousMode,
          this._gap,
          this._peelParameters,
        );
      } else {
        nextMode = resolveLiquidMode(
          previousMode,
          this._gap,
          this._velocity,
          this._peelParameters,
        );
      }
      if (
        this._motionKind === "opening" &&
        previousMode === "merged"
      ) {
        const detachTimeOffset =
          (this._peelParameters.detachGap -
            DEFAULT_PEEL_PARAMETERS.detachGap) /
          240;
        const autoDetachTime = clamp(
          LIQUID_MOTION.openTearTime + detachTimeOffset,
          LIQUID_MOTION.openBridgeStart + 0.004,
          0.14,
        );
        nextMode =
          this._transitionAge >= autoDetachTime
            ? "detached"
            : "merged";
      }
      if (previousMode === "merged" && nextMode === "detached") {
        this._tearStrength = Math.max(
          openingTension(this._velocity),
          this._peakOpeningTension,
        );
        this._tearAge = this._tearStrength > 0 ? 0 : -1;
      } else if (
        previousMode === "detached" &&
        nextMode === "merged"
      ) {
        this._tearStrength = 0;
        this._tearAge = -1;
      }
      this._mode = nextMode;

      const frame = createLiquidFrame(this._gap, this._velocity, {
        mode: this._mode,
        scrub: this._direction === "scrub",
        tearAge: this._tearAge,
        tearStrength: this._tearStrength,
        closeAge:
          this._direction === "closing" ? this._transitionAge : -1,
        openAge:
          this._motionKind === "opening" ? this._transitionAge : -1,
        openStrength:
          this._direction === "opening"
            ? this._peakOpeningTension
            : 0,
        peelParameters: this._peelParameters,
        debug: this.hasAttribute("debug"),
      });
      this._frame = frame;

      this._fillPath.setAttribute("d", frame.d);
      for (const path of this._paths) {
        path.setAttribute("d", frame.edgeD);
      }
      const debug = frame.debug;
      this._debugPaths.actual.setAttribute("d", debug?.actualD ?? "");
      this._debugPaths.output.setAttribute("d", debug?.outputD ?? "");
      this._debugPaths.input.setAttribute("d", debug?.inputD ?? "");
      this._debugPaths.contactZone.setAttribute(
        "d",
        debug?.contactZoneD ?? "",
      );
      this._debugPaths.contactBand.setAttribute(
        "d",
        debug?.contactBandD ?? "",
      );
      this._debugPaths.waist.setAttribute("d", debug?.waistD ?? "");
      this._outputObject.setAttribute("y", frame.outputY.toFixed(3));
      this._outputObject.style.setProperty(
        "--output-blur",
        `${frame.outputBlur.toFixed(3)}px`,
      );
      this._inputObject.setAttribute(
        "y",
        frame.inputVisualY.toFixed(3),
      );
      this._inputObject.setAttribute(
        "height",
        frame.inputVisualHeight.toFixed(3),
      );
      this._inputContent.style.height =
        `${frame.inputContentHeight.toFixed(3)}px`;
      this._inputContent.style.transform =
        `translateY(${(frame.inputContentY - frame.inputVisualY).toFixed(3)}px) ` +
        `scaleY(${frame.inputContentScaleY.toFixed(3)})`;
      const mainOpacity =
        frame.outputOpacity * (1 - 0.35 * frame.outputSmear);
      this._outputContent.style.opacity = mainOpacity.toFixed(3);
      this._outputContent.style.transform =
        `scaleY(${frame.outputScaleY.toFixed(3)})`;
      for (const smear of this._outputSmears) {
        smear.style.opacity = (
          frame.outputOpacity *
          0.04 *
          frame.outputSmear
        ).toFixed(3);
        smear.style.transform =
          `translateX(${smear.dataset.offset}px) ` +
          `scaleY(${frame.outputScaleY.toFixed(3)})`;
        smear.style.visibility =
          frame.outputOpacity > 0.08 ? "visible" : "hidden";
      }
      this._send.style.setProperty(
        "--send-height",
        `${frame.sendHeight.toFixed(3)}px`,
      );
      this._send.style.setProperty(
        "--send-offset-y",
        `${frame.sendOffsetY.toFixed(3)}px`,
      );
      this._send.style.setProperty(
        "--send-radius-y",
        `${frame.sendRadiusY.toFixed(3)}px`,
      );
      this._send.style.setProperty(
        "--send-arrow-scale-y",
        frame.sendArrowScaleY.toFixed(4),
      );

      if (frame.outputOpacity < 0.88) this._moveFocusFromOutput();
      const interactive = this.open && frame.outputOpacity > 0.88;
      this._outputObject.style.pointerEvents =
        interactive ? "auto" : "none";
      this._outputObject.setAttribute(
        "aria-hidden",
        this.open && frame.outputOpacity > 0.1 ? "false" : "true",
      );
      this._outputContent.style.visibility =
        frame.outputOpacity > 0.08 ? "visible" : "hidden";
      this._outputContent.inert = !interactive;
      this._connect.disabled = !interactive;
      this._skip.disabled = !interactive;
      this.setAttribute("data-mode", frame.mode);
      this.setAttribute("data-phase", frame.phase);
    }

    _emitFrame() {
      if (
        !this.hasAttribute("emit-frames") &&
        !this.hasAttribute("debug")
      ) {
        return;
      }
      this.dispatchEvent(
        new CustomEvent("liquid-frame", {
          bubbles: true,
          composed: true,
          detail: {
            gap: this._frame?.gap ?? this._gap,
            mode: this._frame?.mode ?? this._mode,
            phase: this._frame?.phase ?? "detached",
            faceGap: this._frame?.faceGap ?? 0,
            notch: this._frame?.notch ?? 0,
            strain: this._frame?.strain ?? 0,
            stretch: this._frame?.stretch ?? 0,
            waistWidth: this._frame?.waistWidth ?? 0,
            velocity: this._velocity,
            open: this.open,
            peelParameters: this._peelParameters,
          },
        }),
      );
    }
  }

  const registeredConnector = customElements.get("liquid-connector");
  if (!registeredConnector) {
    customElements.define("liquid-connector", LiquidConnector);
  }

  global.LiquidConnector =
    registeredConnector ?? LiquidConnector;
})(globalThis);
