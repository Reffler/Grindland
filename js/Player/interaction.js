import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { world } from "../Graphics/world.js";
import {
    BLOCK_BOUNDS, REACH, SAPLING, AIR, LEAVES, INFECTED_LEAVES,
    GRASS, DIRT, LOG, PLACE_INTERVAL, HARD, RAD, AXIS_Y, AXIS_X, AXIS_Z,
    CROOK, SILKWORM, STRING, STONE_PEBBLE,
} from "../constants.js";
import { aimOrigin, player } from "./player.js";
import { keys, locked as isLocked } from "./input.js";
import { consumeSelected, getSelected } from "./inventory.js";
import { DESTROY } from "../Graphics/materials.js";
import { camera, excludeCutoutFromNormalPass, scene } from "../Graphics/setup.js";
import { playPlaceAnimation, playPunchAnimation } from "../Graphics/heldItem.js";
import { BLOCKS, ITEMS } from "../registries.js";
import { spawnItem } from "../Mechanics/itemDrops.js";
import { spawnBlockParticles } from "../Graphics/blockParticles.js";
import { positionKey, removeStation } from "../Mechanics/stations.js";
import { openStation, showToast, updateJadeTarget, isGameplayUIOpen } from "../Hud/ui.js";

/* ===== highlight & cracks ===== */
function makeBlockHighlight() {
    const width = 0.006;
    const inset = 0.01;
    const surface = 0.501;
    const edge = 0.5 - inset;
    const length = 1 - inset * 2 + width;
    const depth = 0.0015;
    const bridgeWidth = 0.009;
    const bridgeOffset = 0.4965;
    const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
        fog: false,
    });
    const geometries = {
        xOnY: new THREE.BoxGeometry(length, depth, width),
        zOnY: new THREE.BoxGeometry(width, depth, length),
        xOnZ: new THREE.BoxGeometry(length, width, depth),
        yOnZ: new THREE.BoxGeometry(width, length, depth),
        yOnX: new THREE.BoxGeometry(depth, length, width),
        zOnX: new THREE.BoxGeometry(depth, width, length),
        edgeX: new THREE.BoxGeometry(1.003, bridgeWidth, bridgeWidth),
        edgeY: new THREE.BoxGeometry(bridgeWidth, 1.003, bridgeWidth),
        edgeZ: new THREE.BoxGeometry(bridgeWidth, bridgeWidth, 1.003),
    };
    const parts = [];
    const addStrip = (geometry, x, y, z) => {
        const part = geometry.clone();
        part.translate(x, y, z);
        parts.push(part);
    };
    for (const face of [-1, 1]) {
        for (const side of [-1, 1]) {
            addStrip(geometries.xOnZ, 0, side * edge, face * surface);
            addStrip(geometries.yOnZ, side * edge, 0, face * surface);
            addStrip(geometries.xOnY, 0, face * surface, side * edge);
            addStrip(geometries.zOnY, side * edge, face * surface, 0);
            addStrip(geometries.yOnX, face * surface, 0, side * edge);
            addStrip(geometries.zOnX, face * surface, side * edge, 0);
        }
    }
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
        addStrip(geometries.edgeX, 0, a * bridgeOffset, b * bridgeOffset);
        addStrip(geometries.edgeY, a * bridgeOffset, 0, b * bridgeOffset);
        addStrip(geometries.edgeZ, a * bridgeOffset, b * bridgeOffset, 0);
    }
    const geometry = mergeGeometries(parts);
    for (const part of parts) part.dispose();
    for (const source of Object.values(geometries)) source.dispose();
    const highlight = new THREE.Mesh(geometry, material);
    highlight.renderOrder = 1000;
    excludeCutoutFromNormalPass(highlight);
    return highlight;
}

export const cubeHighlight = makeBlockHighlight();
cubeHighlight.visible = false;
scene.add(cubeHighlight);

const crackGeo = new THREE.BoxGeometry(1.004, 1.004, 1.004);
const crackMat = new THREE.MeshBasicMaterial({
    map: DESTROY[0],
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
});
const crackOverlay = new THREE.Mesh(crackGeo, crackMat);
crackOverlay.visible = false;
crackOverlay.renderOrder = 999;
scene.add(crackOverlay);

