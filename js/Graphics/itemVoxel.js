import * as THREE from "three";
import { ITEMS } from "../registries.js";

const assets = new Map();
const pending = new Map();

function buildAsset(image) {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const width = canvas.width;
    const height = canvas.height;
    const unit = 0.34 / Math.max(width, height);
    const halfDepth = 0.016;
    const positions = [];
    const normals = [];
    const colors = [];
    const indices = [];
    const color = new THREE.Color();
    const opaque = (x, y) => x >= 0 && x < width && y >= 0 && y < height && pixels[(y * width + x) * 4 + 3] >= 128;
    const addQuad = (vertices, normal, r, g, b) => {
        const base = positions.length / 3;
        for (const vertex of vertices) {
            positions.push(...vertex);
            normals.push(...normal);
            colors.push(r, g, b);
        }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };

    for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
        if (!opaque(px, py)) continue;
        const offset = (py * width + px) * 4;
        color.setRGB(pixels[offset] / 255, pixels[offset + 1] / 255, pixels[offset + 2] / 255, THREE.SRGBColorSpace);
        const x0 = (px - width * 0.5) * unit;
        const x1 = x0 + unit;
        const y1 = (height * 0.5 - py) * unit;
        const y0 = y1 - unit;
        const rgb = [color.r, color.g, color.b];
        addQuad([[x0, y0, halfDepth], [x1, y0, halfDepth], [x1, y1, halfDepth], [x0, y1, halfDepth]], [0, 0, 1], ...rgb);
        addQuad([[x1, y0, -halfDepth], [x0, y0, -halfDepth], [x0, y1, -halfDepth], [x1, y1, -halfDepth]], [0, 0, -1], ...rgb);
        if (!opaque(px - 1, py)) addQuad([[x0, y0, -halfDepth], [x0, y0, halfDepth], [x0, y1, halfDepth], [x0, y1, -halfDepth]], [-1, 0, 0], ...rgb);
        if (!opaque(px + 1, py)) addQuad([[x1, y0, halfDepth], [x1, y0, -halfDepth], [x1, y1, -halfDepth], [x1, y1, halfDepth]], [1, 0, 0], ...rgb);
        if (!opaque(px, py + 1)) addQuad([[x0, y0, -halfDepth], [x1, y0, -halfDepth], [x1, y0, halfDepth], [x0, y0, halfDepth]], [0, -1, 0], ...rgb);
        if (!opaque(px, py - 1)) addQuad([[x0, y1, halfDepth], [x1, y1, halfDepth], [x1, y1, -halfDepth], [x0, y1, -halfDepth]], [0, 1, 0], ...rgb);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.82,
        metalness: 0,
    });
    return { geometry, material };
}

export function getItemVoxelAsset(id, onReady = null) {
    const cached = assets.get(id);
    if (cached) return cached;
    const existing = pending.get(id);
    if (existing) {
        if (onReady) existing.add(onReady);
        return null;
    }
    const listeners = new Set();
    if (onReady) listeners.add(onReady);
    pending.set(id, listeners);
    const image = new Image();
    image.onload = () => {
        const asset = buildAsset(image);
        assets.set(id, asset);
        const callbacks = pending.get(id);
        pending.delete(id);
        for (const callback of callbacks || []) callback(asset, id);
    };
    image.src = ITEMS[id].icon;
    return null;
}
