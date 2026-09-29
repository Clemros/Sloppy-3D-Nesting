import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { shellSurface } from './core/shellMesh.js';

export function binOffset(index, settings) {
  return index * (settings.width + Math.max(20, settings.width * 0.15));
}

export function placementMatrix(p, xOffset = 0) {
  const R = p.rotation, T = p.translation;
  return new THREE.Matrix4().set(
    R[0], R[1], R[2], T[0] + xOffset,
    R[3], R[4], R[5], T[1],
    R[6], R[7], R[8], T[2],
    0, 0, 0, 1,
  );
}

function disposeGroup(group) {
  for (const child of [...group.children]) {
    child.traverse((o) => {
      if (o.isLineSegments || o.userData.ownsGeometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    group.remove(child);
  }
}

export class Viewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 1, 20000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(300, -400, 300);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(0.5, -0.8, 1.2);
    this.scene.add(sun);

    this.bins = new THREE.Group();
    this.parts = new THREE.Group();
    this.shells = new THREE.Group();
    this.shells.visible = false;
    this.scene.add(this.bins, this.parts, this.shells);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setBuildVolumes(settings, count) {
    disposeGroup(this.bins);
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const lineColor = dark ? 0x8a94a3 : 0x5f6b7a;
    const { width: W, depth: D, height: H } = settings;
    const m = Math.max(0, settings.margin);
    const n = Math.max(1, count);
    for (let b = 0; b < n; b++) {
      const group = new THREE.Group();
      group.position.x = binOffset(b, settings);

      const outer = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(W, D, H)),
        new THREE.LineBasicMaterial({ color: lineColor }),
      );
      outer.position.set(W / 2, D / 2, H / 2);
      group.add(outer);

      const innerH = settings.mode === 'bed' ? H : H - 2 * m;
      if (m > 0 && W > 2 * m && D > 2 * m && innerH > 0) {
        const inner = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(W - 2 * m, D - 2 * m, innerH)),
          new THREE.LineBasicMaterial({ color: lineColor, transparent: true, opacity: 0.35 }),
        );
        inner.position.set(W / 2, D / 2, (settings.mode === 'bed' ? 0 : m) + innerH / 2);
        group.add(inner);
      }

      const bed = new THREE.Mesh(
        new THREE.PlaneGeometry(W, D),
        new THREE.MeshBasicMaterial({ color: lineColor, transparent: true, opacity: 0.12, side: THREE.DoubleSide }),
      );
      bed.userData.ownsGeometry = true;
      bed.position.set(W / 2, D / 2, 0);
      group.add(bed);
      this.bins.add(group);
    }
  }

  /**
   * @param {object} result Output of the packing worker.
   * @param {Map} models Model id -> { geometry, color }.
   * @param {object} settings
   */
  showResult(result, models, settings) {
    disposeGroup(this.parts);
    disposeGroup(this.shells);
    this.setBuildVolumes(settings, result.bins.length);

    const v = settings.voxel;
    const shellGeometries = new Map();

    for (const p of result.placements) {
      const model = models.get(p.modelId);
      if (!model) continue;
      const xOffset = binOffset(p.bin, settings);

      const mesh = new THREE.Mesh(
        model.geometry,
        new THREE.MeshStandardMaterial({ color: model.color, roughness: 0.6, metalness: 0.05 }),
      );
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(placementMatrix(p, xOffset));
      this.parts.add(mesh);

      const key = `${p.modelId}:${p.orientation}`;
      const s = result.shells[key];
      if (!s) continue;
      let geometry = shellGeometries.get(key);
      const first = !geometry;
      if (first) {
        geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(shellSurface(s, v), 3));
        geometry.computeVertexNormals();
        shellGeometries.set(key, geometry);
      }
      const shell = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color: model.color,
          transparent: true,
          opacity: 0.45,
          depthWrite: false,
          roughness: 0.9,
        }),
      );
      shell.userData.ownsGeometry = first;
      shell.position.set(p.shellOffset[0] + xOffset, p.shellOffset[1], p.shellOffset[2]);
      this.shells.add(shell);
    }
    this.fit(settings, result.bins.length);
  }

  clearResult(settings) {
    disposeGroup(this.parts);
    disposeGroup(this.shells);
    this.setBuildVolumes(settings, 1);
  }

  setPartsVisible(v) { this.parts.visible = v; }
  setShellsVisible(v) { this.shells.visible = v; }

  fit(settings, count = 1) {
    const n = Math.max(1, count);
    const totalW = binOffset(n - 1, settings) + settings.width;
    const center = new THREE.Vector3(totalW / 2, settings.depth / 2, settings.height / 3);
    const radius = Math.hypot(totalW, settings.depth, settings.height) / 2;
    const dist = radius / Math.sin((this.camera.fov * Math.PI) / 360) * 0.9;
    const dir = new THREE.Vector3(0.35, -1, 0.75).normalize();
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.controls.target.copy(center);
    this.controls.update();
  }
}
