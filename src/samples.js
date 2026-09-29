import * as THREE from 'three';
import { prepareGeometry } from './loaders.js';

// A few differently shaped parts (in mm, Z up) for trying the app without files.
export function sampleParts() {
  const parts = [];
  const add = (name, geometry, quantity, upright = false) => {
    if (upright) geometry.rotateX(Math.PI / 2);
    parts.push({ name, geometry: prepareGeometry(geometry), quantity });
  };

  add('Torus knot', new THREE.TorusKnotGeometry(16, 5, 160, 20), 2);
  add('Ring', new THREE.TorusGeometry(22, 5, 20, 64), 3);
  add('Block', new THREE.BoxGeometry(50, 30, 18), 3);
  add('Cylinder', new THREE.CylinderGeometry(10, 10, 55, 40), 4, true);
  add('Cone', new THREE.ConeGeometry(16, 40, 40), 3, true);

  const l = new THREE.Shape();
  l.moveTo(0, 0);
  l.lineTo(50, 0);
  l.lineTo(50, 10);
  l.lineTo(10, 10);
  l.lineTo(10, 50);
  l.lineTo(0, 50);
  l.closePath();
  add('L bracket', new THREE.ExtrudeGeometry(l, { depth: 20, bevelEnabled: false }), 4);

  // Closed cup profile (outer wall, rim, inner wall, floor) revolved around Y.
  const cup = [
    [0, 0], [26, 0], [30, 45], [27, 45], [23, 4], [0, 4],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  add('Cup', new THREE.LatheGeometry(cup, 64), 2, true);

  return parts;
}