/* ===== raycast (voxel DDA) ===== */
function intersectAABB(origin, dir, min, max) {
    let tMin = (min.x - origin.x) / dir.x;
    let tMax = (max.x - origin.x) / dir.x;
    if (tMin > tMax) [tMin, tMax] = [tMax, tMin];

    let tyMin = (min.y - origin.y) / dir.y;
    let tyMax = (max.y - origin.y) / dir.y;
    if (tyMin > tyMax) [tyMin, tyMax] = [tyMax, tyMin];

    if ((tMin > tyMax) || (tyMin > tMax)) return null;
    if (tyMin > tMin) tMin = tyMin;
    if (tyMax < tMax) tMax = tyMax;

    let tzMin = (min.z - origin.z) / dir.z;
    let tzMax = (max.z - origin.z) / dir.z;
    if (tzMin > tzMax) [tzMin, tzMax] = [tzMax, tzMin];

    if ((tMin > tzMax) || (tzMin > tMax)) return null;
    if (tzMin > tMin) tMin = tzMin;
    if (tzMax < tMax) tMax = tzMax;

    if (tMin < 0) return null;

    const hit = origin.clone().addScaledVector(dir, tMin);
    const eps = 1e-5;
    let face = [0, 0, 0];
    if (Math.abs(hit.x - min.x) < eps) face = [-1, 0, 0];
    else if (Math.abs(hit.x - max.x) < eps) face = [1, 0, 0];
    else if (Math.abs(hit.y - min.y) < eps) face = [0, -1, 0];
    else if (Math.abs(hit.y - max.y) < eps) face = [0, 1, 0];
    else if (Math.abs(hit.z - min.z) < eps) face = [0, 0, -1];
    else if (Math.abs(hit.z - max.z) < eps) face = [0, 0, 1];

    return { dist: tMin, face, point: hit };
}

function ray(origin, dir, maxD) {
    let x = Math.floor(origin.x),
        y = Math.floor(origin.y),
        z = Math.floor(origin.z);
    const sx = dir.x > 0 ? 1 : -1,
        sy = dir.y > 0 ? 1 : -1,
        sz = dir.z > 0 ? 1 : -1;
    const ix = dir.x !== 0 ? 1 / dir.x : 1e9,
        iy = dir.y !== 0 ? 1 / dir.y : 1e9,
        iz = dir.z !== 0 ? 1 / dir.z : 1e9;
    let tx = (x + (dir.x > 0 ? 1 : 0) - origin.x) * ix,
        ty = (y + (dir.y > 0 ? 1 : 0) - origin.y) * iy,
        tz = (z + (dir.z > 0 ? 1 : 0) - origin.z) * iz;
    const dx = Math.abs(ix),
        dy = Math.abs(iy),
        dz = Math.abs(iz);
    let face = [0, 0, 0],
        dist = 0;
    for (let i = 0; i < 512; i++) {
        const id = world.get(x, y, z);
        if (id !== AIR) {
            const bounds = BLOCK_BOUNDS[id];
            if (!bounds) {
                const point = new THREE.Vector3(
                    origin.x + dir.x * dist,
                    origin.y + dir.y * dist,
                    origin.z + dir.z * dist,
                );
                return { x, y, z, face, dist, point, id };
            } else {
                const min = new THREE.Vector3(x + bounds.x, y + bounds.y, z + bounds.z);
                const max = new THREE.Vector3(x + bounds.x + bounds.w, y + bounds.y + bounds.h, z + bounds.z + bounds.d);
                const hit = intersectAABB(origin, dir, min, max);
                if (hit && hit.dist <= maxD) {
                    return { x, y, z, face: hit.face, dist: hit.dist, point: hit.point, bounds, id };
                }
            }
        }

        const m = Math.min(tx, ty, tz);
        const ex = Math.abs(tx - m) <= 1e-9;
        const ey = Math.abs(ty - m) <= 1e-9;
        const ez = Math.abs(tz - m) <= 1e-9;
        if (
            ex &&
            (!ey || Math.abs(dir.x) >= Math.abs(dir.y)) &&
            (!ez || Math.abs(dir.x) >= Math.abs(dir.z))
        ) {
            x += sx;
            dist = tx;
            tx += dx;
            face = [-sx, 0, 0];
        } else if (
            ey &&
            (!ez || Math.abs(dir.y) >= Math.abs(dir.z))
        ) {
            y += sy;
            dist = ty;
            ty += dy;
            face = [0, -sy, 0];
        } else {
            z += sz;
            dist = tz;
            tz += dz;
            face = [0, 0, -sz];
        }
        if (dist > maxD) break;
    }
    return null;
}

