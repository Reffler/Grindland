import * as THREE from "three";
import { MAT } from "./materials.js";
import { AIR, SAPLING, LOG, AXIS_Y } from "../constants.js";
import { BLOCKS, blockMaterial } from "../registries.js";
import { excludeCutoutFromNormalPass, scene } from "./setup.js";

const AO_TABLE = [1.0, 0.86, 0.73, 0.6];
function faceTint(nx, ny, nz) {
    if (ny > 0) return 1.0;
    if (ny < 0) return 0.82;
    return 0.92;
}

export class World {
    constructor() {
        this.blocks = new Map(); // Stores: number (id) or {id, axis} for logs
        this.group = null;
    }
    k(x, y, z) {
        return x + "," + y + "," + z;
    }
    // Get block ID (extracts id from metadata if present)
    get(x, y, z) {
        const data = this.blocks.get(this.k(x, y, z));
        if (data === undefined) return AIR;
        if (typeof data === "object") return data.id;
        return data;
    }
    // Get full block data including metadata
    getData(x, y, z) {
        const data = this.blocks.get(this.k(x, y, z));
        if (data === undefined) return { id: AIR, axis: AXIS_Y };
        if (typeof data === "object") return data;
        return { id: data, axis: AXIS_Y };
    }
    isSolid(x, y, z) {
        const id = this.get(x, y, z);
        return BLOCKS[id]?.solid ?? false;
    }
    // Set block by ID only (default axis for logs)
    set(x, y, z, id) {
        this.setWithData(x, y, z, { id, axis: AXIS_Y });
    }
    // Set block with full metadata
    setWithData(x, y, z, data) {
        const k = this.k(x, y, z);
        if (data.id === AIR) this.blocks.delete(k);
        else this.blocks.set(k, data);
        this.rebuild();
    }
    // Add block without triggering rebuild (for world gen)
    add(x, y, z, id) {
        this.blocks.set(this.k(x, y, z), id);
    }
    // Add block with metadata without triggering rebuild
    addWithData(x, y, z, data) {
        this.blocks.set(this.k(x, y, z), data);
    }

    serialize() {
        return Array.from(this.blocks.entries());
    }

    load(entries) {
        this.blocks = new Map(entries);
        this.rebuild();
    }

