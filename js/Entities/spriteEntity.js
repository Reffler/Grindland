import * as THREE from "three";
import { scene } from "../Graphics/setup.js";
import { buildVoxelAsset } from "../Graphics/itemVoxel.js";

const assets = new Map();
let libraryPromise;

const loadImage = (path) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = path;
});

function loadLibrary() {
    return libraryPromise ??= fetch("./models/sprite_entities.json").then((response) => response.json());
}

async function loadAsset(id) {
    if (assets.has(id)) return assets.get(id);
    const pending = (async () => {
        const library = await loadLibrary();
        const definition = library.entities[id];
        if (!definition) throw new Error(`Unknown sprite entity: ${id}`);
        const [front, back] = await Promise.all([loadImage(definition.front), loadImage(definition.back)]);
        const size = library.baseSize * definition.scale;
        const voxel = size / Math.max(front.naturalWidth, front.naturalHeight);
        return { definition, ...buildVoxelAsset(front, size, voxel * definition.voxels * 0.5, back) };
    })();
    assets.set(id, pending);
    return pending;
}

export async function spawnSpriteEntity(id, block, rotationY) {
    const asset = await loadAsset(id);
    const { anchor } = asset.definition;
    asset.geometry.computeBoundingBox();
    const entity = new THREE.Mesh(asset.geometry, asset.material);
    entity.position.set(block.x + anchor.x, block.y + anchor.y, block.z + anchor.z);
    entity.position.y -= asset.geometry.boundingBox?.min.y ?? 0;
    entity.rotation.y = rotationY;
    entity.castShadow = entity.receiveShadow = true;
    scene.add(entity);
    return entity;
}
