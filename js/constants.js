export const GRAV = 28;
export const JUMP = 8;
export const VOID_FALL_DEPTH = 40; // Fall this many blocks below spawn before respawn
export const VOID_RESPAWN_HEIGHT = 40; // Respawn this many blocks above spawn
export const TERMINAL_VELOCITY = 80; // Max falling speed to prevent clipping

// Day/Night Cycle
export const DAY_DURATION = 20 * 60; // Minecraft-length full cycle: 20 minutes
export const CELESTIAL_RADIUS = 100; // Distance of sun/moon from player
export const SUN_SCALE = 50; // Visual size of the sun
export const MOON_SCALE = 40; // Visual size of the moon

export const RAD = 0.35;
export const EPS = 0.001;
export const REACH = 6;
export const HEIGHT_STAND = 1.8;
export const EYE_STAND = 1.62;
export const HEIGHT_CROUCH = 1.5;
export const EYE_CROUCH = 1.27;
export const CROUCH_SMOOTH_SPEED = 12;
export const PLACE_INTERVAL = 0.25;

export const SAPLING_DROP_CHANCE = 0.5;
export const SAPLING_GROWTH_TIME = 5 * 60;
export const SAPLING_CROUCH_BOOST = 60;
export const SAPLING_CROUCH_RADIUS = 1.5;
export const GRASS_SPREAD_CHANCE = 0.001;
export const INFECTION_SPREAD_CHANCE = 0.02;
export const GRASS_SPREAD_CHECKS = 20;

export const AIR = 0;
export const GRASS = 1;
export const DIRT = 2;
export const STONE = 3;
export const LOG = 4;
export const LEAVES = 5;
export const SAPLING = 6;
export const COBBLESTONE = 7;
export const INFECTED_LEAVES = 8;
export const CRAFTING_TABLE = 9;
export const FURNACE = 10;
export const CHEST = 11;

// Item-only IDs. Block items intentionally keep their block ID.
export const PLANKS = 100;
export const STICK = 101;
export const CROOK = 102;
export const SILKWORM = 103;
export const STRING = 104;
export const STONE_PEBBLE = 105;
export const CHARCOAL = 106;
export const TORCH = 107;
export const SHOP = 108;
export const SHOPPER = 109;

// Log axis orientations (like Minecraft)
export const AXIS_Y = 0; // Vertical (default)
export const AXIS_X = 1; // East-West (horizontal)
export const AXIS_Z = 2; // North-South (horizontal)

export const HARD = {
    [AIR]: 0,
    [GRASS]: 0.35,
    [DIRT]: 0.45,
    [STONE]: 1.4,
    [LOG]: 0.7,
    [LEAVES]: 0.2,
    [SAPLING]: 0.0,
    [COBBLESTONE]: 1.2,
    [INFECTED_LEAVES]: 0.25,
    [CRAFTING_TABLE]: 0.8,
    [FURNACE]: 1.5,
    [CHEST]: 0.8,
};

export const BLOCK_BOUNDS = {
    [SAPLING]: { x: 0.2, y: 0.0, z: 0.2, w: 0.6, h: 0.6, d: 0.6 },
};

export const HOTBAR_SIZE = 10;
export const INV_SIZE = 40;
export const STACK_MAX = 64;

export const STATE_MAIN = 0;
export const STATE_PLAY = 1;
export const STATE_PAUSE = 2;
