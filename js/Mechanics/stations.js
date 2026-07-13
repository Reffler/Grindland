import { AIR, FURNACE, CHEST } from "../constants.js";
import { FUELS, ITEMS, SMELTING } from "../registries.js";
import { emptySlot, maxStack } from "../Player/inventory.js";

export const furnaces = new Map();
export const chests = new Map();

export function positionKey(x, y, z) {
    return `${x},${y},${z}`;
}

export function getFurnace(key) {
    if (!furnaces.has(key)) {
        furnaces.set(key, {
            input: emptySlot(), fuel: emptySlot(), output: emptySlot(),
            progress: 0, burnRemaining: 0, burnTotal: 0,
        });
    }
    return furnaces.get(key);
}

export function getChest(key) {
    if (!chests.has(key)) chests.set(key, Array.from({ length: 30 }, emptySlot));
    return chests.get(key);
}

function clearOne(slot) {
    slot.count--;
    if (slot.count <= 0) Object.assign(slot, emptySlot());
}

function canOutput(furnace, recipe) {
    const output = furnace.output;
    return output.id === AIR ||
        (output.id === recipe.output.id && output.count + recipe.output.count <= maxStack(output.id));
}

export function updateFurnaces(dt) {
    let changed = false;
    for (const furnace of furnaces.values()) {
        const recipe = SMELTING[furnace.input.id];
        const ready = recipe && canOutput(furnace, recipe);

        if (furnace.burnRemaining <= 0 && ready && FUELS[furnace.fuel.id]) {
            furnace.burnTotal = FUELS[furnace.fuel.id];
            furnace.burnRemaining = furnace.burnTotal;
            clearOne(furnace.fuel);
            changed = true;
        }

        if (furnace.burnRemaining > 0) {
            furnace.burnRemaining = Math.max(0, furnace.burnRemaining - dt);
            changed = true;
            if (ready) {
                furnace.progress += dt;
                if (furnace.progress >= recipe.cookTime) {
                    clearOne(furnace.input);
                    if (furnace.output.id === AIR) furnace.output.id = recipe.output.id;
                    furnace.output.count += recipe.output.count;
                    furnace.progress = 0;
                }
            } else {
                furnace.progress = 0;
            }
        } else if (!ready) {
            furnace.progress = 0;
        }
    }
    if (changed) window.dispatchEvent(new Event("station-tick"));
}

export function removeStation(id, key) {
    if (id === FURNACE) {
        const furnace = furnaces.get(key);
        furnaces.delete(key);
        return furnace ? [furnace.input, furnace.fuel, furnace.output].filter((slot) => slot.id !== AIR) : [];
    }
    if (id === CHEST) {
        const slots = chests.get(key) || [];
        chests.delete(key);
        return slots.filter((slot) => slot.id !== AIR);
    }
    return [];
}

export function serializeStations() {
    return {
        furnaces: Array.from(furnaces.entries()),
        chests: Array.from(chests.entries()),
    };
}

export function loadStations(data = {}) {
    furnaces.clear();
    chests.clear();
    for (const [key, furnace] of data.furnaces || []) furnaces.set(key, furnace);
    for (const [key, slots] of data.chests || []) chests.set(key, slots);
}

export function isFuel(id) {
    return !!FUELS[id];
}

export function isSmeltable(id) {
    return !!SMELTING[id];
}

export function slotName(slot) {
    return slot.id === AIR ? "Empty" : `${ITEMS[slot.id]?.name || "Unknown"} ×${slot.count}`;
}
