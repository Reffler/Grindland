import * as THREE from "three";
import { ITEMS } from "../registries.js";
import {
    GRASS, DIRT, STONE, LOG, LEAVES, INFECTED_LEAVES, COBBLESTONE,
    CRAFTING_TABLE, FURNACE, CHEST, PLANKS,
} from "../constants.js";

const loader = new THREE.TextureLoader();

function loadTex(path) {
    const t = loader.load(path);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    return t;
}

export const TEX = {
    dirt: loadTex("./textures/dirt.png"),
    grass_side: loadTex("./textures/grass_block_side.png"),
    grass_top: loadTex("./textures/grass_block_top.png"),
    log: loadTex("./textures/oak_log.png"),
    log_top: loadTex("./textures/oak_log_top_bottom.png"),
    leaves: loadTex("./textures/oak_leaves.png"),
    infected_leaves: loadTex("./textures/infected_leaves.png"),
    sapling: loadTex("./textures/oak_sapling.png"),
    glint: loadTex("./textures/glint.png"),
    stone: loadTex("./textures/stone.png"),
    cobblestone: loadTex("./textures/cobblestone.png"),
    crafting_side: loadTex("./textures/crafting_table_side.png"),
    crafting_top: loadTex("./textures/crafting_table_top.png"),
    crafting_front: loadTex("./textures/crafting_table_front.png"),
    furnace_side: loadTex("./textures/furnace_side.png"),
    furnace_top: loadTex("./textures/furnace_top.png"),
    furnace_front: loadTex("./textures/furnace_front.png"),
    chest_side: loadTex("./textures/chest_side.png"),
    chest_front: loadTex("./textures/chest_front.png"),
    planks: loadTex("./textures/oak_planks.png"),
};

TEX.sapling.wrapS = TEX.sapling.wrapT = THREE.ClampToEdgeWrapping;
TEX.glint.wrapS = TEX.glint.wrapT = THREE.ClampToEdgeWrapping;

export const DESTROY = Array.from({ length: 10 }, (_, i) =>
    loadTex(`./textures/destroy_stage_${i}.png`),
);

function lit(map, options = {}) {
    return new THREE.MeshStandardMaterial({
        map,
        vertexColors: true,
        roughness: 0.88,
        metalness: 0,
        ...options,
    });
}

export const MAT = {
    dirt: lit(TEX.dirt, { roughness: 0.96 }),
    grass_side: lit(TEX.grass_side, { roughness: 0.94 }),
    grass_top: lit(TEX.grass_top, { roughness: 0.92 }),
    log: lit(TEX.log, { roughness: 0.9 }),
    log_top: lit(TEX.log_top, { roughness: 0.92 }),
    leaves: lit(TEX.leaves, {
        roughness: 0.82,
        alphaTest: 0.5,
        transparent: false,
        depthWrite: true,
    }),
    sapling: lit(TEX.sapling, {
        roughness: 0.86,
        alphaTest: 0.5,
        transparent: false,
        depthWrite: true,
        side: THREE.DoubleSide,
    }),
    stone: lit(TEX.stone, { roughness: 0.78 }),
    cobblestone: lit(TEX.cobblestone, { roughness: 0.84 }),
    infected_leaves: lit(TEX.infected_leaves, {
        roughness: 0.82, alphaTest: 0.5,
        transparent: false, depthWrite: true,
    }),
    crafting_side: lit(TEX.crafting_side, { roughness: 0.8 }),
    crafting_top: lit(TEX.crafting_top, { roughness: 0.82 }),
    crafting_front: lit(TEX.crafting_front, { roughness: 0.8 }),
    furnace_side: lit(TEX.furnace_side, { roughness: 0.72 }),
    furnace_top: lit(TEX.furnace_top, { roughness: 0.72 }),
    furnace_front: lit(TEX.furnace_front, { roughness: 0.7 }),
    chest_side: lit(TEX.chest_side, { roughness: 0.74 }),
    chest_front: lit(TEX.chest_front, { roughness: 0.72 }),
    planks: lit(TEX.planks, { roughness: 0.86 }),
};

export const ICON = Object.fromEntries(
    Object.values(ITEMS).map(({ id, icon }) => [id, icon]),
);

const cube = (top, side = top, front = side, bottom = side) => ({ top, side, front, bottom });
export const BLOCK_ICON = {
    [GRASS]: cube(
        "./textures/grass_block_top.png",
        "./textures/grass_block_side.png",
        "./textures/grass_block_side.png",
        "./textures/dirt.png",
    ),
    [DIRT]: cube("./textures/dirt.png"),
    [STONE]: cube("./textures/stone.png"),
    [LOG]: cube(
        "./textures/oak_log_top_bottom.png",
        "./textures/oak_log.png",
        "./textures/oak_log.png",
        "./textures/oak_log_top_bottom.png",
    ),
    [LEAVES]: cube("./textures/oak_leaves.png"),
    [INFECTED_LEAVES]: cube("./textures/infected_leaves.png"),
    [COBBLESTONE]: cube("./textures/cobblestone.png"),
    [CRAFTING_TABLE]: cube("./textures/crafting_table_top.png", "./textures/crafting_table_side.png", "./textures/crafting_table_front.png"),
    [FURNACE]: cube("./textures/furnace_top.png", "./textures/furnace_side.png", "./textures/furnace_front.png"),
    [CHEST]: cube("./textures/chest_side.png", "./textures/chest_side.png", "./textures/chest_front.png"),
    [PLANKS]: cube("./textures/oak_planks.png"),
};

export function disposeMaterialAssets() {
    for (const material of Object.values(MAT)) material.dispose();
    for (const texture of Object.values(TEX)) texture.dispose();
    for (const texture of DESTROY) texture.dispose();
}
