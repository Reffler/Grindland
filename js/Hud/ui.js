import { BLOCK_ICON, ICON } from "../Graphics/materials.js";
import {
    AIR, DIRT, GRASS, STONE, LOG, LEAVES, INFECTED_LEAVES,
    COBBLESTONE, CRAFTING_TABLE, FURNACE, CHEST, PLANKS,
    HARD, HOTBAR_SIZE, INV_SIZE,
    STATE_MAIN, STATE_PLAY,
} from "../constants.js";
import {
    inv, sel, updateSel, setHotbarCallback, inventoryChanged, countItem,
    canCraft, craft, maxStack, addToSlots,
} from "../Player/inventory.js";
import { BLOCKS, ITEMS, RECIPES } from "../registries.js";
import { adjustZoomLevel, renderer, updateFOV } from "../Graphics/setup.js";
import { keys, setSensitivity } from "../Player/input.js";
import { getChest, getFurnace, isFuel, isSmeltable, slotName } from "../Mechanics/stations.js";
import { spawnItem } from "../Mechanics/itemDrops.js";

const fpsEl = document.getElementById("fps");
const hotbarEl = document.getElementById("hotbar");
const itemNameEl = document.createElement("div");
itemNameEl.id = "selectedItemName";
document.body.appendChild(itemNameEl);
const mainMenuEl = document.getElementById("mainMenu");
const mainOptionsEl = document.getElementById("mainOptions");
const hudEl = document.getElementById("hud");
const crossEl = document.getElementById("cross");
const canvas = renderer.domElement;

const overlayEl = document.createElement("div");
overlayEl.id = "gameOverlay";
overlayEl.innerHTML = `
    <div class="game-overlay-shell">
        <aside id="inventoryControls" class="inventory-controls">
            <button class="btn" id="inventoryResumeBtn" type="button">Resume Game</button>
            <button class="btn" id="inventoryMenuBtn" type="button">Main Menu</button>
            <div class="settings-container">
                <div class="setting-row">
                    <div class="setting-label">Sensitivity <input type="number" id="sensInput" value="25" min="1" max="100"></div>
                    <input type="range" id="sensSlider" min="1" max="100" value="25">
                </div>
                <div class="setting-row">
                    <div class="setting-label">Field of View <input type="number" id="fovInput" value="70" min="30" max="110"></div>
                    <input type="range" id="fovSlider" min="30" max="110" value="70">
                </div>
            </div>
        </aside>
        <section class="game-window">
            <div id="stationPanel"></div>
            <div class="ui-columns">
                <section><div id="inventoryGrid" class="slot-grid inventory-grid"></div></section>
                <section id="recipeSection">
                    <input id="recipeSearch" type="search" placeholder="Search recipes…" autocomplete="off" aria-label="Search recipes">
                    <div id="recipeList" class="recipe-list"></div>
                </section>
            </div>
        </section>
    </div>`;
document.body.appendChild(overlayEl);

const toastEl = document.createElement("div");
toastEl.id = "toast";
document.body.appendChild(toastEl);

const jadeEl = document.createElement("div");
jadeEl.id = "jade";
jadeEl.innerHTML = '<span class="jade-icon"></span><div><strong></strong><small></small></div>';
document.body.appendChild(jadeEl);

const cursorStackEl = document.createElement("div");
cursorStackEl.id = "cursorStack";
cursorStackEl.hidden = true;
document.body.appendChild(cursorStackEl);

const gameCursorEl = document.createElement("div");
gameCursorEl.id = "gameCursor";
gameCursorEl.hidden = true;
document.body.appendChild(gameCursorEl);

const chatEl = document.createElement("div");
chatEl.id = "gameChat";
chatEl.innerHTML = '<div id="chatMessages"></div><input id="chatInput" maxlength="256" autocomplete="off" spellcheck="false" aria-label="Chat message">';
document.body.appendChild(chatEl);

const stationPanelEl = document.getElementById("stationPanel");
const inventoryGridEl = document.getElementById("inventoryGrid");
const recipeSectionEl = document.getElementById("recipeSection");
const recipeSearchEl = document.getElementById("recipeSearch");
const recipeListEl = document.getElementById("recipeList");
const inventoryControlsEl = document.getElementById("inventoryControls");
const chatMessagesEl = document.getElementById("chatMessages");
const chatInputEl = document.getElementById("chatInput");

export let gameState = STATE_MAIN;
let gameplayOverlay = null;
const cursorStack = { id: AIR, count: 0 };
let hoveredSlot = null;
let dragState = null;
let lastSlotClick = null;
const mockCursor = {
    x: innerWidth / 2,
    y: innerHeight / 2,
    hover: null,
    downTarget: null,
    range: null,
};
let suppressPause = false;
let playerRef = null;
let spawnRef = null;
let toastTimer = null;
let toastCleanupTimer = null;
let pickupNotice = null;
let itemNameTimer = null;
let lastNamedSlot = sel;
let chatOpen = false;
let cheatsEnabled = false;
let chatMessageTimer = null;

export function setPlayerAndSpawn(player, spawn) {
    playerRef = player;
    spawnRef = spawn;
}

export function isGameplayUIOpen() {
    return gameplayOverlay !== null || chatOpen;
}

