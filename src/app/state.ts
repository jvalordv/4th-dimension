/**
 * Viewer state and the store that owns it. The state is a plain mutable
 * object (lil-gui binds to its fields directly); the store adds the shape
 * cache, validation (clamping, defaults) and change notifications.
 */
import type { RotationAngles, RotationPlane, Shape4 } from '../math/types';
import type { Projection } from '../math/projection';
import { zeroAngles } from '../math/rotation';
import { getShape, listShapes, type ShapeEntry } from './registry';

export type ViewMode = 'projection' | 'slice' | 'overlay';
export const VIEW_MODES: readonly ViewMode[] = ['projection', 'slice', 'overlay'];

export type ProjectionKind = Projection['kind'];
export const PROJECTION_KINDS: readonly ProjectionKind[] = ['perspective', 'orthographic', 'stereographic'];

export type AnimationPreset = 'none' | 'double-rotation' | 'isoclinic' | 'pass-through' | 'tumble';
export const ANIMATION_PRESETS: readonly AnimationPreset[] = ['none', 'double-rotation', 'isoclinic', 'pass-through', 'tumble'];

export interface AnimationState {
  preset: AnimationPreset;
  /**
   * ω: angular speed in radians per second for the rotation presets, and the
   * rate of the phase `t` that drives the slice-offset presets.
   */
  speed: number;
  playing: boolean;
  /** Accumulated phase t = ∫ speed dt while playing; reset puts it back to 0. */
  phase: number;
}

export interface ViewerState {
  shapeId: string;
  /** The six plane angles composed per MATH.md §2.2. */
  angles: RotationAngles;
  /** R^4 → R^3 projection used by the projection view. MATH.md §3 */
  projection: Projection;
  viewMode: ViewMode;
  /** Offset c of the slicing hyperplane w = c, kept in [−radius, radius]. MATH.md §4 */
  sliceOffset: number;
  animation: AnimationState;
  showFaces: boolean;
  showEdges: boolean;
  showVertices: boolean;
}

/**
 * Default perspective eye distance d for a shape of the given radius R:
 * max(3, 2.5 R). The eye at w = d must lie beyond every point (w < d, MATH.md
 * §3.2); with d ≥ 2.5 R the largest scale factor d / (d − w) is at most
 * 2.5 / 1.5 = 5/3, so no vertex is magnified absurdly. The floor of 3 keeps
 * the tesseract at the textbook d = 3 of §3.2.
 */
export const defaultProjectionDistance = (radius: number): number => Math.max(3, 2.5 * radius);

export function createState(shapeId: string, radius: number, distance = defaultProjectionDistance(radius)): ViewerState {
  return {
    shapeId,
    angles: zeroAngles(),
    projection: { kind: 'perspective', distance },
    viewMode: 'projection',
    sliceOffset: 0,
    animation: { preset: 'double-rotation', speed: 0.6, playing: true, phase: 0 },
    showFaces: true,
    showEdges: true,
    showVertices: true,
  };
}

/** Clamp c into [−radius, radius]. */
export const clampSliceOffset = (c: number, radius: number): number => Math.min(radius, Math.max(-radius, c));

/** Creates each registered shape at most once. */
export class ShapeCache {
  private readonly instances = new Map<string, Shape4>();

  entry(id: string): ShapeEntry {
    const e = getShape(id);
    if (!e) throw new Error(`ShapeCache: unknown shape id '${id}'`);
    return e;
  }

  get(id: string): Shape4 {
    let s = this.instances.get(id);
    if (!s) {
      s = this.entry(id).create();
      this.instances.set(id, s);
    }
    return s;
  }

  has(id: string): boolean {
    return this.instances.has(id);
  }
}

export type StateChange =
  | 'shape'
  | 'angles'
  | 'projection'
  | 'viewMode'
  | 'sliceOffset'
  | 'animation'
  | 'display'
  | 'reset';

export type StateListener = (change: StateChange, state: ViewerState) => void;

