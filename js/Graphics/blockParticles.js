import * as THREE from "three";
import { scene } from "./setup.js";
import { TEX } from "./materials.js";
import { world } from "./world.js";
import { BLOCKS, ITEMS, blockMaterial } from "../registries.js";

const geometry = new THREE.BoxGeometry(1, 1, 1);
const particles = [];
const paletteCache = new Map();
const materialCache = new Map();
const sampleCanvas = document.createElement("canvas");
const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });

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

function particleMaterial(id) {
    const palette = blockPalette(id);
    const key = palette[Math.floor(Math.random() * palette.length)];
    if (!materialCache.has(key)) {
        materialCache.set(key, new THREE.MeshStandardMaterial({
            color: key,
            roughness: 0.9,
            metalness: 0,
        }));
    }
    return materialCache.get(key);
}

export function spawnBlockParticles(target, face = [0, 1, 0], fullBreak = false) {
    const count = fullBreak ? 28 : 1;
    const center = new THREE.Vector3(target.x + 0.5, target.y + 0.5, target.z + 0.5);
    const normal = new THREE.Vector3(...face);

    for (let i = 0; i < count; i++) {
        const mesh = new THREE.Mesh(geometry, particleMaterial(target.id));
        const size = 0.028 + Math.random() * (Math.random() < 0.2 ? 0.052 : 0.026);
        mesh.scale.setScalar(size);
        mesh.position.copy(center).add(new THREE.Vector3(
            (Math.random() - 0.5) * 0.72,
            (Math.random() - 0.5) * 0.72,
            (Math.random() - 0.5) * 0.72,
        ));
        if (!fullBreak) mesh.position.addScaledVector(normal, 0.48);
        mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        scene.add(mesh);

        const velocity = new THREE.Vector3(
            (Math.random() - 0.5) * (fullBreak ? 3.8 : 1.6),
            1.2 + Math.random() * (fullBreak ? 3.5 : 1.5),
            (Math.random() - 0.5) * (fullBreak ? 3.8 : 1.6),
        ).addScaledVector(normal, fullBreak ? 0.8 : 1.1);
        particles.push({
            mesh,
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
            scene.remove(particle.mesh);
            particles.splice(i, 1);
            continue;
        }
        particle.velocity.y -= 10.5 * dt;
        particle.mesh.position.x += particle.velocity.x * dt;
        particle.mesh.position.z += particle.velocity.z * dt;
        const nextY = particle.mesh.position.y + particle.velocity.y * dt;
        const blockY = Math.floor(nextY - particle.size * 0.5);
        if (particle.velocity.y < 0 && world.isSolid(
            Math.floor(particle.mesh.position.x),
            blockY,
            Math.floor(particle.mesh.position.z),
        )) {
            particle.mesh.position.y = blockY + 1 + particle.size * 0.5;
            particle.velocity.y *= -0.32;
            particle.velocity.x *= 0.72;
            particle.velocity.z *= 0.72;
            if (particle.velocity.y < 0.35) particle.velocity.y = 0;
        } else {
            particle.mesh.position.y = nextY;
        }
        particle.mesh.rotation.x += particle.spin.x * dt;
        particle.mesh.rotation.y += particle.spin.y * dt;
        particle.mesh.rotation.z += particle.spin.z * dt;

        const exit = THREE.MathUtils.clamp(
            (particle.age / particle.lifetime - 0.65) / 0.35,
            0,
            1,
        );
        const shrink = Math.max(0, 1 - exit + Math.sin(exit * Math.PI * 4) * 0.08 * (1 - exit));
        particle.mesh.scale.setScalar(particle.size * shrink);
    }
}