function addChatMessage(message, failure = false) {
    const line = document.createElement("div");
    line.textContent = message;
    if (failure) line.className = "failure";
    chatMessagesEl.appendChild(line);
    while (chatMessagesEl.children.length > 8) chatMessagesEl.firstChild.remove();
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    chatEl.classList.add("recent");
    clearTimeout(chatMessageTimer);
    chatMessageTimer = setTimeout(() => chatEl.classList.remove("recent"), 4500);
}

function runChatCommand(raw) {
    const parts = raw.trim().toLowerCase().split(/\s+/);
    if (parts[0] === "/cheats" && (parts[1] === "0" || parts[1] === "1") && parts.length === 2) {
        cheatsEnabled = parts[1] === "1";
        addChatMessage(`Cheats ${cheatsEnabled ? "enabled" : "disabled"}`);
        return;
    }
    if (parts[0] === "/time" && parts[1] === "set" && (parts[2] === "day" || parts[2] === "night") && parts.length === 3) {
        if (!cheatsEnabled) {
            addChatMessage("Cheats are disabled", true);
            return;
        }
        window.dispatchEvent(new CustomEvent("game-command", {
            detail: { type: "time", value: parts[2] },
        }));
        addChatMessage(`Set time to ${parts[2]}`);
        return;
    }
    addChatMessage("Unknown command", true);
}

function submitChat() {
    const message = chatInputEl.value.trim();
    if (!message) return;
    if (message.startsWith("/")) runChatCommand(message);
    else addChatMessage(`<Player> ${message}`);
}

function openChat() {
    if (chatOpen || gameplayOverlay || gameState !== STATE_PLAY) return;
    chatOpen = true;
    suppressPause = true;
    chatEl.classList.add("open");
    document.body.classList.add("game-ui-open");
    crossEl.style.display = "none";
    if (document.pointerLockElement) document.exitPointerLock();
    chatInputEl.value = "";
    chatInputEl.focus();
}

function closeChat(relock = true) {
    if (!chatOpen) return;
    chatOpen = false;
    chatEl.classList.remove("open");
    if (!gameplayOverlay) document.body.classList.remove("game-ui-open");
    chatInputEl.blur();
    crossEl.style.display = gameState === STATE_PLAY && !gameplayOverlay ? "block" : "none";
    if (relock && gameState === STATE_PLAY && document.pointerLockElement !== canvas) requestLock();
}

function displayToast(message, failure = false) {
    toastEl.textContent = message;
    toastEl.className = failure ? "show message failure" : "show message";
    scheduleToastHide();
}

function scheduleToastHide() {
    clearTimeout(toastTimer);
    clearTimeout(toastCleanupTimer);
    toastTimer = setTimeout(() => {
        toastEl.classList.remove("show");
        pickupNotice = null;
        toastCleanupTimer = setTimeout(() => {
            if (toastEl.classList.contains("show")) return;
            toastEl.className = "";
            toastEl.replaceChildren();
        }, 300);
    }, 1600);
}

function displayPickupToast(id, count) {
    toastEl.replaceChildren();
    toastEl.appendChild(createItemIcon(id, "pickup-icon"));
    const amount = document.createElement("span");
    amount.textContent = `×${count}`;
    toastEl.appendChild(amount);
    toastEl.className = "show pickup";
    scheduleToastHide();
}

function showItemName(id) {
    const item = ITEMS[id];
    if (!item || gameState !== STATE_PLAY) return;
    itemNameEl.textContent = item.name;
    itemNameEl.classList.add("show");
    clearTimeout(itemNameTimer);
    itemNameTimer = setTimeout(() => itemNameEl.classList.remove("show"), 1400);
}

export function showToast(message, failure = false) {
    pickupNotice = null;
    displayToast(message, failure);
}

export function updateJadeTarget(id) {
    if (id === AIR || gameState !== STATE_PLAY || gameplayOverlay) {
        jadeEl.style.display = "none";
        return;
    }
    const block = BLOCKS[id];
    if (!block) return;
    jadeEl.querySelector(".jade-icon").replaceChildren(createItemIcon(id, "jade-item-icon"));
    jadeEl.querySelector("strong").textContent = block.name;
    let tool = "Hand";
    if (id === LEAVES || id === INFECTED_LEAVES) tool = "Crook";
    else if (id === DIRT || id === GRASS) tool = "Shovel";
    else if (id === LOG || id === PLANKS || id === CRAFTING_TABLE || id === CHEST) tool = "Axe";
    else if (id === STONE || id === COBBLESTONE || id === FURNACE) tool = "Pickaxe";
    jadeEl.querySelector("small").textContent = `Best tool: ${tool} · Break time: ${HARD[id] ?? 0.5}s`;
    jadeEl.style.display = "flex";
}

window.addEventListener("game-toast", (event) => {
    const detail = event.detail;
    if (detail?.type !== "pickup") {
        showToast(String(detail));
        return;
    }
    if (pickupNotice?.id === detail.id && toastEl.classList.contains("show")) {
        pickupNotice.count += detail.count;
    } else {
        pickupNotice = { id: detail.id, count: detail.count };
    }
    displayPickupToast(pickupNotice.id, pickupNotice.count);
    showItemName(detail.id);
});

