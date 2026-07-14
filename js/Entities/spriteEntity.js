import * as THREE from "three";
import { scene } from "../Graphics/setup.js";
import { buildVoxelAsset } from "../Graphics/itemVoxel.js";

const assets = new Map();
const images = new Map();
const animatedEntities = new Set();
let libraryPromise;

function loadImage(path) {
    if (images.has(path)) return images.get(path);
    const pending = new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = path;
    });
    images.set(path, pending);
    return pending;
}

function loadLibrary() {
    return libraryPromise ??= fetch("./models/sprite_entities.json").then((response) => response.json());
}

async function loadAsset(id) {
    if (assets.has(id)) return assets.get(id);
    const pending = (async () => {
        const library = await loadLibrary();
        const definition = library.entities[id];
        if (!definition) throw new Error(`Unknown sprite entity: ${id}`);
        const parts = await Promise.all((definition.parts ?? [definition]).map(async (part) => {
            const [front, back, ...blinkImages] = await Promise.all([
                loadImage(part.front),
                part.frontOnly ? null : loadImage(part.back ?? part.front),
                ...(part.blinkAnimation?.frames ?? []).map(loadImage),
            ]);
            const voxel = Math.min(part.width / front.naturalWidth, part.height / front.naturalHeight);
            const halfDepth = voxel * part.voxels * 0.5;
            const depthOffset = { front: halfDepth, back: -halfDepth }[part.depthExtension] ?? 0;
            const build = (image) => buildVoxelAsset(image, part.width, halfDepth, back, part.height, depthOffset);
            return { part, ...build(front), blinkFrames: blinkImages.map(build) };
        }));
        return { definition, parts };
    })();
    assets.set(id, pending);
    return pending;
}

export async function spawnSpriteEntity(id, block, rotationY) {
    const asset = await loadAsset(id);
    const { anchor } = asset.definition;
    const entity = new THREE.Group();
    entity.position.set(block.x + anchor.x, block.y + anchor.y, block.z + anchor.z);
    entity.rotation.y = rotationY;
    const idleParts = {};
    const blinks = [];
    for (const { geometry } of asset.parts) geometry.computeBoundingBox();
    for (const assetPart of asset.parts) {
        const { part, geometry, material } = assetPart;
        const offset = part.offset ?? { x: 0, y: 0, z: 0 };
        const mesh = new THREE.Mesh(geometry, material);
        const y = asset.definition.canvasAligned
            ? offset.y + part.height * 0.5
            : offset.y - geometry.boundingBox.min.y;
        mesh.rotation.y = THREE.MathUtils.degToRad(part.rotation ?? 0);
        mesh.castShadow = mesh.receiveShadow = true;
        let node = mesh;
        if (part.pivot) {
            const pivotX = part.pivot.endsWith("Right") ? geometry.boundingBox.max.x : geometry.boundingBox.min.x;
            const pivotY = part.pivot.startsWith("bottom") ? geometry.boundingBox.min.y : geometry.boundingBox.max.y;
            node = new THREE.Group();
            node.position.set(offset.x + pivotX, y + pivotY, offset.z);
            mesh.position.set(-pivotX, -pivotY, 0);
            node.add(mesh);
        } else {
            mesh.position.set(offset.x, y, offset.z);
        }
        entity.add(node);
        if (part.idlePart) (idleParts[part.idlePart] ??= []).push({ node, y: node.position.y });
        if (part.blinkAnimation) blinks.push({
            mesh,
            base: { geometry, material },
            frames: assetPart.blinkFrames,
            config: part.blinkAnimation,
            frame: -1,
            next: performance.now() * 0.001 + blinkDelay(part.blinkAnimation),
        });
    }
    scene.add(entity);
    if (asset.definition.idleAnimation || blinks.length) animatedEntities.add({ parts: idleParts, config: asset.definition.idleAnimation, blinks, phase: Math.random() });
    return entity;
}

function blinkDelay(config) {
    return config.minInterval + Math.random() * (config.maxInterval - config.minInterval);
}

export function updateSpriteEntities(time) {
    for (const { parts, config, blinks, phase } of animatedEntities) {
        for (const blink of blinks) {
            if (time < blink.next) continue;
            const frame = Math.floor((time - blink.next) / blink.config.frameDuration);
            if (frame < blink.frames.length) {
                if (frame === blink.frame) continue;
                blink.frame = frame;
                blink.mesh.geometry = blink.frames[frame].geometry;
                blink.mesh.material = blink.frames[frame].material;
            } else {
                blink.mesh.geometry = blink.base.geometry;
                blink.mesh.material = blink.base.material;
                blink.frame = -1;
                blink.next = time + blinkDelay(blink.config);
            }
        }
        if (!config) continue;
        const inhale = 0.5 - 0.5 * Math.cos((time / config.period + phase) * Math.PI * 2);
        const sway = Math.sin((time / config.period + phase) * Math.PI * 2);
        const bodyLift = inhale * config.bodyBob;
        const headLift = inhale * config.headBob;
        for (const { node, y } of parts.chest ?? []) {
            node.position.y = y + bodyLift;
            node.scale.set(1 + inhale * config.chestScale, 1 + inhale * config.chestScale * 0.35, 1 + inhale * config.chestScale);
        }
        for (const { node, y } of parts.belly ?? []) node.position.y = y + bodyLift;
        for (const { node, y } of parts.head ?? []) node.position.y = y + headLift;
        for (const { node, y } of parts.leftArm ?? []) {
            node.position.y = y + bodyLift;
            node.rotation.z = -inhale * config.armAngle;
        }
        for (const { node, y } of parts.rightArm ?? []) {
            node.position.y = y + bodyLift;
            node.rotation.z = inhale * config.armAngle;
        }
        for (const { node, y } of parts.leftEar ?? []) {
            node.position.y = y + headLift;
            node.rotation.z = -sway * config.earAngle;
        }
        for (const { node, y } of parts.rightEar ?? []) {
            node.position.y = y + headLift;
            node.rotation.z = sway * config.earAngle;
        }
    }
}