function withinReach(hit) {
    if (!hit) return false;
    const cx = hit.x + 0.5,
        cy = hit.y + 0.5,
        cz = hit.z + 0.5;
    const dx = aimOrigin.x - cx;
    const dy = aimOrigin.y - cy;
    const dz = aimOrigin.z - cz;
    return dx * dx + dy * dy + dz * dz <= (REACH + 0.001) ** 2;
}

// Interaction State
let leftDown = false;
let rightDown = false;
let rightRepeatBlocked = false;
let placeTimer = 0;
let pebbleTimer = 0;
let pebbleCooldown = 0;
let punchTimer = 0;
let dropKeyDown = false;
let dropKeyTimer = 0;
let currentAim = null;
let mining = { target: null, prog: 0, req: 0, stage: -1 };
const aimDirection = new THREE.Vector3();

function canInteractNow() {
    return !!currentAim && withinReach(currentAim);
}

function tryPlace(hit) {
    if (!hit || !canInteractNow()) return;
    const px = hit.x + hit.face[0],
        py = hit.y + hit.face[1],
        pz = hit.z + hit.face[2];
    if (world.get(px, py, pz) !== AIR) return;
    // Using RAD from constants.js
    const inside =
        px + 1 > player.pos.x - RAD &&
        px < player.pos.x + RAD &&
        py + 1 > player.pos.y &&
        py < player.pos.y + player.height &&
        pz + 1 > player.pos.z - RAD &&
        pz < player.pos.z + RAD;
    if (inside) return;
    const selected = getSelected();
    const id = ITEMS[selected.id]?.placeBlock;
    if (!id || !BLOCKS[id]?.placeable) return;

    // Determine axis for logs based on which face was clicked
    if (id === LOG) {
        let axis = AXIS_Y; // Default vertical
        const [fx, fy, fz] = hit.face;
        if (fy !== 0) {
            // Clicked top or bottom face → vertical log
            axis = AXIS_Y;
        } else if (fx !== 0) {
            // Clicked east or west face → horizontal X-axis log
            axis = AXIS_X;
        } else if (fz !== 0) {
            // Clicked north or south face → horizontal Z-axis log
            axis = AXIS_Z;
        }
        world.setWithData(px, py, pz, { id: LOG, axis });
    } else {
        world.set(px, py, pz, id);
    }
    consumeSelected(selected.id);
    playPlaceAnimation();
}

function isSneaking() {
    return !!(keys.ShiftLeft || keys.ShiftRight);
}

function canFarmPebbles(hit) {
    const held = getSelected().id;
    return isSneaking() && (hit?.id === GRASS || hit?.id === DIRT) &&
        (held === AIR || held === STONE_PEBBLE);
}

function farmPebble(hit) {
    if (pebbleCooldown > 0) return;
    spawnItem(STONE_PEBBLE, 1, new THREE.Vector3(
        hit.x + 0.5, hit.y + 1.2, hit.z + 0.5,
    ), {
        pickupDelay: 0.35,
        velocity: new THREE.Vector3(
            (Math.random() - 0.5) * 1.6,
            2.4 + Math.random() * 0.8,
            (Math.random() - 0.5) * 1.6,
        ),
    });
    pebbleCooldown = 0.1;
}

function tryUse(hit, repeat = false) {
    if (!hit || !canInteractNow()) return;
    const block = BLOCKS[hit.id];
    if (!repeat && block?.station && !isSneaking()) {
        openStation(block.station, positionKey(hit.x, hit.y, hit.z));
        return;
    }

    const selected = getSelected();
    if (!repeat && selected.id === SILKWORM && hit.id === LEAVES) {
        world.set(hit.x, hit.y, hit.z, INFECTED_LEAVES);
        consumeSelected(SILKWORM);
        showToast("Leaves infested");
        return;
    }

    if (canFarmPebbles(hit)) {
        farmPebble(hit);
        return;
    }
    tryPlace(hit);
}

