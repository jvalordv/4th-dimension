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
 * The slice is rebuilt only when M, c or the shape changed; wire geometry
 * is cached per shape; replaced geometries are disposed.
 */
import { Clock, Color, PerspectiveCamera, Scene, WebGLRenderer, type GridHelper } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Shape4 } from '../math/types';
import { compositeRotation, ROTATION_PLANES } from '../math/rotation';
import { hyperplaneFromRotation } from '../math/hyperplane';
import { symmetricWScale, wColorScale } from '../app/colors';
import type { ViewerState } from '../app/state';
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
    this.scene.add(this.slice.group);

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
   * Place the camera for a shape of radius R. Under the default eye
   * distance d ≥ 2.5 R the projected extent is at most 5/3 R (§3.2), so a
   * camera at 3.6 R with a 42° field of view frames the whole object.
   */
  frameShape(radius: number): void {
    const r = Math.max(radius, 1e-3);
    this.camera.position.set(0.95, 0.6, 1.25).normalize().multiplyScalar(3.6 * r);
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
  setShape(shape: Shape4): void {
    if (shape === this.currentShape) return;
    if (this.wire) this.scene.remove(this.wire.group);
    this.currentShape = shape;
    const wireMesh = shape.wire();
    if (wireMesh) {
      let w = this.wires.get(shape);
      if (!w) {
        w = new WireRenderable(wireMesh);
        this.wires.set(shape, w);
      }
      this.wire = w;
      this.scene.add(w.group);
      this.stats.wireVertices = w.vertexCount;
      this.stats.wireEdges = w.edgeCount;
      this.stats.wireTriangles = w.triangleCount;
    } else {
      this.wire = null;
      this.stats.wireVertices = this.stats.wireEdges = this.stats.wireTriangles = 0;
    }
    this.sliceKey = null;
    this.wireKey = null;
    this.frameShape(shape.radius());
  }

  /** Draw one frame of `state` for `shape`. */
  render(state: Readonly<ViewerState>, shape: Shape4): void {
    this.setShape(shape);
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

function sameKey(a: readonly number[], b: readonly number[] | null): boolean {
  if (!b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
