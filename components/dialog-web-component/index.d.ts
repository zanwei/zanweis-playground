export interface DeleteDialogItemDetail {
  itemName: string;
}

export interface DeleteDialogCloseDetail {
  reason: string;
}

export interface DeleteDialogErrorDetail extends DeleteDialogItemDetail {
  message: string;
}

export interface DeleteConfirmDialogEventMap {
  cancel: CustomEvent<null>;
  "dialog-open": CustomEvent<null>;
  "dialog-close": CustomEvent<DeleteDialogCloseDetail>;
  "dialog-reset": CustomEvent<null>;
  "delete-request": CustomEvent<DeleteDialogItemDetail>;
  "delete-success": CustomEvent<DeleteDialogItemDetail>;
  "delete-error": CustomEvent<DeleteDialogErrorDetail>;
}

export declare class DeleteConfirmDialog extends HTMLElement {
  static readonly observedAttributes: string[];

  get open(): boolean;
  set open(value: boolean);
  get isOpen(): boolean;

  showModal(invoker?: HTMLElement | null): void;
  close(reason?: string): void;
  reset(invoker?: HTMLElement | null): void;
  complete(): boolean;
  fail(message?: string): boolean;

  addEventListener<K extends keyof DeleteConfirmDialogEventMap>(
    type: K,
    listener: (
      this: DeleteConfirmDialog,
      event: DeleteConfirmDialogEventMap[K],
    ) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
}

export default DeleteConfirmDialog;

declare global {
  interface HTMLElementTagNameMap {
    "delete-confirm-dialog": DeleteConfirmDialog;
  }
}
