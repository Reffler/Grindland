## 1. Goal

Make Top-view pencil painting through Y peel target one exposed voxel, preserving that voxel’s color when peel closes without recoloring overhang or neighboring voxels.

## 2. Approach

Store peeled-surface paint as sparse per-layer voxel color overrides instead of overwriting Top projection pixel, because one Top pixel represents every Y voxel at same `(x,z)`. Resolve overrides during mesh construction and keep existing projection canvases as fallback, preserving current six-view model and limiting change to one sparse state map.

## 3. File Changes

- **Modify** [editor.js](air-file://nlv9mme2jl8f5gtlkc3v/home/reffler/Projects/Games/Grindland2/model-editor/editor.js?type=file&linesData=%7B%22range%22%3A%7B%22first%22%3A14052%2C%22second%22%3A14490%7D%2C%22lines%22%3A%7B%22first%22%3A336%2C%22second%22%3A346%7D%7D&root=%252F) — add sparse voxel-color state and coordinate helpers.
- **Modify** [editor.js](air-file://nlv9mme2jl8f5gtlkc3v/home/reffler/Projects/Games/Grindland2/model-editor/editor.js?type=file&linesData=%7B%22range%22%3A%7B%22first%22%3A56474%2C%22second%22%3A68210%7D%2C%22lines%22%3A%7B%22first%22%3A1118%2C%22second%22%3A1288%7D%7D&root=%252F) — render exact voxel override colors in body runs and exposed face meshes.
- **Modify** [editor.js](air-file://nlv9mme2jl8f5gtlkc3v/home/reffler/Projects/Games/Grindland2/model-editor/editor.js?type=file&linesData=%7B%22range%22%3A%7B%22first%22%3A183695%2C%22second%22%3A191491%7D%2C%22lines%22%3A%7B%22first%22%3A3388%2C%22second%22%3A3490%7D%7D&root=%252F) — route Top + active Y-peel pencil strokes to exposed voxel coordinate instead of Top projection pixel.
- **Modify** [editor.js](air-file://nlv9mme2jl8f5gtlkc3v/home/reffler/Projects/Games/Grindland2/model-editor/editor.js?type=file&linesData=%7B%22range%22%3A%7B%22first%22%3A196080%2C%22second%22%3A208550%7D%2C%22lines%22%3A%7B%22first%22%3A3577%2C%22second%22%3A3764%7D%7D&root=%252F) — include overrides in straight-stroke restoration, undo/redo snapshots, and project save/load.
- **Modify** [editor.js](air-file://nlv9mme2jl8f5gtlkc3v/home/reffler/Projects/Games/Grindland2/model-editor/editor.js?type=file&linesData=%7B%22range%22%3A%7B%22first%22%3A99494%2C%22second%22%3A104222%7D%2C%22lines%22%3A%7B%22first%22%3A1859%2C%22second%22%3A1937%7D%7D&root=%252F) — copy and remove override state with layer duplication/deletion.
- **Modify** [editor.js](air-file://nlv9mme2jl8f5gtlkc3v/home/reffler/Projects/Games/Grindland2/model-editor/editor.js?type=file&linesData=%7B%22range%22%3A%7B%22first%22%3A110038%2C%22second%22%3A111394%7D%2C%22lines%22%3A%7B%22first%22%3A2047%2C%22second%22%3A2071%7D%7D&root=%252F) — shift override Z coordinates with layer offset changes.
- **Modify** [index.html](air-file://nlv9mme2jl8f5gtlkc3v/home/reffler/Projects/Games/Grindland2/model-editor/index.html?type=file&linesData=%7B%22range%22%3A%7B%22first%22%3A0%2C%22second%22%3A695%7D%2C%22lines%22%3A%7B%22first%22%3A0%2C%22second%22%3A14%7D%7D&root=%252F) — bump editor script cache token.

## 4. Implementation Steps

### Task 1: Add sparse voxel color state

1. Add per-layer `Map` keyed by linearized `(x,y,z)` coordinate in [editor.js](air-file://nlv9mme2jl8f5gtlkc3v/home/reffler/Projects/Games/Grindland2/model-editor/editor.js?type=file&linesData=%7B%22range%22%3A%7B%22first%22%3A14052%2C%22second%22%3A14490%7D%2C%22lines%22%3A%7B%22first%22%3A336%2C%22second%22%3A346%7D%7D&root=%252F); store only explicit peeled-surface colors.
2. Add helper resolving first occupied voxel at or below current Y cut for Top-view `(x,z)`, using existing six-view occupancy test and active layer depth range.
3. Prune overrides whose layer/coordinate no longer contains occupied voxel, preventing erased geometry from reviving stale color later.

### Task 2: Paint exact peeled voxel

1. In [editor.js](air-file://nlv9mme2jl8f5gtlkc3v/home/reffler/Projects/Games/Grindland2/model-editor/editor.js?type=file&linesData=%7B%22range%22%3A%7B%22first%22%3A183695%2C%22second%22%3A191491%7D%2C%22lines%22%3A%7B%22first%22%3A3388%2C%22second%22%3A3490%7D%7D&root=%252F), detect pencil paint when active orientation is Top and Y peel depth is greater than zero.
2. Convert painted Top pixel to `(x,z)`, scan from cut plane toward model bottom, and write selected color only to first occupied `(x,y,z)`.
3. Skip Top projection canvas mutation for this path, so closing peel does not transfer new color to restored overhang.
4. Preserve current behavior for unpeeled Top painting, other orientations, new-pixel projection expansion, eraser, bucket, selection, and symmetry.

### Task 3: Render retained voxel color

1. Update body-run construction in [editor.js](air-file://nlv9mme2jl8f5gtlkc3v/home/reffler/Projects/Games/Grindland2/model-editor/editor.js?type=file&linesData=%7B%22range%22%3A%7B%22first%22%3A56474%2C%22second%22%3A68210%7D%2C%22lines%22%3A%7B%22first%22%3A1118%2C%22second%22%3A1288%7D%7D&root=%252F) to split contiguous Z runs only when occupancy or resolved color changes; projection color remains fallback, voxel override wins.
2. Resolve exposed face color from exact face voxel coordinate before falling back to orientation texture color. Peeled lower voxel displays override; restored overhang keeps original projection color.
3. Keep preview synchronization unchanged; updated instance matrices/colors flow through existing mesh copy.

### Task 4: Preserve state through editor lifecycle

1. Add override copies to straight-stroke baseline plus history `snapshot`/`restore` in [editor.js](air-file://nlv9mme2jl8f5gtlkc3v/home/reffler/Projects/Games/Grindland2/model-editor/editor.js?type=file&linesData=%7B%22range%22%3A%7B%22first%22%3A196080%2C%22second%22%3A208550%7D%2C%22lines%22%3A%7B%22first%22%3A3577%2C%22second%22%3A3764%7D%7D&root=%252F).
2. Serialize sparse entries as optional project data and restore validated entries on load; existing version 1/2 projects remain valid when field is absent.
3. Copy active layer entries during duplication and delete entries during layer removal in [editor.js](air-file://nlv9mme2jl8f5gtlkc3v/home/reffler/Projects/Games/Grindland2/model-editor/editor.js?type=file&linesData=%7B%22range%22%3A%7B%22first%22%3A99494%2C%22second%22%3A104222%7D%2C%22lines%22%3A%7B%22first%22%3A1859%2C%22second%22%3A1937%7D%7D&root=%252F).
4. Shift stored Z coordinates by same delta as edited perspective views when layer offset changes in [editor.js](air-file://nlv9mme2jl8f5gtlkc3v/home/reffler/Projects/Games/Grindland2/model-editor/editor.js?type=file&linesData=%7B%22range%22%3A%7B%22first%22%3A110038%2C%22second%22%3A111394%7D%2C%22lines%22%3A%7B%22first%22%3A2047%2C%22second%22%3A2071%7D%7D&root=%252F).
5. Update [index.html](air-file://nlv9mme2jl8f5gtlkc3v/home/reffler/Projects/Games/Grindland2/model-editor/index.html?type=file&linesData=%7B%22range%22%3A%7B%22first%22%3A0%2C%22second%22%3A695%7D%2C%22lines%22%3A%7B%22first%22%3A0%2C%22second%22%3A14%7D%7D&root=%252F) cache token after script change.

## 5. Acceptance Criteria

- With Y peel exposing voxel beneath overhang, 1px Top-view pencil stroke changes exactly clicked occupied voxel.
- Adjacent X/Z voxels and other Y voxels sharing same Top projection pixel keep prior colors.
- Returning Y peel to zero restores overhang with original color while painted lower voxel retains new color on any still-visible face.
- Reapplying same Y peel reveals same painted voxel with same color.
- Undo removes peeled voxel edit; redo restores it.
- Save/load project preserves peeled voxel edit; projects without voxel-color field still load.
- Layer duplication copies voxel edit; deleting layer leaves no orphaned edit.
- Unpeeled painting and non-Top orientations behave unchanged.
- Browser loads updated script instead of cached pre-fix script.

## 6. Verification Steps

1. Run `node --check editor.js`.
2. In existing editor session, build/import overhang fixture, switch Top, set Y peel until lower surface appears, paint one voxel distinct color.
3. Inspect neighboring cells with preview grid enabled; confirm one voxel changed.
4. Set Y peel to zero, rotate preview to expose underside/side, confirm overhang original and lower voxel retained.
5. Move Y peel out/in; confirm color remains bound to same coordinate.
6. Undo/redo once; confirm override disappears/reappears.
7. Save project, reload it, repeat peel check.
8. Duplicate then delete edited layer; confirm duplicate retains color and deletion leaves no visual residue.

## 7. Risks & Mitigations

- **Mesh instance growth:** one override can split a Z run into up to three segments. Merge adjacent equal-color voxels during run construction; keep override storage sparse.
- **Stale colors after geometry edits:** prune entries against current six-view occupancy before rendering.
- **Old project compatibility:** use optional additive field under current format; absent field initializes empty state.
- **Browser cache:** bump editor script query token in HTML.