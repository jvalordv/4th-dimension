/**
 * WebXR: in an immersive session the drawn object, the Viewer's `world`
 * group (slice and wire), is placed in front of the user at arm's length and
 * scaled to a fixed size, so that its slice or projection can be walked
 * around. The 4D mathematics is untouched: the geometry in `world` is exactly
 * what the desktop view draws (the projection of MATH.md §3 and the slice of
 * §6); only the group's transform changes, and it is put back when the
 * session ends. MATH.md has no section on this, since no mathematics is
 * involved: it is a rigid motion and a uniform scale of the drawing.
 */
import { BufferGeometry, GridHelper, Group, Line, LineBasicMaterial, Vector3 } from 'three';
import type { Quaternion, Scene, WebGLRenderer } from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';

/** Where the object's centre is put in the XR reference space (metres): 1.3 m up, 1.1 m in front of the origin. */
export const XR_WORLD_POSITION: Readonly<[number, number, number]> = [0, 1.3, -1.1];

/** Radius in metres that a ball enclosing the object is given inside a session (the object is 0.7 m across). */
export const XR_TARGET_RADIUS = 0.35;

/** Colour and length (metres) of the pointer rays drawn from the controllers. */
const RAY_COLOUR = 0x7fb2ff;
const RAY_LENGTH = 0.8;

export interface XRSetup {
  /**
   * The 'enter VR' button, or null when the browser has no WebXR. It is not
   * attached to the page (the host places it) and is hidden unless an
   * immersive VR session is supported.
   */
  button: HTMLElement | null;
  /**
   * Re-apply the scale for the current `getRadius()`; call it when the
   * shape changes during a session. Does nothing outside a session.
   */
  refit(): void;
  /** Remove the listeners and controllers and, if a session is running, end it and restore the world's transform. */
  dispose(): void;
}

/** The world transform to put back when a session ends. */
interface SavedTransform {
  position: Vector3;
  quaternion: Quaternion;
  scale: Vector3;
}

/**
 * Prepare `renderer` for WebXR and return the entry button.
 *
 * Without `navigator.xr` nothing is touched and `button` is null. Otherwise
 * `renderer.xr.enabled` is set, and
 *
 * - on 'sessionstart', `world` is moved to XR_WORLD_POSITION and scaled by
 *   XR_TARGET_RADIUS / getRadius() so that a ball of radius getRadius() (the
 *   shape's radius, Shape4.radius) has radius 0.35 m, the previous position,
 *   orientation and scale are remembered, and the ground grid (which the
 *   viewer sizes for the desktop camera) is hidden;
 * - on 'sessionend' all of that is undone;
 * - both controllers get a ray, drawn in `scene` (not in `world`, so it is
 *   not scaled), and their 'select' (trigger) calls `opts.onSelect`.
 */
export function setupXR(
  renderer: WebGLRenderer,
  scene: Scene,
  world: Group,
  opts: { getRadius: () => number; onSelect?: () => void; onSessionStart?: () => void; onSessionEnd?: () => void },
): XRSetup {
  if (typeof navigator === 'undefined' || !navigator.xr) {
    return { button: null, refit: () => undefined, dispose: () => undefined };
  }

  const wasEnabled = renderer.xr.enabled;
  renderer.xr.enabled = true;

  const button = VRButton.createButton(renderer);
  // VRButton shows a disabled 'VR NOT SUPPORTED' label when no headset is
  // available; the host should show nothing instead. It never sets the
  // `hidden` attribute or the visibility, so these cannot be undone by it.
  const hideUnsupported = (): void => {
    button.hidden = true;
    button.style.visibility = 'hidden';
    button.style.pointerEvents = 'none';
  };
  navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
    if (!supported) hideUnsupported();
  }, hideUnsupported);

  let saved: SavedTransform | null = null;
  let hiddenGrids: GridHelper[] = [];

  const fit = (): void => {
    const radius = opts.getRadius();
    world.scale.setScalar(radius > 0 && Number.isFinite(radius) ? XR_TARGET_RADIUS / radius : 1);
  };

  const onSessionStart = (): void => {
    if (saved) return;
    opts.onSessionStart?.();
    saved = { position: world.position.clone(), quaternion: world.quaternion.clone(), scale: world.scale.clone() };
    world.position.set(...XR_WORLD_POSITION);
    fit();
    hiddenGrids = scene.children.filter((c): c is GridHelper => c instanceof GridHelper && c.visible);
    for (const g of hiddenGrids) g.visible = false;
  };

  const restore = (): void => {
    opts.onSessionEnd?.();
    if (!saved) return;
    world.position.copy(saved.position);
    world.quaternion.copy(saved.quaternion);
    world.scale.copy(saved.scale);
    saved = null;
    for (const g of hiddenGrids) g.visible = true;
    hiddenGrids = [];
  };

  renderer.xr.addEventListener('sessionstart', onSessionStart);
  renderer.xr.addEventListener('sessionend', restore);

  // Controllers: a ray along the pointing direction (−z of the target-ray space).
  const rayGeometry = new BufferGeometry().setFromPoints([new Vector3(0, 0, 0), new Vector3(0, 0, -RAY_LENGTH)]);
  const rayMaterial = new LineBasicMaterial({ color: RAY_COLOUR });
  const onSelect = (): void => opts.onSelect?.();
  const controllers: ReturnType<WebGLRenderer['xr']['getController']>[] = [];
  for (const i of [0, 1]) {
    const controller = renderer.xr.getController(i);
    controller.addEventListener('select', onSelect);
    controller.add(new Line(rayGeometry, rayMaterial));
    scene.add(controller);
    controllers.push(controller);
  }

  let disposed = false;
  return {
    button,
    refit(): void {
      if (saved) fit();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      const session = renderer.xr.getSession();
      restore();
      renderer.xr.removeEventListener('sessionstart', onSessionStart);
      renderer.xr.removeEventListener('sessionend', restore);
      for (const controller of controllers) {
        controller.removeEventListener('select', onSelect);
        scene.remove(controller);
        controller.clear();
      }
      rayGeometry.dispose();
      rayMaterial.dispose();
      button.remove();
      if (session) void session.end().catch(() => undefined);
      renderer.xr.enabled = wasEnabled;
    },
  };
}