export function setUIState(state) {
    gameState = state;
    if (state !== STATE_PLAY) {
        closeGameplayUI(false);
        closeChat(false);
    }
    mainMenuEl.style.display = state === STATE_MAIN ? "flex" : "none";
    mainOptionsEl.style.display = "none";
    hudEl.style.display = state === STATE_MAIN ? "none" : "block";
    hotbarEl.style.display = state === STATE_MAIN ? "none" : "flex";
    if (state !== STATE_PLAY) {
        itemNameEl.classList.remove("show");
        clearTimeout(itemNameTimer);
    }
    crossEl.style.display = state === STATE_PLAY && !gameplayOverlay ? "block" : "none";
    if (state !== STATE_PLAY) updateJadeTarget(AIR);

    if (state === STATE_MAIN && playerRef && spawnRef) {
        playerRef.pos.set(spawnRef.x, spawnRef.y, spawnRef.z);
        playerRef.vel.set(0, 0, 0);
        playerRef.yaw = 0;
        playerRef.pitch = 0;
    }
}

export function drawHotbar() {
    hotbarEl.innerHTML = "";
    for (let i = 0; i < HOTBAR_SIZE; i++) hotbarEl.appendChild(makeSlot(inv[i], i === sel));
    if (sel !== lastNamedSlot) {
        lastNamedSlot = sel;
        showItemName(inv[sel]?.id);
    }
}

function makeSlot(slot, selected = false, ref = null) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = `slot${selected ? " sel" : ""}`;
    renderSlotContents(element, slot);
    if (ref) {
        element.dataset.container = ref.container;
        element.dataset.index = ref.index;
        const key = refKey(ref);
        element.addEventListener("pointerdown", (event) => beginSlotAction(event, ref));
        element.addEventListener("pointerenter", () => {
            hoveredSlot = ref;
            if (dragState && !dragState.keys.has(key)) {
                dragState.keys.add(key);
                dragState.refs.push(ref);
                dragState.slots.set(key, { ...resolveSlot(ref) });
                if (dragState.pickedOnDown) releasePickedStack(ref);
                else updateDragDistribution();
            }
        });
        element.addEventListener("pointerleave", () => {
            if (hoveredSlot && refKey(hoveredSlot) === key) hoveredSlot = null;
        });
        element.addEventListener("contextmenu", (event) => event.preventDefault());
    } else element.tabIndex = -1;
    return element;
}

function renderSlotContents(element, slot) {
    element.title = slotName(slot);
    element.replaceChildren();
    if (slot.id !== AIR) {
        element.appendChild(createItemIcon(slot.id, "sw"));
        if (slot.count > 1) {
            const count = document.createElement("span");
            count.className = "cnt";
            count.textContent = slot.count;
            element.appendChild(count);
        }
    } else {
        const empty = document.createElement("span");
        empty.className = "sw empty";
        element.appendChild(empty);
    }
}

function createItemIcon(id, className) {
    const icon = document.createElement("span");
    icon.className = `item-icon ${className}`;
    const faces = BLOCK_ICON[id];
    if (!faces) {
        icon.style.backgroundImage = `url(${ICON[id] || ICON[DIRT]})`;
        return icon;
    }
    icon.classList.add("cube-item-icon");
    const model = document.createElement("span");
    model.className = "cube-model";
    for (const [face, texture] of Object.entries(faces)) {
        const side = document.createElement("i");
        side.className = `cube-face cube-${face}`;
        side.style.backgroundImage = `url(${texture})`;
        model.appendChild(side);
    }
    icon.appendChild(model);
    return icon;
}

function refKey(ref) {
    return `${ref.container}:${ref.index}`;
}

function containerSlots(name) {
    if (name === "player") return inv;
    if (name === "chest") return getChest(gameplayOverlay.key);
    if (name === "furnace") {
        const furnace = getFurnace(gameplayOverlay.key);
        return [furnace.input, furnace.fuel, furnace.output];
    }
    return [];
}

function targetAccepts(container, index, id) {
    if (id === AIR) return true;
    if (container !== "furnace") return true;
    if (index === 0) return isSmeltable(id);
    if (index === 1) return isFuel(id);
    return false;
}

function resolveSlot(ref) {
    return containerSlots(ref.container)[ref.index];
}

function clearStack(stack) {
    stack.id = AIR;
    stack.count = 0;
}

function slotClick(ref, button) {
    const target = resolveSlot(ref);
    if (!target) return;
    if (cursorStack.id === AIR) {
        if (target.id === AIR) return;
        const amount = button === 2 ? Math.ceil(target.count / 2) : target.count;
        cursorStack.id = target.id;
        cursorStack.count = amount;
        target.count -= amount;
        if (!target.count) clearStack(target);
        return;
    }
    if (!targetAccepts(ref.container, ref.index, cursorStack.id)) return;
    if (button === 2) {
        if (target.id === AIR) {
            target.id = cursorStack.id;
            target.count = 1;
            cursorStack.count--;
        } else if (target.id === cursorStack.id && target.count < maxStack(target.id)) {
            target.count++;
            cursorStack.count--;
        }
    } else if (target.id === AIR) {
        Object.assign(target, cursorStack);
        clearStack(cursorStack);
    } else if (target.id === cursorStack.id) {
        const moved = Math.min(cursorStack.count, maxStack(target.id) - target.count);
        target.count += moved;
        cursorStack.count -= moved;
    } else {
        const old = { ...target };
        Object.assign(target, cursorStack);
        Object.assign(cursorStack, old);
    }
    if (!cursorStack.count) clearStack(cursorStack);
}