function spawnBlockDrops(target) {
    const center = new THREE.Vector3(target.x + 0.5, target.y + 0.55, target.z + 0.5);
    const usingCrook = getSelected().id === CROOK;
    if (target.id === LEAVES) {
        if (Math.random() < (usingCrook ? 0.65 : 0.18)) spawnItem(SAPLING, 1, center);
        if (usingCrook && Math.random() < 0.32) spawnItem(SILKWORM, 1, center);
    } else if (target.id === INFECTED_LEAVES) {
        spawnItem(STRING, usingCrook ? 2 + (Math.random() < 0.4 ? 1 : 0) : 1, center);
    } else {
        const dropId = BLOCKS[target.id]?.drop;
        if (dropId) spawnItem(dropId, 1, center);
    }

    for (const slot of removeStation(target.id, positionKey(target.x, target.y, target.z))) {
        spawnItem(slot.id, slot.count, center);
    }
}

function resetMining() {
    mining.target = null;
    mining.prog = 0;
    mining.req = 0;
    mining.stage = -1;
    crackOverlay.visible = false;
}

function updateCracks() {
    if (!mining.target) return;
    const frac = Math.min(0.999, mining.prog / mining.req);
    const stage = Math.min(9, Math.max(0, Math.floor(frac * 10)));
    if (stage !== mining.stage) {
        mining.stage = stage;
        crackMat.map = DESTROY[stage];
        crackMat.needsUpdate = true;
        spawnBlockParticles(mining.target, mining.target.face);
    }
    crackOverlay.position.set(
        mining.target.x + 0.5,
        mining.target.y + 0.5,
        mining.target.z + 0.5,
    );
    crackOverlay.visible = true;
}

// Listeners
addEventListener("mousedown", (e) => {
    if (!isLocked() || isGameplayUIOpen()) return;
    if (e.button === 0) {
        leftDown = true;
        punchTimer = 0.284;
        playPunchAnimation();
    }
    if (e.button === 2) {
        rightDown = true;
        rightRepeatBlocked = false;
        if (canInteractNow()) {
            const farmingPebbles = canFarmPebbles(currentAim);
            rightRepeatBlocked = isSneaking() && !!BLOCKS[currentAim.id]?.station;
            tryUse(currentAim);
            placeTimer = PLACE_INTERVAL;
            pebbleTimer = farmingPebbles ? 0.12 : 0.75;
        }
    }
});

addEventListener("mouseup", (e) => {
    if (e.button === 0) {
        leftDown = false;
        punchTimer = 0;
        resetMining();
    }
    if (e.button === 2) {
        rightDown = false;
        rightRepeatBlocked = false;
        placeTimer = 0;
        pebbleTimer = 0;
    }
});

function throwSelectedItem() {
    const selected = getSelected();
    if (selected.id === AIR) return false;
    const direction = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    const position = new THREE.Vector3(player.pos.x, player.pos.y + 1.1, player.pos.z)
        .addScaledVector(direction, 0.55);
    const drop = spawnItem(selected.id, 1, position, {
        noOffset: true,
        pickupDelay: 1,
        velocity: direction.clone().multiplyScalar(2).add(new THREE.Vector3(0, 2.4, 0)),
    });
    if (drop) consumeSelected(selected.id);
    return !!drop;
}

addEventListener("keydown", (event) => {
    if (event.code !== "KeyQ" || !isLocked() || isGameplayUIOpen()) return;
    event.preventDefault();
    if (!dropKeyDown) {
        throwSelectedItem();
        dropKeyTimer = 0.18;
    }
    dropKeyDown = true;
});

addEventListener("keyup", (event) => {
    if (event.code !== "KeyQ") return;
    dropKeyDown = false;
    dropKeyTimer = 0;
});

document.addEventListener("pointerlockchange", () => {
    if (isLocked()) return;
    leftDown = false;
    punchTimer = 0;
    dropKeyDown = false;
    rightDown = false;
    rightRepeatBlocked = false;
    dropKeyTimer = 0;
});

window.addEventListener("game-ui-opened", () => {
    leftDown = false;
    punchTimer = 0;
    rightDown = false;
    rightRepeatBlocked = false;
    dropKeyDown = false;
    dropKeyTimer = 0;
    resetMining();
});