    rebuild(ghosts = null) {
        if (this.group) {
            for (const m of this.group.children) {
                m.geometry.dispose();
            }
            scene.remove(this.group);
        }
        this.group = new THREE.Group();

        const buckets = Object.fromEntries(
            Object.keys(MAT).map((k) => [
                k,
                { P: [], N: [], UV: [], C: [], I: [] },
            ]),
        );

        const gGet = (x, y, z) =>
            (ghosts && ghosts.get(this.k(x, y, z))) || 0;
        const isGhostOcc = (x, y, z) => gGet(x, y, z) > 0;

        const push = (
            B,
            key,
            ax,
            ay,
            az,
            nx,
            ny,
            nz,
            bx,
            by,
            bz,
        ) => {
            let ux = 0,
                uy = 0,
                uz = 0,
                vx = 0,
                vy = 0,
                vz = 0;
            if (nx !== 0) {
                ux = 0;
                uy = 0;
                uz = 1;
                vx = 0;
                vy = 1;
                vz = 0;
            } else if (ny !== 0) {
                ux = 1;
                uy = 0;
                uz = 0;
                vx = 0;
                vy = 0;
                vz = 1;
            } else {
                ux = 1;
                uy = 0;
                uz = 0;
                vx = 0;
                vy = 1;
                vz = 0;
            }
            const p0 = [ax, ay, az],
                p1 = [ax + ux, ay + uy, az + uz],
                p2 = [ax + ux + vx, ay + uy + vy, az + uz + vz],
                p3 = [ax + vx, ay + vy, az + vz];
            const cx = uy * vz - uz * vy,
                cy = uz * vx - ux * vz,
                cz = ux * vy - uy * vx;
            const flip = cx * nx + cy * ny + cz * nz <= 0;
            const verts = flip
                ? [p0, p3, p2, p1]
                : [p0, p1, p2, p3];
            const uvs = flip
                ? [0, 0, 0, 1, 1, 1, 1, 0]
                : [0, 0, 1, 0, 1, 1, 0, 1];

            const occ0 = (x, y, z) =>
                this.isSolid(x, y, z) ? 1 : 0;
            const occ1 = (x, y, z) =>
                this.isSolid(x, y, z) || isGhostOcc(x, y, z)
                    ? 1
                    : 0;
            function aoTable(a, b, c) {
                return AO_TABLE[a && b ? 3 : a + b + c];
            }
            function aoForVertex(su, sv) {
                const sx = bx + nx + (su ? ux : -ux),
                    sy = by + ny + (su ? uy : -uy),
                    sz = bz + nz + (su ? uz : -uz);
                const tx = bx + nx + (sv ? vx : -vx),
                    ty = by + ny + (sv ? vy : -vy),
                    tz = bz + nz + (sv ? vz : -vz);
                const cx =
                    bx + nx + (su ? ux : -ux) + (sv ? vx : -vx);
                const cy =
                    by + ny + (su ? uy : -uy) + (sv ? vy : -vy);
                const cz =
                    bz + nz + (su ? uz : -uz) + (sv ? vz : -vz);
                const a0 = occ0(sx, sy, sz),
                    b0 = occ0(tx, ty, tz),
                    c0 = occ0(cx, cy, cz);
                const a1 = occ1(sx, sy, sz),
                    b1 = occ1(tx, ty, tz),
                    c1 = occ1(cx, cy, cz);
                const ao0 = aoTable(a0, b0, c0),
                    ao1 = aoTable(a1, b1, c1);
                const gLocal = Math.max(
                    gGet(sx, sy, sz),
                    gGet(tx, ty, tz),
                    gGet(cx, cy, cz),
                );
                return ao0 * (1 - gLocal) + ao1 * gLocal;
            }

            const topTint = faceTint(nx, ny, nz);
            const aoCanon = [
                aoForVertex(0, 0),
                aoForVertex(1, 0),
                aoForVertex(1, 1),
                aoForVertex(0, 1),
            ].map((v) => v * topTint);
            const ao = flip
                ? [aoCanon[0], aoCanon[3], aoCanon[2], aoCanon[1]]
                : aoCanon;

            const base = B.P.length / 3;
            for (let i = 0; i < 4; i++) {
                const p = verts[i];
                B.P.push(p[0], p[1], p[2]);
                B.N.push(nx, ny, nz);
                const s = ao[i];
                B.C.push(s, s, s);
            }
            B.UV.push(...uvs);
            B.I.push(
                base,
                base + 1,
                base + 2,
                base,
                base + 2,
                base + 3,
            );
        };

        for (const key of this.blocks.keys()) {
            const [x, y, z] = key.split(",").map(Number);
            const blockData = this.blocks.get(key);
            const id = typeof blockData === "object" ? blockData.id : blockData;
            const axis = typeof blockData === "object" ? blockData.axis : AXIS_Y;
            const addFace = (nx, ny, nz, matKey) => {
                const sx = x + nx,
                    sy = y + ny,
                    sz = z + nz;
                if (this.isSolid(sx, sy, sz)) return;
                const ax = x + (nx > 0 ? 1 : 0),
                    ay = y + (ny > 0 ? 1 : 0),
                    az = z + (nz > 0 ? 1 : 0);
                push(
                    buckets[matKey],
                    matKey,
                    ax,
                    ay,
                    az,
                    nx,
                    ny,
                    nz,
                    x,
                    y,
                    z,
                );
            };
            if (id === SAPLING) {
                // Cross-shaped plant (two diagonal quads forming an X)
                const B = buckets["sapling"];
                const base = B.P.length / 3;
                const cx = x + 0.5, cy = y, cz = z + 0.5;
                // Diagonal 1: from (x,y,z) to (x+1,y+1,z+1)
                B.P.push(cx - 0.5, cy, cz - 0.5);
                B.P.push(cx + 0.5, cy, cz + 0.5);
                B.P.push(cx + 0.5, cy + 1, cz + 0.5);
                B.P.push(cx - 0.5, cy + 1, cz - 0.5);
                B.N.push(0.707, 0, -0.707, 0.707, 0, -0.707, 0.707, 0, -0.707, 0.707, 0, -0.707);
                B.UV.push(0, 0, 1, 0, 1, 1, 0, 1);
                B.C.push(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1);
                B.I.push(base, base + 1, base + 2, base, base + 2, base + 3);

                // Diagonal 2: from (x+1,y,z) to (x,y+1,z+1)
                const base3 = B.P.length / 3;
                B.P.push(cx + 0.5, cy, cz - 0.5);
                B.P.push(cx - 0.5, cy, cz + 0.5);
                B.P.push(cx - 0.5, cy + 1, cz + 0.5);
                B.P.push(cx + 0.5, cy + 1, cz - 0.5);
                B.N.push(-0.707, 0, -0.707, -0.707, 0, -0.707, -0.707, 0, -0.707, -0.707, 0, -0.707);
                B.UV.push(0, 0, 1, 0, 1, 1, 0, 1);
                B.C.push(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1);
                B.I.push(base3, base3 + 1, base3 + 2, base3, base3 + 2, base3 + 3);
            } else if (BLOCKS[id]) {
                addFace(+1, 0, 0, blockMaterial(id, "x", axis));
                addFace(-1, 0, 0, blockMaterial(id, "x", axis));
                addFace(0, +1, 0, blockMaterial(id, "top", axis));
                addFace(0, -1, 0, blockMaterial(id, "bottom", axis));
                addFace(0, 0, +1, blockMaterial(id, id === LOG ? "z" : "front", axis));
                addFace(0, 0, -1, blockMaterial(id, "z", axis));
            }
        }

        for (const [key, B] of Object.entries(buckets)) {
            if (B.I.length === 0) continue;
            const g = new THREE.BufferGeometry();
            g.setAttribute(
                "position",
                new THREE.Float32BufferAttribute(B.P, 3),
            );
            g.setAttribute(
                "normal",
                new THREE.Float32BufferAttribute(B.N, 3),
            );
            g.setAttribute(
                "uv",
                new THREE.Float32BufferAttribute(B.UV, 2),
            );
            g.setAttribute(
                "color",
                new THREE.Float32BufferAttribute(B.C, 3),
            );
            g.setIndex(B.I);
            const m = new THREE.Mesh(g, MAT[key]);
            if (MAT[key].alphaTest > 0) excludeCutoutFromNormalPass(m);
            m.castShadow = true;
            m.receiveShadow = true;
            this.group.add(m);
        }
        scene.add(this.group);
    }
}
export const world = new World();
