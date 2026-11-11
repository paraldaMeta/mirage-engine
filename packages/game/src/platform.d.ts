export interface NativeBridge {
  platform: string; os?: string;
  save?: { keys(): Promise<string[]> | string[]; get(key: string): Promise<string | null> | string | null; set(key: string, value: string): Promise<void> | void; remove(key: string): Promise<void> | void };
  window?: { setFullscreen(on: boolean): Promise<unknown> | unknown; isFullscreen?(): Promise<boolean> | boolean };
  orientation?: { lock(type: string): Promise<unknown> | unknown; unlock(): Promise<unknown> | unknown };
  keepAwake?(on: boolean): Promise<unknown> | unknown;
  quit?(): Promise<unknown> | unknown;
}
/** the wrapper's bridge (window.mirageNative) or null in a plain browser */
export function nativeBridge(win?: any): NativeBridge | null;
export interface PlatformResult { ok: boolean; why?: string }

export interface SaveStorage {
  backend: 'native' | 'local' | 'memory'; errors: { key: string; message: string }[];
  getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void; keys(): string[];
  /** writes not yet confirmed by the wrapper */
  readonly pending: number;
  /** resolves when everything is on disk */
  flush(): Promise<void>;
}
/** synchronous storage for createGame / startGame over the wrapper's save folder, else localStorage, else memory */
export function createSaveStorage(options?: { native?: NativeBridge | null; prefix?: string; fallback?: Storage | null; onError?: (error: unknown, key: string) => void }): Promise<SaveStorage>;

export interface Insets { top: number; right: number; bottom: number; left: number }
export function safeAreaInsets(doc?: Document, win?: Window): Insets;
export type InputMode = 'touch' | 'pad' | 'keyboard';
export function inputMode(options?: { nav?: any; win?: any }): { touch: boolean; coarse: boolean; hover: boolean; points: number; pads: number; mode: InputMode };

export interface PlatformEvents {
  pause: { reason: string }; resume: { reason: string }; exit: {}; audio: { state: string }; fullscreen: { active: boolean };
  orientation: { type: string }; insets: Insets; inputmode: InputMode;
}
export interface Platform {
  native: NativeBridge | null;
  /** the wrapper's name ('electron', 'tauri', 'ios', 'android'), 'pwa' when installed, else 'web' */
  kind: string;
  on<K extends keyof PlatformEvents>(type: K, fn: (data: PlatformEvents[K]) => void): () => void;
  readonly hidden: boolean; readonly inputMode: InputMode; readonly audioUnlocked: boolean;
  setAudio(audio: unknown): void;
  wakeLock: { wanted: boolean; readonly held: boolean; request(): Promise<PlatformResult>; release(keep?: boolean): Promise<PlatformResult> };
  fullscreen: { readonly supported: boolean; readonly active: boolean; enter(): Promise<PlatformResult>; exit(): Promise<PlatformResult>; toggle(): Promise<PlatformResult> };
  orientation: { readonly type: string; lock(type?: string): Promise<PlatformResult>; unlock(): Promise<PlatformResult> };
  storage: { persist(): Promise<PlatformResult & { persisted: boolean; usage?: number | null; quota?: number | null }>; estimate(): Promise<{ usage: number | null; quota: number | null } | null> };
  safeArea: { insets(): Insets; measure(): void };
  quit(): Promise<PlatformResult>;
  dispose(): void;
}
export function createPlatform(options?: {
  canvas?: HTMLCanvasElement | null; play?: { wake?(): void } | null; game?: { paused: boolean; pause(on: boolean): void } | null; audio?: unknown;
  saves?: { flush?(): Promise<void> } | null; target?: Element; pauseOnHide?: boolean; resumeOnShow?: boolean; pauseOnBlur?: boolean | (() => void); wakeLock?: boolean;
  native?: NativeBridge | null; win?: any; doc?: any; nav?: any;
}): Platform;

export interface ServiceWorkerHandle {
  ok: boolean; why?: string; registration?: ServiceWorkerRegistration;
  /** activate the waiting version (the page reloads once); false when none waits */
  apply?(): boolean; check?(): Promise<boolean>; version?(): Promise<string | null>; dispose?(): void;
}
/** register the worker written by `mirage-ship --target pwa`; a new version waits until apply() */
export function registerServiceWorker(url?: string, options?: {
  scope?: string; onUpdate?: (info: { version: string | null; apply: () => boolean }) => void; onReady?: (info: { version: string | null; offline: boolean }) => void;
  checkEvery?: number; nav?: any; win?: any;
}): Promise<ServiceWorkerHandle>;
export interface InstallPrompt {
  readonly available: boolean; readonly installed: boolean; ios: boolean;
  on(fn: (state: { available: boolean; installed: boolean }) => void): () => void;
  prompt(): Promise<{ ok: boolean; outcome?: string; why?: string }>;
  dispose(): void;
}
export function createInstallPrompt(options?: { win?: any; nav?: any }): InstallPrompt;
