import * as THREE from "three";
import { excludeCutoutFromNormalPass, scene } from "../Graphics/setup.js";
import { world } from "../Graphics/world.js";
import { player } from "../Player/player.js";
import { addToInv, canAdd, maxStack } from "../Player/inventory.js";
import { ITEMS } from "../registries.js";
import { BLOCK_ICON } from "../Graphics/materials.js";
import { getItemVoxelAsset } from "../Graphics/itemVoxel.js";

const geometry = new THREE.BoxGeometry(0.28, 0.28, 0.28);
const flatGeometry = new THREE.PlaneGeometry(0.34, 0.34);
const loader = new THREE.TextureLoader();
const materials = new Map();
const textures = new Map();
const mergeMovement = [];
const pickupTarget = new THREE.Vector3();
const pickupDirection = new THREE.Vector3();
export const itemDrops = [];

function applyVoxelAsset(asset, id) {
    for (const drop of itemDrops) {
        if (drop.id !== id) continue;
        drop.mesh.geometry = asset.geometry;
        drop.mesh.material = asset.material;
    }
}

function refreshCountLabel(drop) {
    if (drop.countLabel) {
        drop.mesh.remove(drop.countLabel);
        drop.countLabel.material.map.dispose();
        drop.countLabel.material.dispose();
        drop.countLabel = null;
    }
    drop.mesh.scale.setScalar(1 + Math.min(0.3, Math.log2(Math.max(1, drop.count)) * 0.04));
    if (drop.count <= 1) return;

    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    context.imageSmoothingEnabled = true;
    context.font = "600 64px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.lineJoin = "round";
    context.lineWidth = 9;
    context.strokeStyle = "rgba(0, 0, 0, 0.82)";
    context.strokeText(`×${drop.count}`, 128, 48);
    context.fillStyle = "#fff";
    context.fillText(`×${drop.count}`, 128, 48);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.1,
        depthTest: true,
        depthWrite: false,
    }));
    excludeCutoutFromNormalPass(label);
    label.position.set(0, 0.32, 0);
    label.scale.set(0.48, 0.18, 1);
    label.renderOrder = 2;
    drop.mesh.add(label);
    drop.countLabel = label;
}

function textureFor(path) {
    if (textures.has(path)) return textures.get(path);
    const texture = loader.load(path);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    textures.set(path, texture);
    return texture;
}

function materialFor(path, block = false) {
    const key = `${block ? "block" : "item"}:${path}`;
    if (materials.has(key)) return materials.get(key);
    const material = new THREE.MeshStandardMaterial({
        map: textureFor(path),
        color: 0xffffff,
        roughness: block ? 0.82 : 0.9,
        metalness: 0,
        transparent: false,
        alphaTest: 0.5,
        depthWrite: true,
        side: block ? THREE.FrontSide : THREE.DoubleSide,
    });
    materials.set(key, material);
    return material;
}

function blockMaterials(id) {
    const faces = BLOCK_ICON[id];
    const side = materialFor(faces.side, true);
    const top = materialFor(faces.top || faces.side, true);
    const bottom = materialFor(faces.bottom || faces.top || faces.side, true);
    const front = materialFor(faces.front || faces.side, true);
    return [side, side, top, bottom, front, side];
}