function moveIntoRefs(source, refs) {
    movePasses:
    for (const emptyPass of [false, true]) {
        for (const ref of refs) {
            if (!source.count) break movePasses;
            if (!targetAccepts(ref.container, ref.index, source.id)) continue;
            const target = resolveSlot(ref);
            if (!target || target === source) continue;
            if (!emptyPass && target.id === source.id && target.count < maxStack(source.id)) {
                const moved = Math.min(source.count, maxStack(source.id) - target.count);
                target.count += moved;
                source.count -= moved;
            } else if (emptyPass && target.id === AIR) {
                const moved = Math.min(source.count, maxStack(source.id));
                target.id = source.id;
                target.count = moved;
                source.count -= moved;
            }
        }
    }
    if (!source.count) clearStack(source);
}

function visibleRefs() {
    const refs = playerRefs(0, INV_SIZE);
    if (gameplayOverlay.type === "chest") {
        getChest(gameplayOverlay.key).forEach((_, index) => refs.push({ container: "chest", index }));
    } else if (gameplayOverlay.type === "furnace") {
        for (let index = 0; index < 3; index++) refs.push({ container: "furnace", index });
    }
    return refs;
}

function collectMatching(ref) {
    const clicked = resolveSlot(ref);
    if (cursorStack.id === AIR && clicked?.id !== AIR) slotClick(ref, 0);
    if (cursorStack.id === AIR) return;
    for (const sourceRef of visibleRefs()) {
        const source = resolveSlot(sourceRef);
        if (source.id !== cursorStack.id) continue;
        const moved = Math.min(source.count, maxStack(cursorStack.id) - cursorStack.count);
        cursorStack.count += moved;
        source.count -= moved;
        if (!source.count) clearStack(source);
        if (cursorStack.count >= maxStack(cursorStack.id)) break;
    }
}

function playerRefs(start, end) {
    return Array.from({ length: end - start }, (_, offset) => ({ container: "player", index: start + offset }));
}

function quickMove(ref) {
    const source = resolveSlot(ref);
    if (!source || source.id === AIR) return;
    let destinations;
    if (ref.container !== "player") {
        destinations = [...playerRefs(HOTBAR_SIZE, INV_SIZE), ...playerRefs(0, HOTBAR_SIZE)];
    } else if (gameplayOverlay.type === "chest") {
        destinations = getChest(gameplayOverlay.key).map((_, index) => ({ container: "chest", index }));
    } else if (gameplayOverlay.type === "furnace" && isSmeltable(source.id)) {
        destinations = [{ container: "furnace", index: 0 }];
    } else if (gameplayOverlay.type === "furnace" && isFuel(source.id)) {
        destinations = [{ container: "furnace", index: 1 }];
    } else {
        destinations = ref.index < HOTBAR_SIZE
            ? playerRefs(HOTBAR_SIZE, INV_SIZE)
            : playerRefs(0, HOTBAR_SIZE);
    }
    moveIntoRefs(source, destinations);
}

function distributeCursor(button, refs) {
    const eligible = refs.filter((ref) => {
        const target = resolveSlot(ref);
        return targetAccepts(ref.container, ref.index, cursorStack.id) &&
            (target.id === AIR || (target.id === cursorStack.id && target.count < maxStack(target.id)));
    });
    if (!eligible.length) return;
    if (button === 2) {
        for (const ref of eligible) {
            if (!cursorStack.count) break;
            const target = resolveSlot(ref);
            if (target.id === AIR) target.id = cursorStack.id;
            target.count++;
            cursorStack.count--;
        }
    } else {
        while (cursorStack.count) {
            let moved = false;
            for (const ref of eligible) {
                const target = resolveSlot(ref);
                if (target.count >= maxStack(cursorStack.id)) continue;
                if (target.id === AIR) target.id = cursorStack.id;
                target.count++;
                cursorStack.count--;
                moved = true;
                if (!cursorStack.count) break;
            }
            if (!moved) break;
        }
    }
    if (!cursorStack.count) clearStack(cursorStack);
}

function updateDragDistribution() {
    if (!dragState?.cursorStartedFull || dragState.refs.length < 2) return;
    cursorStack.id = dragState.cursor.id;
    cursorStack.count = dragState.cursor.count;
    for (const ref of dragState.refs) Object.assign(resolveSlot(ref), dragState.slots.get(refKey(ref)));
    distributeCursor(dragState.button, dragState.refs);
    dragState.distributed = true;
    for (const ref of dragState.refs) refreshSlot(ref);
    drawHotbar();
    updateCursorStack();
}

function refreshSlot(ref) {
    const element = overlayEl.querySelector(`.slot[data-container="${ref.container}"][data-index="${ref.index}"]`);
    if (element) renderSlotContents(element, resolveSlot(ref));
}

