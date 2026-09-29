# 3D Nesting

A browser application that arranges 3D models inside a bounded build volume so that they occupy as little space as possible. Each part is first simplified into a voxel-based shell with a user-defined tolerance; the packing algorithm then works exclusively on these shells.

## Usage

```bash
npm install
npm run dev      # development server at http://localhost:5173
npm run build    # static build in dist/ (relative paths, can be hosted anywhere)
npm test         # unit tests for the core algorithms (Node ≥ 20)
```

1. Load STL, OBJ or 3MF files (drag and drop or file dialog) or add the sample parts. OBJ files are rotated from Y-up to Z-up on import; the ⟲ X / ⟲ Y buttons correct any remaining orientation errors.
2. Set the quantity per model.
3. Define the build volume (boundary): width, depth, height, wall margin and the maximum number of build volumes. Parts that no longer fit are placed in an additional build volume.
4. Choose the shell tolerance (voxel size), the minimum gap between parts, the packing mode and the permitted rotations, then press **Pack**.
5. Inspect the result (parts and/or shells) and export it as one STL per build volume or as a layout JSON containing rotation matrices and translations.

All units are millimetres.

## Method

### Shell generation (`src/core/voxelize.js`)

The model is voxelised in each permitted orientation on a grid whose cell size equals the tolerance. An exact triangle–box separating-axis test determines which voxels intersect the surface. For each vertical column, only the lowest and highest occupied voxel are stored. The resulting shell

- always encloses the real surface (conservative approximation),
- exceeds it by at most one voxel per axis,
- preserves upward-facing openings (e.g. cups, trays), so that other parts can be placed inside them.

The shell is then dilated by half the minimum gap. The dilation is based on the minimum distance between voxels; two non-overlapping shells therefore guarantee at least the specified gap between the real parts.

### Packing (`src/core/pack.js`)

Each build volume is represented as a height map over its XY cells. Parts are processed in descending order of shell volume (or footprint area in bed mode). For every permitted orientation and every XY position, the height at which the part comes to rest when dropped from above is computed column by column (a “gravity drop”).

- **Stack in volume (SLS/MJF):** the position with the lowest resulting top edge is chosen; ties are broken by the smallest Y and X extent. Parts may stack on and inside one another.
- **Single layer on bed (FDM):** every part stands on the build plate, and shell footprints must not overlap. Placement follows the bottom-left rule.

Parts are assigned to the first build volume in which they fit (first fit). Parts that exceed even an empty build volume are listed as not placed.

The computation runs in a Web Worker, so the user interface stays responsive; only the shells actually used are returned for visualisation.

## Known limitations

- The height map stores only the highest occupied point of each column. Space beneath overhangs of parts that have already been placed therefore remains unused; in particular, parts cannot interlock from the side.
- The greedy strategy does not guarantee an optimal arrangement. Global optimisation (e.g. evolutionary methods over the insertion order) is not implemented.
- Rotations are restricted to the six face-down orientations and discrete steps about the Z axis.
- The fill level is computed from the enclosed mesh volume; for open or non-manifold meshes this value is unreliable.
