import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function positionsOnly(geometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.getAttribute('position').clone());
  return out;
}

function mergeObject(root) {
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = positionsOnly(o.geometry);
    g.applyMatrix4(o.matrixWorld);
    parts.push(g);
  });
  if (parts.length === 0) throw new Error('File contains no meshes');
  return parts.length === 1 ? parts[0] : mergeGeometries(parts);
}

/**
 * Converts any geometry into a non-indexed, position-only triangle soup with
 * flat normals, centred in X/Y and resting on Z = 0.
 */
export function prepareGeometry(geometry) {
  const g = positionsOnly(geometry);
  g.computeBoundingBox();
  const b = g.boundingBox;
  g.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -b.min.z);
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

export async function loadModelFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const buffer = await file.arrayBuffer();
  let geometry;
  if (ext === 'stl') {
    geometry = new STLLoader().parse(buffer);
  } else if (ext === 'obj') {
    geometry = mergeObject(new OBJLoader().parse(new TextDecoder().decode(buffer)));
    // OBJ files are conventionally Y-up; this app works Z-up.
    geometry.rotateX(Math.PI / 2);
  } else if (ext === '3mf') {
    geometry = mergeObject(new ThreeMFLoader().parse(buffer));
  } else {
    throw new Error(`Unsupported file type: .${ext}`);
  }
  if (!geometry.getAttribute('position') || geometry.getAttribute('position').count < 3) {
    throw new Error('File contains no triangles');
  }
  return prepareGeometry(geometry);
}