function releasePickedStack(ref) {
    if (dragState.released || !targetAccepts(ref.container, ref.index, cursorStack.id)) return;
    const target = resolveSlot(ref);
    const before = `${cursorStack.id}:${cursorStack.count}:${target.id}:${target.count}`;
    slotClick(ref, 0);
    if (before === `${cursorStack.id}:${cursorStack.count}:${target.id}:${target.count}`) return;
    dragState.released = true;
    refreshSlot(ref);
    drawHotbar();
    updateCursorStack();
}

function beginSlotAction(event, ref) {
    if (event.button > 2) return;
    event.preventDefault();
    hoveredSlot = ref;
    if (event.shiftKey) {
        quickMove(ref);
        inventoryChanged();
        return;
    }
    let pickedOnDown = false;
    if (cursorStack.id === AIR) {
        slotClick(ref, event.button);
        pickedOnDown = cursorStack.id !== AIR;
        if (pickedOnDown) {
            refreshSlot(ref);
            drawHotbar();
            updateCursorStack();
        }
    }
    dragState = {
        button: event.button,
        pickedOnDown,
        cursorStartedFull: !pickedOnDown && cursorStack.id !== AIR,
        source: ref,
        refs: [ref],
        keys: new Set([refKey(ref)]),
        slots: new Map([[refKey(ref), { ...resolveSlot(ref) }]]),
        cursor: { ...cursorStack },
        distributed: false,
        released: false,
    };
    overlayEl.classList.add("dragging-stack");
}

function swapWithHotbar(ref, hotbarIndex) {
    const targetRef = { container: "player", index: hotbarIndex };
    if (refKey(ref) === refKey(targetRef)) return;
    const source = resolveSlot(ref);
    const target = resolveSlot(targetRef);
    if (!source || !target || !targetAccepts(ref.container, ref.index, target.id)) return;
    const old = { ...source };
    Object.assign(source, target);
    Object.assign(target, old);
}

function updateCursorStack() {
    cursorStackEl.hidden = cursorStack.id === AIR;
    if (cursorStackEl.hidden) return;
    cursorStackEl.innerHTML = "";
    cursorStackEl.appendChild(createItemIcon(cursorStack.id, "cursor-item-icon"));
    if (cursorStack.count > 1) {
        const count = document.createElement("span");
        count.textContent = cursorStack.count;
        cursorStackEl.appendChild(count);
    }
}

function positionGameCursor() {
    gameCursorEl.style.left = `${mockCursor.x}px`;
    gameCursorEl.style.top = `${mockCursor.y}px`;
    cursorStackEl.style.left = `${mockCursor.x + 12}px`;
    cursorStackEl.style.top = `${mockCursor.y + 12}px`;
}

function targetAtGameCursor() {
    const raw = document.elementFromPoint(mockCursor.x, mockCursor.y);
    if (raw === overlayEl) return raw;
    return raw?.closest?.(".slot, button, input, textarea, .recipe-list") || raw;
}

function updateMockHover() {
    const next = targetAtGameCursor();
    if (next === mockCursor.hover) return;
    mockCursor.hover?.dispatchEvent(new PointerEvent("pointerleave", { bubbles: false }));
    next?.dispatchEvent(new PointerEvent("pointerenter", { bubbles: false }));
    mockCursor.hover = next;
}

function setRangeFromCursor(input) {
    const rect = input.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (mockCursor.x - rect.left) / rect.width));
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const step = Number(input.step || 1);
    input.value = Math.round((min + (max - min) * ratio) / step) * step;
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

function dropCursor(amount = cursorStack.count) {
    if (cursorStack.id === AIR || !playerRef) return;
    const count = Math.min(amount, cursorStack.count);
    const direction = playerRef.pos.clone().set(-Math.sin(playerRef.yaw), 0, -Math.cos(playerRef.yaw));
    const position = playerRef.pos.clone();
    position.y += 1.1;
    position.addScaledVector(direction, 0.55);
    spawnItem(cursorStack.id, count, position, {
        noOffset: true,
        pickupDelay: 1,
        velocity: direction.multiplyScalar(2).setY(2.4),
    });
    cursorStack.count -= count;
    if (!cursorStack.count) clearStack(cursorStack);
}

function returnCursorStack() {
    if (cursorStack.id === AIR) return;
    const id = cursorStack.id;
    const left = addToSlots(inv, id, cursorStack.count);
    cursorStack.count = left;
    if (left) dropCursor(left);
    clearStack(cursorStack);
    inventoryChanged();
}

function renderInventory() {
    inventoryGridEl.innerHTML = "";
    for (let i = 0; i < INV_SIZE; i++) {
        inventoryGridEl.appendChild(makeSlot(inv[i], i === sel, { container: "player", index: i }));
    }
}

function recipeTooltip(recipe) {
    return Object.entries(recipe.inputs).map(([id, required]) => {
        const owned = countItem(id);
        return `${ITEMS[id].name}: ${required} required, ${owned} owned, ${Math.max(0, required - owned)} missing`;
    }).join("\n");
}