export function spawnItem(id, count, position, options = {}) {
    if (!ITEMS[id] || count <= 0) return null;
    const fallbackMaterial = materialFor(ITEMS[id].icon);
    const voxel = BLOCK_ICON[id] ? null : getItemVoxelAsset(id, applyVoxelAsset);
    const mesh = new THREE.Mesh(
        BLOCK_ICON[id] ? geometry : voxel?.geometry || flatGeometry,
        BLOCK_ICON[id] ? blockMaterials(id) : voxel?.material || fallbackMaterial,
    );
    excludeCutoutFromNormalPass(mesh);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const offset = options.noOffset ? 0 : 0.22;
    const pos = new THREE.Vector3(
        position.x + (Math.random() - 0.5) * offset,
        position.y,
        position.z + (Math.random() - 0.5) * offset,
    );
    mesh.position.copy(pos);
    scene.add(mesh);
    const drop = {
        id, count, mesh, pos,
        velocity: options.velocity?.clone() || new THREE.Vector3(
            (Math.random() - 0.5) * 0.5,
            options.velocityY ?? 1.2,
            (Math.random() - 0.5) * 0.5,
        ),
        grounded: false, age: 0, pickupDelay: options.pickupDelay ?? 0.5,
        phase: Math.random() * Math.PI * 2, lastSafePos: null, countLabel: null,
        pickupMagnet: false,
    };
    refreshCountLabel(drop);
    itemDrops.push(drop);
    return drop;
}

function removeDrop(index) {
    const drop = itemDrops[index];
    if (drop.countLabel) {
        drop.countLabel.material.map.dispose();
        drop.countLabel.material.dispose();
    }
    scene.remove(drop.mesh);
    itemDrops.splice(index, 1);
}

function mergeNearby(dt) {
    const attractionRange = 1.2;
    for (let i = 0; i < itemDrops.length; i++) {
        if (!mergeMovement[i]) mergeMovement[i] = new THREE.Vector2();
        else mergeMovement[i].set(0, 0);
    }

    // Calculate every pull from the same frame state, then move all drops together.
    for (let i = 0; i < itemDrops.length; i++) {
        const a = itemDrops[i];
        if (a.count >= maxStack(a.id)) continue;
        for (let j = i + 1; j < itemDrops.length; j++) {
            const b = itemDrops[j];
            if (!a.grounded || !b.grounded || a.pickupMagnet || b.pickupMagnet ||
                a.age < 0.5 || b.age < 0.5 || a.id !== b.id) continue;
            if (a.pos.distanceToSquared(b.pos) > attractionRange * attractionRange) continue;

            const dx = b.pos.x - a.pos.x;
            const dz = b.pos.z - a.pos.z;
            const distance = Math.hypot(dx, dz);
            if (distance <= COLLISION_EPS) continue;
            const amount = Math.min(
                distance * 0.5,
                (0.6 + (attractionRange - distance) * 1.4) * dt,
            );
            const moveX = dx / distance * amount;
            const moveZ = dz / distance * amount;
            mergeMovement[i].x += moveX;
            mergeMovement[i].y += moveZ;
            mergeMovement[j].x -= moveX;
            mergeMovement[j].y -= moveZ;
        }
    }

    for (let i = 0; i < itemDrops.length; i++) {
        const offset = mergeMovement[i];
        const distance = offset.length();
        if (!distance) continue;
        const maxMove = 2.4 * dt;
        if (distance > maxMove) offset.multiplyScalar(maxMove / distance);
        moveGroundedBy(itemDrops[i], offset.x, offset.y);
    }

    // Transfer counts only after every attracted drop has moved.
    for (let i = 0; i < itemDrops.length; i++) {
        const a = itemDrops[i];
        for (let j = itemDrops.length - 1; j > i && a.count < maxStack(a.id); j--) {
            const b = itemDrops[j];
            if (!a.grounded || !b.grounded || a.pickupMagnet || b.pickupMagnet ||
                a.age < 0.5 || b.age < 0.5 || a.id !== b.id ||
                a.pos.distanceToSquared(b.pos) > 0.2 * 0.2) continue;
            const moved = Math.min(maxStack(a.id) - a.count, b.count);
            a.count += moved;
            b.count -= moved;
            refreshCountLabel(a);
            if (b.count) refreshCountLabel(b);
            else removeDrop(j);
        }
    }
}

const ITEM_HALF = 0.14;
const COLLISION_EPS = 0.0001;
const PICKUP_MAGNET_RANGE = 1.35;

