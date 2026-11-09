/** Internal ownership bookkeeping for Mirage controllers. */
export function createLifetime(): {
  readonly disposed: boolean;
  defer(cleanup: () => void): void;
  listen(target: EventTarget, type: string, listener: EventListener, options?: boolean | AddEventListenerOptions): void;
  dispose(): void;
};