function renderRecipes(station) {
    recipeListEl.innerHTML = "";
    const stations = station === "crafting_table"
        ? new Set(["inventory", "crafting_table"])
        : new Set([station]);
    const search = recipeSearchEl.value.trim().toLowerCase();
    const recipes = RECIPES.filter((entry) => {
        if (!stations.has(entry.station)) return false;
        if (!search) return true;
        const names = [ITEMS[entry.output.id].name, ...Object.keys(entry.inputs).map((id) => ITEMS[id].name)];
        return names.some((name) => name.toLowerCase().includes(search));
    });
    for (const recipe of recipes) {
        const available = canCraft(recipe);
        const button = document.createElement("button");
        button.className = "recipe";
        button.disabled = !available;
        button.title = recipeTooltip(recipe);
        button.appendChild(createItemIcon(recipe.output.id, "recipe-output-icon"));
        const copy = document.createElement("span");
        copy.className = "recipe-copy";
        const output = document.createElement("strong");
        output.innerHTML = `${ITEMS[recipe.output.id].name} <small>×${recipe.output.count}</small>`;
        copy.appendChild(output);
        const requirements = document.createElement("span");
        requirements.className = "recipe-requirements";
        const uses = document.createElement("b");
        uses.textContent = "Uses:";
        requirements.appendChild(uses);
        for (const [id, required] of Object.entries(recipe.inputs)) {
            const owned = countItem(id);
            const state = owned >= required ? "available" : "missing";
            const requirement = document.createElement("span");
            requirement.className = `requirement ${state}`;
            requirement.appendChild(createItemIcon(Number(id), "requirement-icon"));
            const name = document.createElement("span");
            name.textContent = `${ITEMS[id].name} ×${required}`;
            requirement.appendChild(name);
            const amount = document.createElement("em");
            amount.textContent = `${owned}/${required}`;
            requirement.appendChild(amount);
            requirements.appendChild(requirement);
        }
        copy.appendChild(requirements);
        button.appendChild(copy);
        button.addEventListener("click", (event) => {
            let crafted = 0;
            do {
                if (!craft(recipe)) break;
                crafted += recipe.output.count;
            } while (event.shiftKey);
            if (crafted) showToast(`Crafted ${crafted} ${ITEMS[recipe.output.id].name}`);
            else showToast("Missing materials or inventory space", true);
            renderOverlay();
        });
        recipeListEl.appendChild(button);
    }
    if (!recipes.length) {
        const empty = document.createElement("p");
        empty.className = "no-recipes";
        empty.textContent = "No matching recipes";
        recipeListEl.appendChild(empty);
    }
}

function renderFurnace() {
    const furnace = getFurnace(gameplayOverlay.key);
    const progress = furnace.input.id === AIR ? 0 : Math.min(100, (furnace.progress / 8) * 100);
    const burn = furnace.burnTotal ? Math.min(100, (furnace.burnRemaining / furnace.burnTotal) * 100) : 0;
    stationPanelEl.innerHTML = `
        <div class="furnace-layout">
            <div class="station-slot" data-index="0"></div>
            <div class="meters"><span>Smelt</span><i><b style="width:${progress}%"></b></i><span>Fuel</span><i><b style="width:${burn}%"></b></i></div>
            <div class="station-slot" data-index="2"></div>
            <div class="station-slot fuel-slot" data-index="1"></div>
        </div>`;
    for (const host of stationPanelEl.querySelectorAll(".station-slot")) {
        const index = Number(host.dataset.index);
        host.appendChild(makeSlot([furnace.input, furnace.fuel, furnace.output][index], false, { container: "furnace", index }));
    }
}

function renderChest() {
    stationPanelEl.innerHTML = '<h3>Chest Storage</h3><div class="slot-grid chest-grid"></div>';
    const grid = stationPanelEl.querySelector(".chest-grid");
    getChest(gameplayOverlay.key).forEach((slot, index) => {
        grid.appendChild(makeSlot(slot, false, { container: "chest", index }));
    });
}

function renderOverlay() {
    if (!gameplayOverlay) return;
    overlayEl.classList.toggle("inventory-menu", gameplayOverlay.type === "inventory");
    renderInventory();
    stationPanelEl.innerHTML = "";
    recipeSectionEl.style.display = "none";
    if (gameplayOverlay.type === "inventory") {
        inventoryControlsEl.style.display = "flex";
        recipeSectionEl.style.display = "block";
        renderRecipes("inventory");
    } else if (gameplayOverlay.type === "crafting_table") {
        inventoryControlsEl.style.display = "none";
        recipeSectionEl.style.display = "block";
        renderRecipes("crafting_table");
    } else if (gameplayOverlay.type === "furnace") {
        inventoryControlsEl.style.display = "none";
        renderFurnace();
    } else if (gameplayOverlay.type === "chest") {
        inventoryControlsEl.style.display = "none";
        renderChest();
    }
    updateCursorStack();
}

export function openInventory() {
    if (gameState !== STATE_PLAY) return;
    openGameplayUI("inventory");
}

export function openStation(type, key) {
    if (gameState !== STATE_PLAY) return;
    openGameplayUI(type, key);
}