function collidesAt(x, y, z) {
    const minX = Math.floor(x - ITEM_HALF + COLLISION_EPS);
    const maxX = Math.floor(x + ITEM_HALF - COLLISION_EPS);
    const minY = Math.floor(y - ITEM_HALF + COLLISION_EPS);
    const maxY = Math.floor(y + ITEM_HALF - COLLISION_EPS);
    const minZ = Math.floor(z - ITEM_HALF + COLLISION_EPS);
    const maxZ = Math.floor(z + ITEM_HALF - COLLISION_EPS);
    for (let by = minY; by <= maxY; by++) {
        for (let bx = minX; bx <= maxX; bx++) {
            for (let bz = minZ; bz <= maxZ; bz++) {
                if (world.isSolid(bx, by, bz)) return true;
            }
        }
    }
    return false;
}

function escapeSolid(drop) {
    if (!collidesAt(drop.pos.x, drop.pos.y, drop.pos.z)) return false;
    const origin = drop.pos.clone();
    for (let offset = 0.02; offset <= 2.02; offset += 0.02) {
        const candidates = [
            [0, offset, 0], [-offset, 0, 0], [offset, 0, 0],
            [0, 0, -offset], [0, 0, offset], [0, -offset, 0],
        ];
        for (const [x, y, z] of candidates) {
            if (collidesAt(origin.x + x, origin.y + y, origin.z + z)) continue;
            drop.pos.set(origin.x + x, origin.y + y, origin.z + z);
            return true;
        }
    }
    return false;
}

function moveAxis(drop, axis, amount) {
    if (!amount) return false;
    const start = drop.pos[axis];
    drop.pos[axis] = start + amount;
    if (!collidesAt(drop.pos.x, drop.pos.y, drop.pos.z)) return false;

    let clear = 0;
    let blocked = 1;
    for (let i = 0; i < 12; i++) {
        const mid = (clear + blocked) * 0.5;
        drop.pos[axis] = start + amount * mid;
        if (collidesAt(drop.pos.x, drop.pos.y, drop.pos.z)) blocked = mid;
        else clear = mid;
    }
    drop.pos[axis] = start + amount * clear;
    drop.velocity[axis] = 0;
    if (axis === "y" && amount < 0) drop.grounded = true;
    return true;
}

function hasGroundSupport(drop) {
    return collidesAt(drop.pos.x, drop.pos.y - 0.015, drop.pos.z);
}

function moveGroundedBy(drop, dx, dz) {
    const x = drop.pos.x + dx;
    const z = drop.pos.z + dz;
    if (collidesAt(x, drop.pos.y, z) || !collidesAt(x, drop.pos.y - 0.015, z)) return;
    drop.pos.x = x;
    drop.pos.z = z;
}

function recoverEmbeddedDrop(drop) {
    const target = drop.lastSafePos || player.pos;
    drop.pos.set(target.x, target.y + 2, target.z);
    drop.velocity.set(0, 0, 0);
    drop.grounded = false;
    drop.age = 0;
    drop.pickupDelay = Math.max(drop.pickupDelay, 0.75);
}

function canPlayerReachDrop(drop, playerCenter, maxDistance = 1.05) {
    const distance = drop.pos.distanceTo(playerCenter);
    if (distance > maxDistance) return false;
    const steps = Math.max(1, Math.ceil(distance / 0.15));
    for (let step = 1; step < steps; step++) {
        const ratio = step / steps;
        const x = THREE.MathUtils.lerp(playerCenter.x, drop.pos.x, ratio);
        const y = THREE.MathUtils.lerp(playerCenter.y, drop.pos.y, ratio);
        const z = THREE.MathUtils.lerp(playerCenter.z, drop.pos.z, ratio);
        if (world.isSolid(Math.floor(x), Math.floor(y), Math.floor(z))) return false;
    }
    return true;
}

