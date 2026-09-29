// Orientation sets as row-major 3x3 rotation matrices (Z is up).

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// Rotations that bring each of the six axis directions to +Z.
const UP_FACES = [
  IDENTITY, // +Z up
  [1, 0, 0, 0, -1, 0, 0, 0, -1], // -Z up
  [0, 0, -1, 0, 1, 0, 1, 0, 0], // +X up
  [0, 0, 1, 0, 1, 0, -1, 0, 0], // -X up
  [1, 0, 0, 0, 0, -1, 0, 1, 0], // +Y up
  [1, 0, 0, 0, 0, 1, 0, -1, 0], // -Y up
];

export function multiply(A, B) {
  const out = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
    }
  }
  return out;
}

export function rotationZ(deg) {
  const a = (deg * Math.PI) / 180;
  // Snap to exact values so 90° steps stay axis aligned.
  const c = Math.round(Math.cos(a) * 1e12) / 1e12;
  const s = Math.round(Math.sin(a) * 1e12) / 1e12;
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/**
 * @param {'none'|'z'|'all'} mode
 * @param {number} zStep Degrees between rotations about Z.
 */
export function orientationSet(mode, zStep = 90) {
  if (mode === 'none') return [IDENTITY.slice()];
  const step = Math.max(1, Math.min(360, zStep));
  const zRots = [];
  for (let d = 0; d < 360 - 1e-9; d += step) zRots.push(rotationZ(d));
  const ups = mode === 'all' ? UP_FACES : [IDENTITY];
  const out = [];
  for (const up of ups) for (const rz of zRots) out.push(multiply(rz, up));
  return out;
}
