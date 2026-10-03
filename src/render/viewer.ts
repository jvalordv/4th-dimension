/**
 * Three.js viewer. Each frame computes M = compositeRotation(angles)
 * (MATH.md §2.2) and draws, by view mode:
 *
 * - projection: the wire with p' = M p, coloured by p'_w over [−R, R] and
 *   positioned by project(p') (§3, §10);
 * - slice: shape.slice(hyperplaneFromRotation(M, c)), the slice of the
 *   rotated shape by w = c in its own x, y, z (§4, §6), coloured by source w
 *   over the shape's w range (§10);
 * - overlay: both, the slice scaled by d / (d − c) under perspective and 1
 *   under orthographic (§3.2) with the wire drawn as a faint ghost.
 *
 * The slice is rebuilt only when M, c or the shape changed, and is cleared
 * the moment the shape changes; wire geometry is cached per shape; replaced
 * geometries are disposed.
 *
 * The slice group and the wire group live in `world`, a Group of the scene
 * that holds everything belonging to the 4D object (grid and lights stay in
 * the scene). Transforming `world` moves and scales the whole drawing as one
 * body; src/render/xr.ts uses it to put the object at arm's length inside a
 * WebXR session (MATH.md §12).
 */
import { Clock, Color, Group, PerspectiveCamera, Scene, WebGLRenderer, type GridHelper } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Shape4 } from '../math/types';
import { compositeRotation, ROTATION_PLANES } from '../math/rotation';
import { hyperplaneFromRotation } from '../math/hyperplane';
import { symmetricWScale, wColorScale } from '../app/colors';
import type { ViewerState } from '../app/state';
import type { Projection } from '../math/projection';
import { BACKGROUND, createGrid, createLights } from './scene';
import { SliceRenderable, sliceScale } from './slice-mesh';
import { WIRE_OPACITY_FULL, WIRE_OPACITY_GHOST, WireRenderable } from './wire';

export interface ViewerStats {
  wireVertices: number;
  wireEdges: number;
  wireTriangles: number;
  sliceTriangles: number;
  /** Milliseconds spent in shape.slice + geometry build for the last rebuild. */
  sliceBuildMs: number;
  /** Number of slice rebuilds so far. */
  sliceBuilds: number;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Slice rebuild cost (ms) above which rebuilds are spaced out while animating. */
const SLICE_PACE_MS = 12;

export class Viewer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  /** Parent of the slice and wire groups; see the module comment. */
  readonly world = new Group();
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly stats: ViewerStats = {
    wireVertices: 0, wireEdges: 0, wireTriangles: 0, sliceTriangles: 0, sliceBuildMs: 0, sliceBuilds: 0,
  };

  private readonly container: HTMLElement;
  private readonly grid: GridHelper;
  private readonly wires = new Map<Shape4, WireRenderable>();
  private wire: WireRenderable | null = null;
  private readonly slice = new SliceRenderable();
  private currentShape: Shape4 | null = null;
  /** Angles (6), offset and projection parameters of the last slice / wire build. */
  private sliceKey: number[] | null = null;
  private wireKey: number[] | null = null;
  private framesSinceSlice = 0;
  private readonly clock = new Clock();
  private readonly resizeObserver: ResizeObserver | null = null;
  private readonly onWindowResize = (): void => this.resize();

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(BACKGROUND, 1);
    container.appendChild(this.renderer.domElement);

    this.scene.background = new Color(BACKGROUND);
    for (const light of createLights()) this.scene.add(light);
    this.grid = createGrid();
    this.scene.add(this.grid);
    this.scene.add(this.world);
    this.world.add(this.slice.group);

