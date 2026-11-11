/** a constant, or a per-particle random range */
export type VfxRange = number | [number, number];
/** a constant, or a curve over normalised life: [[t, value], ...] with t in 0..1 */
export type VfxCurve = number | [number, number][];
export type VfxColor = string | [number, number, number];
/** one colour, or a gradient over normalised life: [[t, colour], ...] (sRGB) */
export type VfxGradient = VfxColor | [number, VfxColor][];
export type VfxVec3 = [number, number, number];

export interface VfxEmitter {
  name?: string; capacity?: number; rate?: number; bursts?: { time?: number; count?: number; every?: number }[];
  duration?: number; loop?: boolean; delay?: number; life?: VfxRange; seed?: number;
  shape?: { type?: 'point' | 'sphere' | 'box' | 'cone' | 'ring' | 'edge' | 'mesh'; radius?: number; shell?: number; hemisphere?: boolean; size?: VfxVec3;
    angle?: number; length?: number; a?: VfxVec3; b?: VfxVec3; mesh?: string | null; offset?: VfxVec3 };
  velocity?: { dir?: VfxVec3; speed?: VfxRange; spread?: number; normal?: VfxRange; random?: VfxRange; inherit?: number };
  /** m/s²: a number acts on Y (negative falls) */
  gravity?: number | VfxVec3; drag?: number; wind?: number;
  turbulence?: { strength?: number; scale?: number; speed?: number };
  attractors?: { position?: VfxVec3; strength?: number; radius?: number; spin?: number }[];
  field?: { name: string; strength?: number; min?: VfxVec3; size?: VfxVec3 } | null;
  size?: VfxRange; sizeOverLife?: VfxCurve; color?: VfxGradient; alpha?: VfxCurve; emissive?: VfxCurve;
  rotation?: VfxRange; spin?: VfxRange; spinOverLife?: VfxCurve;
  render?: { type?: 'billboard' | 'stretched' | 'horizontal' | 'mesh'; blend?: 'alpha' | 'add' | 'premultiplied'; lit?: number; soft?: number;
    sprite?: 'soft' | 'disc' | 'ring' | 'spark' | 'star' | 'leaf' | 'flake' | 'drop'; sort?: 'none' | 'oldest' | 'youngest' | 'distance'; stretch?: number;
    mesh?: string; additive?: number; order?: number; nearFade?: number;
    flipbook?: { sheet?: string; cols?: number; rows?: number; fps?: number; blend?: boolean } | null };
  collision?: { mode?: 'bounce' | 'kill' | 'stick'; depth?: boolean; ground?: boolean; planes?: [number, number, number, number][]; bounce?: number;
    friction?: number; radius?: number; lifeLoss?: number; thickness?: number } | null;
  sub?: { on?: 'birth' | 'death' | 'collision' | 'life'; count?: number; rate?: number; inherit?: number; emitter: VfxEmitter }[];
  trail?: { segments?: number; every?: number; width?: number; taper?: number } | null;
  lod?: { near?: number; far?: number; min?: number; cull?: number; minPixels?: number };
  bounds?: number; pauseOffscreen?: boolean;
}
/** an effect description: one emitter, or several layers that spawn together */
export type VfxEffect = VfxEmitter | { name?: string; emitters: VfxEmitter[] };
/** what defineEffect returns: every field present (the shapes above with nothing optional), JSON-safe */
export interface VfxDefinedEffect { name: string; emitters: (Required<VfxEmitter> & { gravity: VfxVec3; life: [number, number]; size: [number, number] })[] }

export const VFX_LUT_W: number;
export const VFX_ENUMS: { SHAPES: string[]; BLENDS: string[]; TYPES: string[]; SPRITES: string[]; SORTS: string[]; EVENTS: string[]; MODES: string[] };
/** validate and default a description; throws a TypeError naming the path of a wrong or unknown key */
export function defineEffect(desc: VfxEffect | VfxDefinedEffect): VfxDefinedEffect;
export function evalCurve(curve: [number, number][], t: number): number;
export function bakeCurves(emitter: VfxDefinedEffect['emitters'][number]): Float32Array;
export function effectRadius(emitter: VfxDefinedEffect['emitters'][number]): number;
export function parseColor(color: VfxColor, path?: string): VfxVec3;
