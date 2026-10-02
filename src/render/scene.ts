/**
 * Scene dressing: background, lights and the ground grid. The lights are
 * for the slice mesh (MeshStandardMaterial); the wire uses unlit materials.
 */
import { DirectionalLight, GridHelper, HemisphereLight, LineBasicMaterial, type Object3D } from 'three';

export const BACKGROUND = 0x0b0e14;

/** Two directional lights (key and cool fill) plus a hemisphere light. */
export function createLights(): Object3D[] {
  const key = new DirectionalLight(0xffffff, 2.4);
  key.position.set(3, 5, 4);
  const fill = new DirectionalLight(0x9fb4ff, 0.9);
  fill.position.set(-4, 2, -3);
  const hemi = new HemisphereLight(0x6f86b8, 0x151a24, 0.8);
  return [key, fill, hemi];
}

/**
 * Subtle ground grid of unit half-size (scaled by the viewer to the shape
 * radius) with a transparent material.
 */
export function createGrid(): GridHelper {
  const grid = new GridHelper(8, 16, 0x344158, 0x1c2330);
  const mat = grid.material as LineBasicMaterial;
  mat.transparent = true;
  mat.opacity = 0.55;
  mat.depthWrite = false;
  return grid;
}
