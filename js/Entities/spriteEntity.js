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
            const [front, back] = await Promise.all([
                loadImage(part.front),
                part.frontOnly ? null : loadImage(part.back ?? part.front),
            ]);
            const voxel = Math.min(part.width / front.naturalWidth, part.height / front.naturalHeight);
            const halfDepth = voxel * part.voxels * 0.5;
            const depthOffset = { front: halfDepth, back: -halfDepth }[part.depthExtension] ?? 0;
            const build = (image) => buildVoxelAsset(image, part.width, halfDepth, back, part.height, depthOffset);
            return { part, ...build(front), build };
        }));
        const frameAnimations = await Promise.all((definition.animations ?? [])
            .filter(({ type }) => type === "frames")
            .map(async (config) => {
                const target = parts.find(({ part }) => part.id === config.target);
                if (!target) throw new Error(`Unknown animation target: ${config.target}`);
                const frames = await Promise.all(config.frames.map(loadImage));
                return { config, target, frames: frames.map(target.build) };
            }));
        return { definition, parts, frameAnimations };
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
    const nodes = new Map();
    for (const { geometry } of asset.parts) geometry.computeBoundingBox();
    for (const [index, assetPart] of asset.parts.entries()) {
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
            const pivotX = THREE.MathUtils.lerp(geometry.boundingBox.min.x, geometry.boundingBox.max.x, part.pivot.x);
            const pivotY = THREE.MathUtils.lerp(geometry.boundingBox.min.y, geometry.boundingBox.max.y, part.pivot.y);
            const pivotZ = THREE.MathUtils.lerp(geometry.boundingBox.min.z, geometry.boundingBox.max.z, part.pivot.z ?? 0.5);
            node = new THREE.Group();
            node.position.set(offset.x + pivotX, y + pivotY, offset.z + pivotZ);
            mesh.position.set(-pivotX, -pivotY, -pivotZ);
            node.add(mesh);
        } else {
            mesh.position.set(offset.x, y, offset.z);
        }
        entity.add(node);
        nodes.set(part.id ?? `${id}:${index}`, {
            node,
            mesh,
            base: {
                position: node.position.clone(),
                rotation: node.rotation.clone(),
                scale: node.scale.clone(),
                geometry,
                material,
            },
        });
    }
    scene.add(entity);
    const now = performance.now() * 0.001;
    const animations = (asset.definition.animations ?? []).map((config) => {
        if (config.type === "sine") {
            for (const track of config.tracks) for (const target of track.targets ?? [track.target]) {
                if (!nodes.has(target)) throw new Error(`Unknown animation target: ${target}`);
            }
            return { config, phase: (config.phase ?? 0) + (config.randomPhase ? Math.random() : 0) };
        }
        if (config.type !== "frames") throw new Error(`Unknown animation type: ${config.type}`);
        const frames = asset.frameAnimations.find((animation) => animation.config === config);
        return {
            config,
            target: nodes.get(config.target),
            frames: frames.frames,
            frame: -1,
            next: config.interval ? now + animationDelay(config.interval) : now,
        };
    });
    if (animations.length) animatedEntities.add({ nodes, animations });
    return entity;
}

function animationDelay({ min, max }) {
    return min + Math.random() * (max - min);
}

function applySineAnimation(state, nodes, time) {
    for (const track of state.config.tracks) {
        const phase = time / state.config.period + state.phase + (track.phase ?? 0);
        const progress = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
        let value = THREE.MathUtils.lerp(track.from, track.to, progress);
        if (track.unit === "degrees") value = THREE.MathUtils.degToRad(value);
        const property = track.transform === "translation" ? "position" : track.transform;
        for (const id of track.targets ?? [track.target]) {
            const vector = nodes.get(id)?.node[property];
            if (!vector) continue;
            if (track.mode === "multiply") vector[track.axis] *= value;
            else if (track.mode === "set") vector[track.axis] = value;
            else vector[track.axis] += value;
        }
    }
}

function applyFrameAnimation(state, time) {
    if (time < state.next) return;
    const index = Math.floor((time - state.next) / state.config.frameDuration);
    if (state.config.interval && index >= state.frames.length) {
        state.target.mesh.geometry = state.target.base.geometry;
        state.target.mesh.material = state.target.base.material;
        state.frame = -1;
        state.next = time + animationDelay(state.config.interval);
        return;
    }
    const frame = state.config.loop === false ? Math.min(index, state.frames.length - 1) : index % state.frames.length;
    if (frame === state.frame) return;
    state.frame = frame;
    state.target.mesh.geometry = state.frames[frame].geometry;
    state.target.mesh.material = state.frames[frame].material;
}

export function updateSpriteEntities(time) {
    for (const { nodes, animations } of animatedEntities) {
        for (const { node, base } of nodes.values()) {
            node.position.copy(base.position);
            node.rotation.copy(base.rotation);
            node.scale.copy(base.scale);
        }
        for (const animation of animations) {
            if (animation.config.type === "sine") applySineAnimation(animation, nodes, time);
            else if (animation.config.type === "frames") applyFrameAnimation(animation, time);
        }
    }
}