    const { width, height } = this.size();
    this.camera = new PerspectiveCamera(42, width / Math.max(height, 1), 0.01, 1000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.frameShape(2);
    this.resize();

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
    }
    window.addEventListener('resize', this.onWindowResize);
  }

  private size(): { width: number; height: number } {
    const r = this.container.getBoundingClientRect();
    return { width: Math.max(1, Math.floor(r.width)), height: Math.max(1, Math.floor(r.height)) };
  }

  resize(): void {
    const { width, height } = this.size();
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Place the camera for a shape of radius R so that its projected extent
   * fills about 62 % of the view's half-height. Under perspective from eye
   * distance d a point at |p| = R with fourth coordinate w lands at distance
   * √(R² − w²) · d/(d − w) (§3.2); the bound is the maximum over w ∈ [−R, R].
   * Orthographic extent is R; stereographic images are unbounded near the
   * pole, so 2.5 R is used as a working frame.
   */
  frameShape(radius: number, projection?: Projection): void {
    const r = Math.max(radius, 1e-3);
    const extent = projectedExtent(r, projection);
    const fill = 0.62;
    const dist = extent / (fill * Math.tan((this.camera.fov * Math.PI) / 360));
    this.camera.position.set(0.95, 0.6, 1.25).normalize().multiplyScalar(dist);
    this.camera.near = 0.01 * r;
    this.camera.far = 200 * r;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = 0.4 * r;
    this.controls.maxDistance = 30 * r;
    this.controls.update();
    this.grid.scale.setScalar(r);
    this.grid.position.y = -1.6 * r;
  }

  /** Select the shape to draw: fetch or build its cached wire and reframe the camera. */
  setShape(shape: Shape4, projection?: Projection): void {
    if (shape === this.currentShape) return;
    if (this.wire) this.world.remove(this.wire.group);
    this.currentShape = shape;
    const wireMesh = shape.wire();
    if (wireMesh) {
      let w = this.wires.get(shape);
      if (!w) {
        w = new WireRenderable(wireMesh);
        this.wires.set(shape, w);
      }
      this.wire = w;
      this.world.add(w.group);
      this.stats.wireVertices = w.vertexCount;
      this.stats.wireEdges = w.edgeCount;
      this.stats.wireTriangles = w.triangleCount;
    } else {
      this.wire = null;
      this.stats.wireVertices = this.stats.wireEdges = this.stats.wireTriangles = 0;
    }
    this.sliceKey = null;
    this.wireKey = null;
    // Drop the previous shape's slice now rather than at its next rebuild:
    // the pacing gate in render() spaces rebuilds by the last measured build
    // cost, so with a slow previous shape its mesh could otherwise stay on
    // screen, scaled by the new shape's offset, for a few frames. Resetting
    // the cost makes gap = 1 until the new shape's first rebuild is timed.
    this.slice.clear();
    this.stats.sliceTriangles = 0;
    this.stats.sliceBuildMs = 0;
    this.framesSinceSlice = 0;
    this.frameShape(shape.radius(), projection);
  }

  /** Draw one frame of `state` for `shape`. */
  render(state: Readonly<ViewerState>, shape: Shape4): void {
    this.setShape(shape, state.projection);
    const showWire = state.viewMode !== 'slice';
    const showSlice = state.viewMode !== 'projection';
    const angleKey = ROTATION_PLANES.map((p) => state.angles[p]);
    let m: number[] | null = null;

    if (this.wire) {
      this.wire.group.visible = showWire;
      if (showWire) {
        const proj = state.projection;
        const key = [...angleKey, proj.kind === 'perspective' ? proj.distance : 0, kindCode(proj.kind)];
        if (!sameKey(key, this.wireKey)) {
          m = compositeRotation(state.angles);
          this.wire.update(m, proj, symmetricWScale(shape.radius()));
          this.wireKey = key;
        }
        this.wire.setOpacity(state.viewMode === 'overlay' ? WIRE_OPACITY_GHOST : WIRE_OPACITY_FULL);
        this.wire.setVisible(state.showFaces, state.showEdges, state.showVertices);
      }
    }

    this.slice.group.visible = showSlice;
    if (showSlice) {
      const key = [...angleKey, state.sliceOffset];
      this.framesSinceSlice++;
      // A slow shape (slice + geometry well above a frame) is rebuilt every
      // few frames while it keeps changing, so orbiting stays smooth; the
      // final state is always drawn because the key stays stale until then.
      const gap = this.stats.sliceBuildMs > SLICE_PACE_MS ? Math.ceil(this.stats.sliceBuildMs / SLICE_PACE_MS) : 1;
      if (!sameKey(key, this.sliceKey) && this.framesSinceSlice >= gap) {
        const t0 = now();
        m ??= compositeRotation(state.angles);
        const tri = shape.slice(hyperplaneFromRotation(m, state.sliceOffset));
        this.slice.setMesh(tri, wColorScale(shape.wRange()));
        this.sliceKey = key;
        this.framesSinceSlice = 0;
        this.stats.sliceTriangles = this.slice.triangleCount;
        this.stats.sliceBuildMs = now() - t0;
        this.stats.sliceBuilds++;
      }
      const s = state.viewMode === 'overlay' ? sliceScale(state.projection, state.sliceOffset) : 1;
      this.slice.group.scale.setScalar(s);
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Run `frame(dt)` every animation frame with dt in seconds, capped at 0.1 s
   * so a background tab does not jump when it resumes.
   */
  start(frame: (dt: number) => void): void {
    this.clock.start();
    this.renderer.setAnimationLoop(() => frame(Math.min(this.clock.getDelta(), 0.1)));
  }

  stop(): void {
    this.renderer.setAnimationLoop(null);
  }

  dispose(): void {
    this.stop();
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.onWindowResize);
    this.controls.dispose();
    for (const w of this.wires.values()) w.dispose();
    this.wires.clear();
    this.slice.dispose();
    this.grid.geometry.dispose();
    (this.grid.material as { dispose(): void }).dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

const kindCode = (kind: ViewerState['projection']['kind']): number =>
  kind === 'perspective' ? 0 : kind === 'orthographic' ? 1 : 2;

/** Bound on the 3D extent of the projected image of a ball of radius r. §3 */
export function projectedExtent(r: number, projection?: Projection): number {
  if (!projection || projection.kind === 'orthographic') return r;
  if (projection.kind === 'stereographic') return 2.5 * r;
  const d = projection.distance;
  let best = r;
  for (let i = 0; i <= 64; i++) {
    const w = -r + (2 * r * i) / 64;
    const denom = Math.max(d - w, 1e-3);
    best = Math.max(best, (Math.sqrt(Math.max(r * r - w * w, 0)) * d) / denom);
  }
  return best;
}

function sameKey(a: readonly number[], b: readonly number[] | null): boolean {
  if (!b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
