import type * as THREE from 'three';
import type { WorldRenderer } from '@mirage/core';

export interface XRAROptions {
  /** Ask for 'anchors': the placed world follows its anchor. Default true. */
  anchors?: boolean;
  /** Detected planes: 'shadow' (they receive the model's shadow), 'debug' / true (translucent), false. Default false. */
  planes?: boolean | 'shadow' | 'debug';
  /** Light estimation drives the sun's direction and colour and a light probe. Default false. */
  light?: boolean;
  /** The DOM overlay's root element. */
  domOverlay?: Element | null;
  /** A shadows-only ground under the placed world (createXR adds it). Default false. */
  shadowGround?: boolean;
  /** How much of the world's own image-based light stays under a light estimate (0.15); gains on the estimate. */
  envKeep?: number; lightGain?: number; sunGain?: number;
}
export interface XRARAnchor { anchor: XRAnchor; object: THREE.Group; tracked: boolean; delete(): void }
export interface XRARState {
  anchors: number; tracked: number; planes: number;
  light: { direction: [number, number, number]; intensity: [number, number, number] } | null;
  overlay: string | null; blend: string | null;
}
export interface XRAR {
  group: THREE.Group; anchors: XRARAnchor[]; planes: Map<unknown, { mesh: THREE.Mesh; orientation: string }>;
  light: { valid: boolean; direction: THREE.Vector3; intensity: THREE.Color; probe: THREE.LightProbe };
  options: Required<XRAROptions>;
  /** `init` with this module's optional features (and the DOM overlay) added. */
  sessionInit(init?: XRSessionInit): XRSessionInit;
  start(session: XRSession, rig: THREE.Object3D): void;
  frame(frame: XRFrame, space: XRReferenceSpace, rigYaw?: number): void;
  /** From a hit test result, or { pose, space, frame }. Rejects where the session has no anchors. */
  anchor(from: XRHitTestResult | { pose: XRRigidTransform; space: XRSpace; frame: XRFrame }): Promise<XRARAnchor>;
  end(): void; dispose(): void;
  state(): XRARState;
}
/** A ground that shows only the shadows cast on it (transparent elsewhere). */
export function shadowGround(options?: { size?: number; opacity?: number }): THREE.Mesh;
/** Anchors, plane detection, light estimation and the DOM overlay of an immersive-ar session. */
export function createXRAR(world: WorldRenderer, options?: XRAROptions): XRAR;