export function updateItemDrops(dt) {
    mergeNearby(dt);

    for (let i = itemDrops.length - 1; i >= 0; i--) {
        const drop = itemDrops[i];
        drop.age += dt;

        pickupTarget.set(
            player.pos.x,
            THREE.MathUtils.clamp(
                drop.pos.y,
                player.pos.y + ITEM_HALF,
                player.pos.y + player.height - ITEM_HALF,
            ),
            player.pos.z,
        );

        const canMagnetize = drop.age > drop.pickupDelay && canAdd(drop.id, drop.count) &&
            canPlayerReachDrop(drop, pickupTarget, PICKUP_MAGNET_RANGE);
        drop.pickupMagnet = canMagnetize;
        if (canMagnetize) {
            drop.grounded = false;
            drop.velocity.set(0, 0, 0);
            const distance = drop.pos.distanceTo(pickupTarget);
            if (distance <= 0.22) {
                addToInv(drop.id, drop.count);
                window.dispatchEvent(new CustomEvent("game-toast", {
                    detail: { type: "pickup", id: drop.id, count: drop.count },
                }));
                removeDrop(i);
                continue;
            }
            const speed = 6.4 + Math.max(0, PICKUP_MAGNET_RANGE - distance) * 8;
            pickupDirection.copy(pickupTarget).sub(drop.pos).normalize();
            drop.pos.addScaledVector(pickupDirection, Math.min(distance, speed * dt));
        }

        // A newly placed block may overlap a resting item. Eject it before
        // support checks so it cannot become hidden inside world geometry.
        if (!drop.pickupMagnet && collidesAt(drop.pos.x, drop.pos.y, drop.pos.z)) {
            if (escapeSolid(drop)) {
                drop.grounded = false;
                drop.velocity.y = Math.max(drop.velocity.y, 0.4);
            } else {
                recoverEmbeddedDrop(drop);
            }
        }

        if (!drop.pickupMagnet && drop.grounded) {
            if (hasGroundSupport(drop)) {
                if (drop.lastSafePos) drop.lastSafePos.copy(drop.pos);
                else drop.lastSafePos = drop.pos.clone();
            } else {
                drop.grounded = false;
            }
        }

        if (!drop.pickupMagnet && !drop.grounded) {
            drop.velocity.y = Math.max(-18, drop.velocity.y - 18 * dt);
            const distance = drop.velocity.length() * dt;
            const steps = Math.max(1, Math.ceil(distance / 0.04));
            const stepDt = dt / steps;
            for (let step = 0; step < steps && !drop.grounded; step++) {
                moveAxis(drop, "x", drop.velocity.x * stepDt);
                moveAxis(drop, "z", drop.velocity.z * stepDt);
                if (moveAxis(drop, "y", drop.velocity.y * stepDt) && drop.grounded) {
                    drop.velocity.x = 0;
                    drop.velocity.z = 0;
                    if (drop.lastSafePos) drop.lastSafePos.copy(drop.pos);
                    else drop.lastSafePos = drop.pos.clone();
                }
            }
        }

        if (drop.pos.y < -40) {
            removeDrop(i);
            continue;
        }

        drop.mesh.rotation.y += dt * 1.5;
        drop.mesh.position.copy(drop.pos);
        if (drop.grounded) drop.mesh.position.y += 0.025 + Math.sin(drop.age * 2.5 + drop.phase) * 0.025;

    }
}

export function serializeDrops() {
    return itemDrops.map(({ id, count, pos }) => ({ id, count, pos: pos.toArray() }));
}

export function loadDrops(drops = []) {
    while (itemDrops.length) removeDrop(itemDrops.length - 1);
    for (const drop of drops) spawnItem(drop.id, drop.count, new THREE.Vector3().fromArray(drop.pos), { noOffset: true, velocityY: 0 });
}

export function disposeItemDrops() {
    while (itemDrops.length) removeDrop(itemDrops.length - 1);
    geometry.dispose();
    flatGeometry.dispose();
    for (const material of materials.values()) material.dispose();
    for (const texture of textures.values()) texture.dispose();
    materials.clear();
    textures.clear();
    mergeMovement.length = 0;
}
