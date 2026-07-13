import * as THREE from "three";
import { ITEMS } from "../registries.js";

const assets = new Map();
const pending = new Map();

export function buildVoxelAsset(image, width = 0.34, halfDepth = 0.016, backImage = image, height = null, depthOffset = 0) {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let backPixels = null;
    if (backImage) {
        const backCanvas = document.createElement("canvas");
        backCanvas.width = canvas.width;
        backCanvas.height = canvas.height;
        const backContext = backCanvas.getContext("2d", { willReadFrequently: true });
        backContext.drawImage(backImage, 0, 0, backCanvas.width, backCanvas.height);
        backPixels = backContext.getImageData(0, 0, backCanvas.width, backCanvas.height).data;
    }
    const pixelWidth = canvas.width;
    const pixelHeight = canvas.height;
    const unit = width / Math.max(pixelWidth, pixelHeight);
    const unitX = height === null ? unit : width / pixelWidth;
    const unitY = height === null ? unit : height / pixelHeight;
    const frontDepth = halfDepth + depthOffset;
    const backDepth = -halfDepth + depthOffset;
    const positions = [];
    const normals = [];
    const colors = [];
    const indices = [];
    const color = new THREE.Color();
    const opaque = (x, y) => x >= 0 && x < pixelWidth && y >= 0 && y < pixelHeight && pixels[(y * pixelWidth + x) * 4 + 3] >= 128;
    const addQuad = (vertices, normal, r, g, b) => {
        const base = positions.length / 3;
        for (const vertex of vertices) {
            positions.push(...vertex);
            normals.push(...normal);
            colors.push(r, g, b);
        }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };

    for (let py = 0; py < pixelHeight; py++) for (let px = 0; px < pixelWidth; px++) {
        if (!opaque(px, py)) continue;
        const offset = (py * pixelWidth + px) * 4;
        color.setRGB(pixels[offset] / 255, pixels[offset + 1] / 255, pixels[offset + 2] / 255, THREE.SRGBColorSpace);
        const x0 = (px - pixelWidth * 0.5) * unitX;
        const x1 = x0 + unitX;
        const y1 = (pixelHeight * 0.5 - py) * unitY;
        const y0 = y1 - unitY;
        const frontRgb = [color.r, color.g, color.b];
        addQuad([[x0, y0, frontDepth], [x1, y0, frontDepth], [x1, y1, frontDepth], [x0, y1, frontDepth]], [0, 0, 1], ...frontRgb);
        if (backPixels) {
            color.setRGB(backPixels[offset] / 255, backPixels[offset + 1] / 255, backPixels[offset + 2] / 255, THREE.SRGBColorSpace);
            addQuad([[x1, y0, backDepth], [x0, y0, backDepth], [x0, y1, backDepth], [x1, y1, backDepth]], [0, 0, -1], color.r, color.g, color.b);
        }
        if (!opaque(px - 1, py)) addQuad([[x0, y0, backDepth], [x0, y0, frontDepth], [x0, y1, frontDepth], [x0, y1, backDepth]], [-1, 0, 0], ...frontRgb);
        if (!opaque(px + 1, py)) addQuad([[x1, y0, frontDepth], [x1, y0, backDepth], [x1, y1, backDepth], [x1, y1, frontDepth]], [1, 0, 0], ...frontRgb);
        if (!opaque(px, py + 1)) addQuad([[x0, y0, backDepth], [x1, y0, backDepth], [x1, y0, frontDepth], [x0, y0, frontDepth]], [0, -1, 0], ...frontRgb);
        if (!opaque(px, py - 1)) addQuad([[x0, y1, frontDepth], [x1, y1, frontDepth], [x1, y1, backDepth], [x0, y1, backDepth]], [0, 1, 0], ...frontRgb);
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

function buildAsset(image) {
    return buildVoxelAsset(image);
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

export function disposeItemVoxelAssets() {
    for (const asset of assets.values()) {
        asset.geometry.dispose();
        asset.material.dispose();
    }
    assets.clear();
    pending.clear();
}
