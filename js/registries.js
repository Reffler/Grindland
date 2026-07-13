import {
    AIR, GRASS, DIRT, STONE, LOG, LEAVES, SAPLING, COBBLESTONE,
    INFECTED_LEAVES, CRAFTING_TABLE, FURNACE, CHEST, PLANKS, STICK,
    CROOK, SILKWORM, STRING, STONE_PEBBLE, CHARCOAL, TORCH, SHOP, SHOPPER,
} from "./constants.js";

const block = (id, name, material, options = {}) => ({
    id, name, material, solid: true, placeable: true, ...options,
});

export const BLOCKS = {
    [AIR]: block(AIR, "Air", null, { solid: false, placeable: false }),
    [GRASS]: block(GRASS, "Grass Block", {
        side: "grass_side", top: "grass_top", bottom: "dirt",
    }, { drop: DIRT }),
    [DIRT]: block(DIRT, "Dirt", "dirt", { drop: DIRT }),
    [STONE]: block(STONE, "Stone", "stone", { drop: STONE }),
    [LOG]: block(LOG, "Oak Log", "log", { drop: LOG, oriented: true }),
    [LEAVES]: block(LEAVES, "Oak Leaves", "leaves", { placeable: false }),
    [SAPLING]: block(SAPLING, "Oak Sapling", "sapling", {
        solid: false, plant: true, drop: SAPLING,
    }),
    [COBBLESTONE]: block(COBBLESTONE, "Cobblestone", "cobblestone", { drop: COBBLESTONE }),
    [INFECTED_LEAVES]: block(INFECTED_LEAVES, "Infected Leaves", "infected_leaves", {
        placeable: false,
    }),
    [CRAFTING_TABLE]: block(CRAFTING_TABLE, "Crafting Table", {
        side: "crafting_side", top: "crafting_top", front: "crafting_front",
    }, { station: "crafting_table", drop: CRAFTING_TABLE }),
    [FURNACE]: block(FURNACE, "Furnace", {
        side: "furnace_side", top: "furnace_top", front: "furnace_front",
    }, { station: "furnace", drop: FURNACE }),
    [CHEST]: block(CHEST, "Chest", {
        side: "chest_side", top: "chest_side", front: "chest_front",
    }, { station: "chest", drop: CHEST }),
    [PLANKS]: block(PLANKS, "Oak Planks", {
        side: "planks", top: "planks", bottom: "planks",
    }, { drop: PLANKS }),
};

const item = (id, name, icon, options = {}) => ({
    id, name, icon, color: 0xffffff, maxStack: 64, ...options,
});

export const ITEMS = {
    [GRASS]: item(GRASS, "Grass Block", "./textures/grass_block_top.png", { placeBlock: GRASS }),
    [DIRT]: item(DIRT, "Dirt", "./textures/dirt.png", { placeBlock: DIRT, color: 0x79553a }),
    [STONE]: item(STONE, "Stone", "./textures/stone.png", { placeBlock: STONE, color: 0x888888 }),
    [LOG]: item(LOG, "Oak Log", "./textures/oak_log.png", { placeBlock: LOG, fuel: true, color: 0x74502d }),
    [LEAVES]: item(LEAVES, "Oak Leaves", "./textures/oak_leaves.png", { color: 0x4f8b3a }),
    [SAPLING]: item(SAPLING, "Oak Sapling", "./textures/oak_sapling.png", { placeBlock: SAPLING, color: 0x4e8b37 }),
    [COBBLESTONE]: item(COBBLESTONE, "Cobblestone", "./textures/cobblestone.png", { placeBlock: COBBLESTONE, color: 0x777777 }),
    [CRAFTING_TABLE]: item(CRAFTING_TABLE, "Crafting Table", "./textures/crafting_table_front.png", { placeBlock: CRAFTING_TABLE, color: 0x9a6635 }),
    [FURNACE]: item(FURNACE, "Furnace", "./textures/furnace_front.png", { placeBlock: FURNACE, color: 0x666666 }),
    [CHEST]: item(CHEST, "Chest", "./textures/chest_front.png", { placeBlock: CHEST, color: 0xb37a31 }),
    [PLANKS]: item(PLANKS, "Oak Planks", "./textures/oak_planks.png", { placeBlock: PLANKS, fuel: true, color: 0xb68a50 }),
    [STICK]: item(STICK, "Stick", "./textures/stick.png", { fuel: true, color: 0x9b6a35 }),
    [CROOK]: item(CROOK, "Crook", "./textures/crook.png", { maxStack: 1, tool: "crook", durability: 128, color: 0x8d663c }),
    [SILKWORM]: item(SILKWORM, "Silkworm", "./textures/silkworm.png", { color: 0xd9d4b8 }),
    [STRING]: item(STRING, "String", "./textures/string.png", { color: 0xeeeeee }),
    [STONE_PEBBLE]: item(STONE_PEBBLE, "Stone Pebble", "./textures/pebble.png"),
    [CHARCOAL]: item(CHARCOAL, "Charcoal", "./textures/coal.png", { fuel: true, color: 0x333333 }),
    [TORCH]: item(TORCH, "Torch", "./textures/torch.png", { color: 0xffcc55 }),
    [SHOP]: item(SHOP, "Shop", "./models/shop_front.png", { maxStack: 1, spriteEntity: "shop", color: 0xffffff }),
    [SHOPPER]: item(SHOPPER, "Shopper", "./models/shopper_front.png", { maxStack: 1, spriteEntity: "shopper", color: 0xffffff }),
};

export const RECIPES = [
    { id: "planks", station: "inventory", inputs: { [LOG]: 1 }, output: { id: PLANKS, count: 4 } },
    { id: "sticks", station: "inventory", inputs: { [PLANKS]: 2 }, output: { id: STICK, count: 4 } },
    { id: "crafting_table", station: "inventory", inputs: { [PLANKS]: 4 }, output: { id: CRAFTING_TABLE, count: 1 } },
    { id: "cobblestone", station: "inventory", inputs: { [STONE_PEBBLE]: 4 }, output: { id: COBBLESTONE, count: 1 } },
    { id: "torch", station: "inventory", inputs: { [STICK]: 1, [CHARCOAL]: 1 }, output: { id: TORCH, count: 4 } },
    { id: "crook", station: "crafting_table", inputs: { [STICK]: 4 }, output: { id: CROOK, count: 1 } },
    { id: "furnace", station: "crafting_table", inputs: { [COBBLESTONE]: 8 }, output: { id: FURNACE, count: 1 } },
    { id: "chest", station: "crafting_table", inputs: { [PLANKS]: 8 }, output: { id: CHEST, count: 1 } },
];

export const SMELTING = {
    [LOG]: { output: { id: CHARCOAL, count: 1 }, cookTime: 8 },
    [COBBLESTONE]: { output: { id: STONE, count: 1 }, cookTime: 8 },
};

export const FUELS = {
    [STICK]: 3,
    [PLANKS]: 8,
    [LOG]: 14,
    [CHARCOAL]: 40,
};

export function blockMaterial(id, face, axis = 0) {
    const material = BLOCKS[id]?.material;
    if (id === LOG) {
        const end = (axis === 0 && (face === "top" || face === "bottom")) ||
            (axis === 1 && face === "x") || (axis === 2 && face === "z");
        return end ? "log_top" : "log";
    }
    if (typeof material === "string") return material;
    if (!material) return null;
    if (face === "top") return material.top || material.side;
    if (face === "bottom") return material.bottom || material.side;
    if (face === "front") return material.front || material.side;
    return material.side;
}
