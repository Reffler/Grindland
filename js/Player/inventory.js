import { INV_SIZE, HOTBAR_SIZE, AIR } from "../constants.js";
import { ITEMS } from "../registries.js";

export const emptySlot = () => ({ id: AIR, count: 0 });
export const inv = Array.from({ length: INV_SIZE }, emptySlot);
export let sel = 0;

let changeCallback = null;
export function setHotbarCallback(cb) {
    changeCallback = cb;
}

export function inventoryChanged() {
    if (changeCallback) changeCallback();
}

export function updateSel(newSel) {
    sel = ((newSel % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
    inventoryChanged();
}

export function maxStack(id) {
    return ITEMS[id]?.maxStack ?? 64;
}

export function countItem(id, slots = inv) {
    return slots.reduce((sum, slot) => sum + (slot.id === Number(id) ? slot.count : 0), 0);
}

export function addToSlots(slots, id, amount = 1) {
    if (!ITEMS[id] || amount <= 0) return amount;
    let left = amount;
    const limit = maxStack(id);
    for (const slot of slots) {
        if (slot.id !== id || slot.count >= limit) continue;
        const moved = Math.min(left, limit - slot.count);
        slot.count += moved;
        left -= moved;
        if (!left) return 0;
    }
    for (const slot of slots) {
        if (slot.id !== AIR) continue;
        const moved = Math.min(left, limit);
        slot.id = id;
        slot.count = moved;
        left -= moved;
        if (!left) return 0;
    }
    return left;
}

export function canAdd(id, amount = 1, slots = inv) {
    if (amount <= 0) return true;
    if (!ITEMS[id]) return false;
    const limit = maxStack(id);
    let capacity = 0;
    for (const slot of slots) {
        if (slot.id === id) capacity += limit - slot.count;
        else if (slot.id === AIR) capacity += limit;
        if (capacity >= amount) return true;
    }
    return false;
}

export function addToInv(id, amount = 1) {
    if (!canAdd(id, amount)) return false;
    addToSlots(inv, id, amount);
    inventoryChanged();
    return true;
}

export function removeItems(id, amount = 1, slots = inv) {
    if (countItem(id, slots) < amount) return false;
    let left = amount;
    for (const slot of slots) {
        if (slot.id !== Number(id)) continue;
        const moved = Math.min(left, slot.count);
        slot.count -= moved;
        left -= moved;
        if (!slot.count) Object.assign(slot, emptySlot());
        if (!left) break;
    }
    if (slots === inv) inventoryChanged();
    return true;
}

export function getSelected() {
    return inv[sel];
}

export function consumeSelected(expectedId = null, amount = 1) {
    const slot = inv[sel];
    if (slot.id === AIR || slot.count < amount || (expectedId !== null && slot.id !== expectedId)) return false;
    slot.count -= amount;
    if (!slot.count) Object.assign(slot, emptySlot());
    inventoryChanged();
    return true;
}

// Compatibility helper for placement code.
export function takeFromSel() {
    const id = getSelected().id;
    return consumeSelected(id) ? id : AIR;
}

export function canCraft(recipe) {
    const copy = inv.map((slot) => ({ ...slot }));
    for (const [id, amount] of Object.entries(recipe.inputs)) {
        if (!removeItems(id, amount, copy)) return false;
    }
    return addToSlots(copy, recipe.output.id, recipe.output.count) === 0;
}

export function craft(recipe) {
    if (!canCraft(recipe)) return false;
    for (const [id, amount] of Object.entries(recipe.inputs)) {
        removeItems(id, amount, inv);
    }
    addToSlots(inv, recipe.output.id, recipe.output.count);
    inventoryChanged();
    return true;
}

export function loadInventory(slots, selected = 0) {
    for (let i = 0; i < INV_SIZE; i++) {
        const source = slots?.[i];
        inv[i] = source && ITEMS[source.id]
            ? { id: source.id, count: Math.max(1, source.count) }
            : emptySlot();
    }
    sel = Math.min(HOTBAR_SIZE - 1, Math.max(0, selected));
    inventoryChanged();
}
