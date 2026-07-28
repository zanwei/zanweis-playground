export type LiquidMode = "merged" | "detached";
export type LiquidPhase = "contained" | "neck" | "detached";

export interface PeelParameters {
  detachGap?: number;
  transition?: number;
  couplingRadius?: number;
  pull?: number;
}

export interface NormalizedPeelParameters {
  readonly detachGap: number;
  readonly transition: number;
  readonly couplingRadius: number;
  readonly pull: number;
  readonly peelStart: number;
}

export interface LiquidDebugGeometry {
  topology: LiquidMode;
  phase: LiquidPhase;
  actualD: string;
  outputD: string;
  inputD: string;
  contactZoneD: string;
  contactBandD: string;
  waistD: string;
  conceptualGap: number;
  contactKind: "none" | "touch" | "bridge" | "overlap";
  overlap: number;
  separation: number;
  seamY: number | null;
  waistWidth: number;
}

export interface LiquidFrame {
  d: string;
  edgeD: string;
  debug: LiquidDebugGeometry | null;
  mode: LiquidMode;
  phase: LiquidPhase;
  gap: number;
  peelParameters: NormalizedPeelParameters;
  faceGap: number;
  inputBottom: number;
  inputContentHeight: number;
  inputContentScaleY: number;
  inputContentY: number;
  inputFaceRx: number;
  inputFaceRy: number;
  inputHeight: number;
  inputY: number;
  inputVisualHeight: number;
  inputVisualY: number;
  notch: number;
  outputHeight: number;
  outputFaceRx: number;
  outputFaceRy: number;
  outputOpacity: number;
  outputBlur: number;
  outputScaleY: number;
  outputSmear: number;
  outputY: number;
  sendArrowScaleY: number;
  sendHeight: number;
  sendOffsetY: number;
  sendRadiusY: number;
  sendScaleY: number;
  seamY: number | null;
  strain: number;
  stretch: number;
  waistWidth: number;
}

export interface LiquidFrameOptions {
  mode?: LiquidMode;
  peelParameters?: PeelParameters | NormalizedPeelParameters;
  tearAge?: number;
  tearStrength?: number;
  closeAge?: number;
  openAge?: number;
  openStrength?: number;
  scrub?: boolean;
  debug?: boolean;
}

export interface LiquidFrameEventDetail {
  gap: number;
  mode: LiquidMode;
  phase: LiquidPhase;
  faceGap: number;
  notch: number;
  strain: number;
  stretch: number;
  waistWidth: number;
  velocity: number;
  open: boolean;
  peelParameters: NormalizedPeelParameters;
}

export interface LiquidConnectorEventMap {
  connect: CustomEvent<void>;
  skip: CustomEvent<void>;
  submit: CustomEvent<{ value: string }>;
  "liquid-toggle": CustomEvent<{ open: boolean }>;
  "liquid-frame": CustomEvent<LiquidFrameEventDetail>;
}

export interface MeasuredTransition {
  done: boolean;
  gap: number;
  velocity: number;
}

export interface LiquidPathAPI {
  readonly DEFAULT_PEEL_PARAMETERS: Readonly<Required<PeelParameters>>;
  readonly PEEL_PARAMETER_LIMITS: Readonly<
    Record<keyof Required<PeelParameters>, Readonly<{ min: number; max: number }>>
  >;
  readonly LIQUID_GEOMETRY: Readonly<Record<string, number>>;
  readonly LIQUID_MOTION: Readonly<Record<string, number>>;
  readonly LIQUID_TRANSITIONS: Readonly<
    Record<"opening" | "closing", readonly Readonly<{ t: number; gap: number }>[]>
  >;
  clamp(value: number, min: number, max: number): number;
  closeAgeForGap(gap: number): number;
  createLiquidFrame(
    gap: number,
    velocity?: number,
    options?: LiquidFrameOptions,
  ): LiquidFrame;
  easedPeelAge(elapsed: number): number;
  finiteNumber(value: unknown, fallback?: number): number;
  normalizePeelParameters(
    parameters?: PeelParameters,
  ): NormalizedPeelParameters;
  openingContentPull(gap: number, velocity: number): number;
  openingTension(velocity: number): number;
  resolveLiquidMode(
    previousMode: LiquidMode | undefined,
    gap: number,
    velocity?: number,
    peelParameters?: PeelParameters | NormalizedPeelParameters,
  ): LiquidMode;
  resolveScrubMode(
    previousMode: LiquidMode | undefined,
    gap: number,
    peelParameters?: PeelParameters | NormalizedPeelParameters,
  ): LiquidMode;
  sampleClosePose(age: number): Readonly<Record<string, number>>;
  sampleMeasuredTransition(
    kind: "opening" | "closing",
    age: number,
    hiddenGap?: number,
    restGap?: number,
  ): MeasuredTransition;
  samplePeelCorrection(age: number): Readonly<Record<string, number>>;
  smoothstep(edge0: number, edge1: number, value: number): number;
  smootherstep(edge0: number, edge1: number, value: number): number;
}

export declare class LiquidConnector extends HTMLElement {
  static readonly observedAttributes: string[];

  get open(): boolean;
  set open(value: boolean);

  get gap(): number;
  set gap(value: number);

  get peelParameters(): NormalizedPeelParameters;
  set peelParameters(value: PeelParameters);

  get value(): string;
  set value(value: string);

  toggle(force?: boolean): boolean;
  setGap(value: number, options?: { immediate?: boolean }): void;
  setPeelParameters(
    parameters?: PeelParameters,
  ): NormalizedPeelParameters;
  resetPeelParameters(): NormalizedPeelParameters;
  step(milliseconds?: number): LiquidFrame;

  addEventListener<K extends keyof LiquidConnectorEventMap>(
    type: K,
    listener: (
      this: LiquidConnector,
      event: LiquidConnectorEventMap[K],
    ) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof LiquidConnectorEventMap>(
    type: K,
    listener: (
      this: LiquidConnector,
      event: LiquidConnectorEventMap[K],
    ) => unknown,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void;
}

export declare const LiquidPath: LiquidPathAPI;

export default LiquidConnector;

declare global {
  interface Window {
    LiquidConnector: typeof LiquidConnector;
    LiquidPath: LiquidPathAPI;
  }

  interface HTMLElementTagNameMap {
    "liquid-connector": LiquidConnector;
  }
}
