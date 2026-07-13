import * as THREE from "three";
import { scene } from "./setup.js";
import { TEX } from "./materials.js";
import { world } from "./world.js";
import { BLOCKS, ITEMS, blockMaterial } from "../registries.js";

const geometry = new THREE.BoxGeometry(1, 1, 1);
const MAX_PARTICLES = 256;
const particles = [];
const paletteCache = new Map();
const sampleCanvas = document.createElement("canvas");
const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
const particleMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0,
});
const particleMesh = new THREE.InstancedMesh(geometry, particleMaterial, MAX_PARTICLES);
const particleTransform = new THREE.Object3D();
const particleColorValue = new THREE.Color();
particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
particleMesh.count = 0;
particleMesh.frustumCulled = false;
scene.add(particleMesh);
let colorsDirty = false;

function textureKeys(id) {
    const material = BLOCKS[id]?.material;
    if (typeof material === "string") return [material];
    if (material) return [...new Set(Object.values(material))];
    const key = blockMaterial(id, "side");
    return key ? [key] : [];
}

function blockPalette(id) {
    if (paletteCache.has(id)) return paletteCache.get(id);

    const palette = [];
    try {
        for (const key of textureKeys(id)) {
            const image = TEX[key]?.image;
            if (!image?.complete || !image.naturalWidth) continue;
            sampleCanvas.width = image.naturalWidth;
            sampleCanvas.height = image.naturalHeight;
            sampleContext.clearRect(0, 0, sampleCanvas.width, sampleCanvas.height);
            sampleContext.drawImage(image, 0, 0);
            const pixels = sampleContext.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
            for (let i = 0; i < pixels.length; i += 4) {
                if (pixels[i + 3] < 26) continue;
                palette.push((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
            }
        }
    } catch {}

    if (palette.length) paletteCache.set(id, palette);
    return palette.length ? palette : [ITEMS[id]?.color ?? 0x888888];
}

function particleColor(id) {
    const palette = blockPalette(id);
    return palette[Math.floor(Math.random() * palette.length)];
}

export function spawnBlockParticles(target, face = [0, 1, 0], fullBreak = false) {
    const count = fullBreak ? 28 : 1;
    const center = new THREE.Vector3(target.x + 0.5, target.y + 0.5, target.z + 0.5);
    const normal = new THREE.Vector3(...face);

    for (let i = 0; i < count && particles.length < MAX_PARTICLES; i++) {
        const size = 0.028 + Math.random() * (Math.random() < 0.2 ? 0.052 : 0.026);
        const position = new THREE.Vector3().copy(center).add(new THREE.Vector3(
            (Math.random() - 0.5) * 0.72,
            (Math.random() - 0.5) * 0.72,
            (Math.random() - 0.5) * 0.72,
        ));
        if (!fullBreak) position.addScaledVector(normal, 0.48);
        const color = particleColor(target.id);
        particleColorValue.setHex(color);
        particleMesh.setColorAt(particles.length, particleColorValue);
        colorsDirty = true;

        const velocity = new THREE.Vector3(
            (Math.random() - 0.5) * (fullBreak ? 3.8 : 1.6),
            1.2 + Math.random() * (fullBreak ? 3.5 : 1.5),
            (Math.random() - 0.5) * (fullBreak ? 3.8 : 1.6),
        ).addScaledVector(normal, fullBreak ? 0.8 : 1.1);
        particles.push({
            position,
            rotation: new THREE.Euler(
                Math.random() * Math.PI,
                Math.random() * Math.PI,
                Math.random() * Math.PI,
            ),
            color,
            size,
            velocity,
            spin: new THREE.Vector3(
                (Math.random() - 0.5) * 12,
                (Math.random() - 0.5) * 12,
                (Math.random() - 0.5) * 12,
            ),
            age: 0,
            lifetime: 0.48 + Math.random() * 0.42,
        });
    }
}

export function updateBlockParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const particle = particles[i];
        particle.age += dt;
        if (particle.age >= particle.lifetime) {
            const last = particles.pop();
            if (i < particles.length) {
                particles[i] = last;
                particleColorValue.setHex(last.color);
                particleMesh.setColorAt(i, particleColorValue);
                colorsDirty = true;
            }
            continue;
        }
        particle.velocity.y -= 10.5 * dt;
        particle.position.x += particle.velocity.x * dt;
        particle.position.z += particle.velocity.z * dt;
        const nextY = particle.position.y + particle.velocity.y * dt;
        const blockY = Math.floor(nextY - particle.size * 0.5);
        if (particle.velocity.y < 0 && world.isSolid(
            Math.floor(particle.position.x),
            blockY,
            Math.floor(particle.position.z),
        )) {
            particle.position.y = blockY + 1 + particle.size * 0.5;
            particle.velocity.y *= -0.32;
            particle.velocity.x *= 0.72;
            particle.velocity.z *= 0.72;
            if (particle.velocity.y < 0.35) particle.velocity.y = 0;
        } else {
            particle.position.y = nextY;
        }
        particle.rotation.x += particle.spin.x * dt;
        particle.rotation.y += particle.spin.y * dt;
        particle.rotation.z += particle.spin.z * dt;

        const exit = THREE.MathUtils.clamp(
            (particle.age / particle.lifetime - 0.65) / 0.35,
            0,
            1,
        );
        const shrink = Math.max(0, 1 - exit + Math.sin(exit * Math.PI * 4) * 0.08 * (1 - exit));
        particle.currentSize = particle.size * shrink;
    }

    particleMesh.count = particles.length;
    for (let i = 0; i < particles.length; i++) {
        const particle = particles[i];
        particleTransform.position.copy(particle.position);
        particleTransform.rotation.copy(particle.rotation);
        particleTransform.scale.setScalar(particle.currentSize ?? particle.size);
        particleTransform.updateMatrix();
        particleMesh.setMatrixAt(i, particleTransform.matrix);
    }
    if (particles.length) {
        particleMesh.instanceMatrix.clearUpdateRanges();
        particleMesh.instanceMatrix.addUpdateRange(0, particles.length * 16);
        particleMesh.instanceMatrix.needsUpdate = true;
    }
    if (colorsDirty && particleMesh.instanceColor) {
        particleMesh.instanceColor.clearUpdateRanges();
        particleMesh.instanceColor.addUpdateRange(0, particles.length * 3);
        particleMesh.instanceColor.needsUpdate = true;
        colorsDirty = false;
    }
}