export function updateInteraction(dt) {
    if (dropKeyDown) {
        dropKeyTimer -= dt;
        if (dropKeyTimer <= 0) {
            throwSelectedItem();
            dropKeyTimer = 0.18;
        }
    }
    pebbleCooldown = Math.max(0, pebbleCooldown - dt);
    camera.getWorldDirection(aimDirection).normalize();
    currentAim = ray(aimOrigin, aimDirection, REACH);
    const hasAim = !!currentAim && withinReach(currentAim);
    updateJadeTarget(hasAim ? currentAim.id : AIR);

    cubeHighlight.visible = false;
    if (hasAim) {
        cubeHighlight.visible = true;
        const b = currentAim.bounds || { x: 0, y: 0, z: 0, w: 1, h: 1, d: 1 };
        cubeHighlight.scale.set(b.w, b.h, b.d);
        cubeHighlight.position.set(
            currentAim.x + b.x + b.w * 0.5,
            currentAim.y + b.y + b.h * 0.5,
            currentAim.z + b.z + b.d * 0.5
        );
    }

    // Right-click hold
    if (rightDown && !rightRepeatBlocked) {
        if (canInteractNow() && canFarmPebbles(currentAim)) {
            pebbleTimer -= dt;
            if (pebbleTimer <= 0) {
                farmPebble(currentAim);
                pebbleTimer = 0.12;
            }
        } else {
            placeTimer -= dt;
            if (placeTimer <= 0) {
                if (canInteractNow()) tryUse(currentAim, true);
                placeTimer = PLACE_INTERVAL;
            }
        }
    }

    // Mining
    if (leftDown) {
        punchTimer -= dt;
        if (punchTimer <= 0) {
            playPunchAnimation();
            punchTimer = 0.284;
        }
        if (mining.target) {
            const sameAim =
                currentAim &&
                currentAim.x === mining.target.x &&
                currentAim.y === mining.target.y &&
                currentAim.z === mining.target.z;
            const sameId =
                world.get(
                    mining.target.x,
                    mining.target.y,
                    mining.target.z,
                ) === mining.target.id;
            if (!sameAim || !sameId) {
                resetMining();
            }
        }
        if (!mining.target && currentAim && hasAim) {
            const id = world.get(
                currentAim.x,
                currentAim.y,
                currentAim.z,
            );
            if (id !== AIR) {
                mining.target = {
                    x: currentAim.x,
                    y: currentAim.y,
                    z: currentAim.z,
                    id,
                    face: [...currentAim.face],
                };
                const baseReq = HARD[id] ?? 0.5;
                const leaf = id === LEAVES || id === INFECTED_LEAVES;
                mining.req = leaf && getSelected().id === CROOK
                    ? Math.min(baseReq, 0.18)
                    : leaf ? Math.max(baseReq, 0.35) : baseReq;
                mining.prog = 0;
                mining.stage = -1;
            }
        }
        if (mining.target) {
            const cx = mining.target.x + 0.5,
                cy = mining.target.y + 0.5,
                cz = mining.target.z + 0.5;
            const dx = aimOrigin.x - cx;
            const dy = aimOrigin.y - cy;
            const dz = aimOrigin.z - cz;
            const dist = Math.hypot(dx, dy, dz);
            if (dist <= REACH + 0.001) {
                mining.prog += dt;
                updateCracks();
                if (mining.prog >= mining.req) {
                    const tx = mining.target.x;
                    const ty = mining.target.y;
                    const tz = mining.target.z;

                    const broken = { ...mining.target };
                    spawnBlockParticles(broken, broken.face, true);
                    world.set(tx, ty, tz, AIR);
                    spawnBlockDrops(broken);

                    // 2. Check for sapling above the broken block
                    if (world.get(tx, ty + 1, tz) === SAPLING) {
                        world.set(tx, ty + 1, tz, AIR);
                        spawnItem(SAPLING, 1, new THREE.Vector3(tx + 0.5, ty + 1.5, tz + 0.5));
                    }

                    resetMining();
                }
            } else {
                crackOverlay.visible = false;
            }
        }
    } else if (crackOverlay.visible) {
        resetMining();
    }
}
