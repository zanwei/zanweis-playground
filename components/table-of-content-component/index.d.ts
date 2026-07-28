export interface TableOfContentItemInput {
  id?: string;
  title?: string;
  description?: string;
}

export interface TableOfContentItem {
  id: string;
  title: string;
  description: string;
}

export interface TableOfContentSelectOptions {
  open?: boolean;
  emit?: boolean;
}

export interface TableOfContentChangeDetail {
  index: number;
  item: TableOfContentItem;
}

export interface TableOfContentIndexDetail {
  index: number;
}

export interface TableOfContentEventMap {
  "toc-change": CustomEvent<TableOfContentChangeDetail>;
  "toc-open": CustomEvent<TableOfContentIndexDetail>;
  "toc-close": CustomEvent<TableOfContentIndexDetail>;
}

export interface TableOfContentGeometry {
  readonly baseRemPixels: number;
  readonly stageHeight: number;
  readonly trackTop: number;
  readonly trackBottom: number;
  readonly hitTop: number;
  readonly hitHeight: number;
  readonly cardEdgeGap: number;
  readonly tickInfluenceSigma: number;
}

export interface TableOfContentMotion {
  readonly tickSpringStiffness: number;
  readonly tickSpringDamping: number;
  readonly tickSpringMaxStep: number;
}

export interface TableOfContentLimits {
  readonly maxItems: number;
}

export interface TableOfContentSelection {
  readonly center: number;
  readonly floatIndex: number;
  readonly index: number;
}

export interface TableOfContentSpringState {
  value: number;
  velocity: number;
}

export interface TableOfContentModelAPI {
  readonly GEOMETRY: TableOfContentGeometry;
  readonly LIMITS: TableOfContentLimits;
  readonly MOTION: TableOfContentMotion;
  readonly DEFAULT_ITEMS: readonly Readonly<TableOfContentItem>[];
  clamp(value: number, min: number, max: number): number;
  finiteNumber(value: unknown, fallback?: number): number;
  normalizeIndex(value: unknown, count: number, fallback?: number): number;
  normalizeItems(
    value: readonly TableOfContentItemInput[],
  ): TableOfContentItem[];
  selectionFromPointer(
    clientY: number,
    rectTop: number,
    rectHeight: number,
    count: number,
  ): TableOfContentSelection | null;
  stepSpring(
    state: TableOfContentSpringState,
    target: number,
    deltaSeconds: number,
    stiffness: number,
    damping: number,
    maxStep: number,
  ): TableOfContentSpringState;
  tickInfluence(index: number, floatIndex: number | null): number;
  tickY(index: number, count: number): number;
}

export declare class TableOfContent extends HTMLElement {
  static readonly observedAttributes: readonly string[];

  get items(): TableOfContentItem[];
  set items(value: readonly TableOfContentItemInput[]);

  get value(): number;
  set value(index: number);

  get open(): boolean;
  set open(value: boolean);

  get label(): string;
  set label(value: string);

  select(index: number, options?: TableOfContentSelectOptions): void;
  close(): void;

  addEventListener<K extends keyof TableOfContentEventMap>(
    type: K,
    listener: (
      this: TableOfContent,
      event: TableOfContentEventMap[K],
    ) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;

  removeEventListener<K extends keyof TableOfContentEventMap>(
    type: K,
    listener: (
      this: TableOfContent,
      event: TableOfContentEventMap[K],
    ) => unknown,
    options?: boolean | EventListenerOptions,
  ): void;

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void;
}

export declare const TableOfContentModel: TableOfContentModelAPI;

export default TableOfContent;

declare global {
  interface Window {
    TableOfContent: typeof TableOfContent;
    TableOfContentModel: TableOfContentModelAPI;
  }

  interface HTMLElementTagNameMap {
    "table-of-content": TableOfContent;
  }
}