/** Picks the initial shape: 'tesseract' when registered, else the first entry. */
export function defaultShapeId(): string {
  const all = listShapes();
  if (all.length === 0) throw new Error('No shapes registered; import src/app/shapes first');
  return getShape('tesseract') ? 'tesseract' : all[0].id;
}

export class StateStore {
  readonly state: ViewerState;
  readonly shapes: ShapeCache;
  private readonly listeners = new Set<StateListener>();
  /** Last perspective distance, kept while another projection kind is active. */
  private perspectiveDist: number;

  constructor(shapeId: string = defaultShapeId(), shapes: ShapeCache = new ShapeCache()) {
    this.shapes = shapes;
    const entry = shapes.entry(shapeId);
    const shape = shapes.get(shapeId);
    this.perspectiveDist = entry.projectionDistance ?? defaultProjectionDistance(shape.radius());
    this.state = createState(shapeId, shape.radius(), this.perspectiveDist);
  }

  get entry(): ShapeEntry { return this.shapes.entry(this.state.shapeId); }
  get shape(): Shape4 { return this.shapes.get(this.state.shapeId); }
  get radius(): number { return this.shape.radius(); }
  get perspectiveDistance(): number { return this.perspectiveDist; }

  subscribe(fn: StateListener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** Announce a change made directly on `state` (e.g. by a bound slider). */
  notify(change: StateChange): void {
    for (const fn of this.listeners) fn(change, this.state);
  }

  /**
   * Switch shape. Angles and view mode are kept; the slice offset is clamped
   * to the new radius and the perspective distance takes the entry's
   * suggestion or the default for the new radius.
   */
  setShape(id: string): void {
    const entry = this.shapes.entry(id);
    const shape = this.shapes.get(id);
    this.state.shapeId = id;
    this.perspectiveDist = entry.projectionDistance ?? defaultProjectionDistance(shape.radius());
    if (this.state.projection.kind === 'perspective') {
      this.state.projection = { kind: 'perspective', distance: this.perspectiveDist };
    }
    this.state.sliceOffset = clampSliceOffset(this.state.sliceOffset, shape.radius());
    this.notify('shape');
  }

  setAngle(plane: RotationPlane, theta: number): void {
    this.state.angles[plane] = theta;
    this.notify('angles');
  }

  setViewMode(mode: ViewMode): void {
    if (this.state.viewMode === mode) return;
    this.state.viewMode = mode;
    this.notify('viewMode');
  }

  setProjectionKind(kind: ProjectionKind): void {
    this.state.projection = kind === 'perspective' ? { kind, distance: this.perspectiveDist } : { kind };
    this.notify('projection');
  }

  /** Set the perspective eye distance (d > 0, MATH.md §3.2); switches to perspective. */
  setPerspectiveDistance(d: number): void {
    if (!(d > 0)) throw new Error('setPerspectiveDistance: distance must be positive');
    this.perspectiveDist = d;
    this.state.projection = { kind: 'perspective', distance: d };
    this.notify('projection');
  }

  setSliceOffset(c: number): void {
    this.state.sliceOffset = clampSliceOffset(c, this.radius);
    this.notify('sliceOffset');
  }

  setPreset(preset: AnimationPreset): void {
    this.state.animation.preset = preset;
    this.notify('animation');
  }

  setSpeed(speed: number): void {
    this.state.animation.speed = Math.max(0, speed);
    this.notify('animation');
  }

  setPlaying(playing: boolean): void {
    this.state.animation.playing = playing;
    this.notify('animation');
  }

  togglePlaying(): void {
    this.setPlaying(!this.state.animation.playing);
  }

  setDisplay(part: 'showFaces' | 'showEdges' | 'showVertices', on: boolean): void {
    this.state[part] = on;
    this.notify('display');
  }

  /** Angles to zero, slice offset to 0, animation phase to 0. */
  reset(): void {
    const z = zeroAngles();
    for (const k of Object.keys(z) as RotationPlane[]) this.state.angles[k] = 0;
    this.state.sliceOffset = 0;
    this.state.animation.phase = 0;
    this.notify('reset');
  }
}