function openGameplayUI(type, key = null) {
    gameplayOverlay = { type, key };
    recipeSearchEl.value = "";
    dragState = null;
    hoveredSlot = null;
    suppressPause = true;
    overlayEl.style.display = "grid";
    document.body.classList.add("game-ui-open");
    gameCursorEl.hidden = document.pointerLockElement !== canvas;
    positionGameCursor();
    updateMockHover();
    crossEl.style.display = "none";
    updateJadeTarget(AIR);
    renderOverlay();
    window.dispatchEvent(new Event("game-ui-opened"));
}

export function closeGameplayUI(relock = true) {
    if (!gameplayOverlay) return;
    returnCursorStack();
    gameplayOverlay = null;
    dragState = null;
    hoveredSlot = null;
    overlayEl.style.display = "none";
    document.body.classList.remove("game-ui-open");
    gameCursorEl.hidden = true;
    crossEl.style.display = gameState === STATE_PLAY ? "block" : "none";
    if (relock && gameState === STATE_PLAY && document.pointerLockElement !== canvas) {
        suppressPause = true;
        requestLock();
    }
}

export function requestLock() {
    canvas.requestPointerLock().catch(() => {
        suppressPause = false;
    });
}

export function initUI() {
    setHotbarCallback(() => {
        drawHotbar();
        if (gameplayOverlay) renderOverlay();
    });
    drawHotbar();
    setUIState(STATE_MAIN);

    document.getElementById("playBtn").addEventListener("click", () => {
        setUIState(STATE_PLAY);
        requestLock();
    });
    document.getElementById("optionsBtn").addEventListener("click", () => {
        mainMenuEl.style.display = "none";
        mainOptionsEl.style.display = "flex";
    });
    document.getElementById("optionsBackBtn").addEventListener("click", () => {
        mainOptionsEl.style.display = "none";
        mainMenuEl.style.display = "flex";
    });
    document.getElementById("inventoryResumeBtn").addEventListener("click", () => closeGameplayUI(true));
    document.getElementById("inventoryMenuBtn").addEventListener("click", () => {
        suppressPause = true;
        if (document.pointerLockElement) document.exitPointerLock();
        setUIState(STATE_MAIN);
    });
    document.addEventListener("pointerlockchange", () => {
        if (document.pointerLockElement === canvas) {
            gameCursorEl.hidden = !gameplayOverlay;
            suppressPause = false;
            setUIState(STATE_PLAY);
        } else {
            gameCursorEl.hidden = true;
            suppressPause = false;
        }
    });

    document.addEventListener("keydown", (event) => {
        if (chatOpen) {
            if (event.code === "Enter") {
                event.preventDefault();
                event.stopImmediatePropagation();
                submitChat();
                closeChat(true);
            } else if (event.code === "Escape") {
                event.preventDefault();
                event.stopImmediatePropagation();
                closeChat(true);
            }
            return;
        }
        if (event.code === "KeyT" && gameState === STATE_PLAY && !gameplayOverlay) {
            event.preventDefault();
            event.stopImmediatePropagation();
            openChat();
            return;
        }
        const typingInField = gameplayOverlay && event.target.matches?.("input, textarea");
        if (typingInField) return;
        const hotbarKeys = {
            Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4,
            Digit6: 5, Digit7: 6, Digit8: 7, Digit9: 8, Digit0: 9,
        };
        if (gameplayOverlay && hoveredSlot && event.code in hotbarKeys) {
            event.preventDefault();
            swapWithHotbar(hoveredSlot, hotbarKeys[event.code]);
            inventoryChanged();
            return;
        }
        if (gameplayOverlay && event.code === "KeyQ" && !event.repeat) {
            event.preventDefault();
            if (cursorStack.id !== AIR) {
                dropCursor(event.ctrlKey ? cursorStack.count : 1);
            } else if (hoveredSlot) {
                const source = resolveSlot(hoveredSlot);
                if (source?.id !== AIR) {
                    cursorStack.id = source.id;
                    cursorStack.count = event.ctrlKey ? source.count : 1;
                    source.count -= cursorStack.count;
                    if (!source.count) clearStack(source);
                    dropCursor(cursorStack.count);
                }
            }
            inventoryChanged();
            return;
        }
        if (event.code === "KeyE" && gameState === STATE_PLAY) {
            event.preventDefault();
            if (gameplayOverlay) closeGameplayUI(true);
            else openInventory();
        }
    }, true);

    document.addEventListener("pointerup", (event) => {
        if (!dragState || event.button !== dragState.button) return;
        const finished = dragState;
        dragState = null;
        overlayEl.classList.remove("dragging-stack");
        if (finished.pickedOnDown) {
            if (!finished.released && hoveredSlot && refKey(hoveredSlot) !== refKey(finished.source)) {
                slotClick(hoveredSlot, 0);
            }
            lastSlotClick = { key: refKey(finished.source), time: performance.now() };
        } else if (finished.distributed) {
            // Slot contents already updated while dragging.
        } else {
            const ref = finished.refs[0];
            const now = performance.now();
            const doubleClick = finished.button === 0 && lastSlotClick?.key === refKey(ref) && now - lastSlotClick.time < 280;
            if (doubleClick) {
                collectMatching(ref);
                lastSlotClick = null;
            } else {
                slotClick(ref, finished.button);
                lastSlotClick = { key: refKey(ref), time: now };
            }
        }
        inventoryChanged();
    });

    document.addEventListener("pointermove", (event) => {
        if (gameplayOverlay && document.pointerLockElement === canvas) return;
        cursorStackEl.style.left = `${event.clientX + 12}px`;
        cursorStackEl.style.top = `${event.clientY + 12}px`;
    });

    document.addEventListener("mousemove", (event) => {
        if (!event.isTrusted || !gameplayOverlay || document.pointerLockElement !== canvas) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        mockCursor.x = Math.max(0, Math.min(innerWidth - 1, mockCursor.x + event.movementX));
        mockCursor.y = Math.max(0, Math.min(innerHeight - 1, mockCursor.y + event.movementY));
        positionGameCursor();
        if (mockCursor.range) setRangeFromCursor(mockCursor.range);
        updateMockHover();
    }, true);

    document.addEventListener("mousedown", (event) => {
        if (!event.isTrusted || !gameplayOverlay || document.pointerLockElement !== canvas) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const target = targetAtGameCursor();
        mockCursor.downTarget = target;
        const range = target?.closest?.('input[type="range"]');
        if (range) {
            mockCursor.range = range;
            setRangeFromCursor(range);
        }
        target?.closest?.("input, textarea")?.focus();
        target?.dispatchEvent(new PointerEvent("pointerdown", {
            bubbles: true, button: event.button, buttons: 1 << event.button,
            clientX: mockCursor.x, clientY: mockCursor.y,
        }));
    }, true);

    document.addEventListener("mouseup", (event) => {
        if (!event.isTrusted || !gameplayOverlay || document.pointerLockElement !== canvas) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const target = targetAtGameCursor();
        target?.dispatchEvent(new PointerEvent("pointerup", {
            bubbles: true, button: event.button, buttons: 0,
            clientX: mockCursor.x, clientY: mockCursor.y,
        }));
        if (event.button === 0 && target && target === mockCursor.downTarget) {
            target.closest?.("button")?.click();
        }
        mockCursor.downTarget = null;
        mockCursor.range = null;
    }, true);

    document.addEventListener("wheel", (event) => {
        if (!gameplayOverlay || document.pointerLockElement !== canvas) return;
        const target = targetAtGameCursor();
        const scrollable = target?.closest?.(".recipe-list, .game-window");
        if (!scrollable) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        scrollable.scrollTop += event.deltaY;
    }, { capture: true, passive: false });

    overlayEl.addEventListener("pointerdown", (event) => {
        if (event.target !== overlayEl || event.target.closest(".game-window")) return;
        event.preventDefault();
        if (cursorStack.id === AIR) {
            closeGameplayUI(true);
            return;
        }
        dropCursor(event.button === 2 ? 1 : cursorStack.count);
        inventoryChanged();
    });
    overlayEl.addEventListener("contextmenu", (event) => event.preventDefault());
    recipeSearchEl.addEventListener("input", () => {
        if (gameplayOverlay?.type === "inventory") renderRecipes("inventory");
        else if (gameplayOverlay?.type === "crafting_table") renderRecipes("crafting_table");
    });

    canvas.addEventListener("mousedown", () => {
        if (gameState === STATE_PLAY && !gameplayOverlay && !document.pointerLockElement) {
            requestLock();
        }
    }, true);

    const sensSliders = [document.getElementById("sensSlider"), document.getElementById("mainSensSlider")];
    const sensInputs = [document.getElementById("sensInput"), document.getElementById("mainSensInput")];
    const updateSens = (value) => {
        const v = Math.min(100, Math.max(1, Number(value) || 1));
        for (const slider of sensSliders) slider.value = v;
        for (const input of sensInputs) input.value = v;
        setSensitivity(v * 0.0001);
    };
    for (const slider of sensSliders) slider.addEventListener("input", (event) => updateSens(event.target.value));
    for (const input of sensInputs) input.addEventListener("input", (event) => updateSens(event.target.value));

    const fovSliders = [document.getElementById("fovSlider"), document.getElementById("mainFovSlider")];
    const fovInputs = [document.getElementById("fovInput"), document.getElementById("mainFovInput")];
    const updateFovVal = (value) => {
        const v = Math.min(110, Math.max(30, Number(value) || 30));
        for (const slider of fovSliders) slider.value = v;
        for (const input of fovInputs) input.value = v;
        updateFOV(v);
    };
    for (const slider of fovSliders) slider.addEventListener("input", (event) => updateFovVal(event.target.value));
    for (const input of fovInputs) input.addEventListener("input", (event) => updateFovVal(event.target.value));

    canvas.addEventListener("wheel", (event) => {
        if (gameState !== STATE_PLAY || gameplayOverlay) return;
        const direction = Math.sign(event.deltaY);
        if (!direction) return;
        if (keys.KeyC) {
            event.preventDefault();
            adjustZoomLevel(direction);
            return;
        }
        updateSel(sel + direction);
    }, { passive: false });
}

let stationRefresh = 0;
window.addEventListener("station-tick", () => {
    if (gameplayOverlay?.type !== "furnace" || performance.now() - stationRefresh < 200) return;
    stationRefresh = performance.now();
    renderOverlay();
});

export function updateFPS(frames, acc) {
    fpsEl.textContent = (frames / acc).toFixed(0);
}
