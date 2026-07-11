import * as THREE from "three";
import { world } from "../Graphics/world.js";
import {
    GRASS, AIR, DIRT, LOG, LEAVES, SAPLING, INFECTED_LEAVES,
    GRASS_SPREAD_CHECKS, GRASS_SPREAD_CHANCE, INFECTION_SPREAD_CHANCE,
    SAPLING_GROWTH_TIME, SAPLING_CROUCH_BOOST, SAPLING_CROUCH_RADIUS,
} from "../constants.js";
import { scene } from "../Graphics/setup.js";
import { TEX } from "../Graphics/materials.js";
import { player } from "../Player/player.js";
import { keys } from "../Player/input.js";

let blockIter = null;
const saplingTimers = new Map();
const particles = [];
let crouchWasDown = false;

function treeBlocks(x, y, z) {
    const blocks = new Map();
    const add = (dx, dy, dz, id) => blocks.set(`${x + dx},${y + dy},${z + dz}`, { x: x + dx, y: y + dy, z: z + dz, id });
    for (let dy = 0; dy <= 4; dy++) add(0, dy, 0, LOG);
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) add(dx, 4, dz, LEAVES);
    }
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        add(dx, 5, dz, LEAVES);
        add(dx, 3, dz, LEAVES);
    }
    for (let dy = 0; dy <= 4; dy++) add(0, dy, 0, LOG);
    return [...blocks.values()];
}

function canGrowTree(x, y, z, blocks) {
    return blocks.every((block) => {
        const current = world.get(block.x, block.y, block.z);
        return current === AIR || (block.x === x && block.y === y && block.z === z && current === SAPLING);
    });
}

function growTree(x, y, z) {
    const blocks = treeBlocks(x, y, z);
    if (!canGrowTree(x, y, z, blocks)) return false;
    for (const block of blocks) world.add(block.x, block.y, block.z, block.id);
    world.rebuild();
    return true;
}

function spawnGrowthSparks(x, y, z) {
    for (let i = 0; i < 6; i++) {
        const material = new THREE.SpriteMaterial({
            map: TEX.glint,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        const sprite = new THREE.Sprite(material);
        const lifetime = 0.65 + Math.random() * 0.45;
        sprite.position.set(
            x + 0.2 + Math.random() * 0.6,
            y + 0.15 + Math.random() * 0.45,
            z + 0.2 + Math.random() * 0.6,
        );
        sprite.scale.setScalar(0.18 + Math.random() * 0.18);
        scene.add(sprite);
        particles.push({ sprite, age: 0, lifetime, speed: 0.8 + Math.random() * 0.8 });
    }
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const particle = particles[i];
        particle.age += dt;
        if (particle.age >= particle.lifetime) {
            scene.remove(particle.sprite);
            particle.sprite.material.dispose();
            particles.splice(i, 1);
            continue;
        }
        particle.sprite.position.y += particle.speed * dt;
        particle.sprite.material.opacity = 1 - particle.age / particle.lifetime;
    }
}

function updateSaplings(dt) {
    const liveSaplings = new Set();
    for (const [key, data] of world.blocks) {
        const id = typeof data === "object" ? data.id : data;
        if (id !== SAPLING) continue;
        liveSaplings.add(key);
        saplingTimers.set(key, Math.max(0, (saplingTimers.get(key) ?? SAPLING_GROWTH_TIME) - dt));
    }
    for (const key of saplingTimers.keys()) {
        if (!liveSaplings.has(key)) saplingTimers.delete(key);
    }

    const crouchDown = !!(keys.ShiftLeft || keys.ShiftRight);
    if (crouchDown && !crouchWasDown) {
        const radiusSq = SAPLING_CROUCH_RADIUS ** 2;
        for (const key of liveSaplings) {
            const [x, y, z] = key.split(",").map(Number);
            const dx = player.pos.x - (x + 0.5);
            const dy = player.pos.y - y;
            const dz = player.pos.z - (z + 0.5);
            if (dx * dx + dy * dy + dz * dz > radiusSq) continue;
            saplingTimers.set(key, Math.max(0, saplingTimers.get(key) - SAPLING_CROUCH_BOOST));
            spawnGrowthSparks(x, y, z);
        }
    }
    crouchWasDown = crouchDown;

    for (const key of liveSaplings) {
        if (saplingTimers.get(key) > 0) continue;
        const [x, y, z] = key.split(",").map(Number);
        if (growTree(x, y, z)) saplingTimers.delete(key);
    }
}

export function updateEnvironment(dt) {
    updateParticles(dt);
    updateSaplings(dt);

    // Grass Spread
    if (!blockIter) blockIter = world.blocks.keys();

    for (let i = 0; i < GRASS_SPREAD_CHECKS; i++) {
        let res = blockIter.next();
        if (res.done) {
            blockIter = world.blocks.keys();
            res = blockIter.next();
        }
        if (res.value) {
            const key = res.value;
            const data = world.blocks.get(key);
            const id = typeof data === "object" ? data.id : data;

            if (id === GRASS && Math.random() < GRASS_SPREAD_CHANCE) {
                const [x, y, z] = key.split(",").map(Number);

                if (world.get(x, y + 1, z) === AIR) {
                    const candidates = [];
                    for (let dx = -1; dx <= 1; dx++) {
                        for (let dz = -1; dz <= 1; dz++) {
                            for (let dy = -1; dy <= 1; dy++) {
                                if (dx === 0 && dy === 0 && dz === 0) continue;
                                const nx = x + dx, ny = y + dy, nz = z + dz;
                                if (world.get(nx, ny, nz) === DIRT && world.get(nx, ny + 1, nz) === AIR) {
                                    candidates.push({ x: nx, y: ny, z: nz });
                                }
                            }
                        }
                    }
                    if (candidates.length > 0) {
                        const target = candidates[Math.floor(Math.random() * candidates.length)];
                        world.set(target.x, target.y, target.z, GRASS);
                    }
                }
            } else if (id === INFECTED_LEAVES && Math.random() < INFECTION_SPREAD_CHANCE) {
                const [x, y, z] = key.split(",").map(Number);
                const adjacent = [
                    [1, 0, 0], [-1, 0, 0], [0, 1, 0],
                    [0, -1, 0], [0, 0, 1], [0, 0, -1],
                ].filter(([dx, dy, dz]) => world.get(x + dx, y + dy, z + dz) === LEAVES);
                if (adjacent.length) {
                    const [dx, dy, dz] = adjacent[Math.floor(Math.random() * adjacent.length)];
                    world.set(x + dx, y + dy, z + dz, INFECTED_LEAVES);
                }
            }
        }
    }
}
