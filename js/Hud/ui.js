import { BLOCK_ICON, ICON } from "../Graphics/materials.js";
import {
    AIR, DIRT, GRASS, STONE, LOG, LEAVES, INFECTED_LEAVES,
    COBBLESTONE, CRAFTING_TABLE, FURNACE, CHEST, PLANKS, CROOK, STRING,
    HARD, HOTBAR_SIZE, INV_SIZE, SHOP, SHOPPER,
    STATE_MAIN, STATE_PLAY,
} from "../constants.js";
import {
    inv, sel, updateSel, setHotbarCallback, setSelectionCallback, inventoryChanged, countItem,
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
        <nav class="inventory-actions" aria-label="Game actions">
            <div class="inventory-actions-wood">
                <button class="inventory-action" id="inventorySettingsBtn" type="button" title="Settings" aria-label="Settings">⚙</button>
                <button class="inventory-action" id="inventoryMenuBtn" type="button" title="Main menu" aria-label="Main menu">⌂</button>
            </div>
        </nav>
        <section id="gameSettingsWindow" class="game-window settings-window" hidden>
            <h3>Settings</h3>
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
            <button class="btn" id="inventorySettingsBackBtn" type="button">Back</button>
        </section>
        <section id="gameplayWindow" class="game-window">
            <div class="inventory-workspace">
                <div class="inventory-content">
                    <div id="stationPanel"></div>
                    <div class="ui-columns">
                        <section class="inventory-center"><div class="inventory-panel-content"><h3 id="playerInventoryTitle" hidden>Inventory</h3><div id="inventoryGrid" class="inventory-stack"></div></div></section>
                        <aside id="recipeSection">
                            <div class="recipe-panel-content">
                                <h3 id="recipeTitle" hidden>Crafting Table</h3>
                                <nav id="inventoryTabs" class="inventory-tabs" aria-label="Inventory categories">
                                    <button class="inventory-tab active" type="button" data-category="all" title="All recipes" aria-label="All recipes"></button>
                                    <button class="inventory-tab" type="button" data-category="blocks" title="Blocks" aria-label="Blocks"></button>
                                    <button class="inventory-tab" type="button" data-category="tools" title="Tools" aria-label="Tools"></button>
                                    <button class="inventory-tab" type="button" data-category="items" title="Items" aria-label="Items"></button>
                                </nav>
                                <div id="selectedRecipe" class="selected-recipe"></div>
                                <div id="selectedItemDetails" class="item-details"></div>
                                <input id="recipeSearch" type="search" placeholder="Search recipes…" autocomplete="off" aria-label="Search recipes">
                                <div id="recipeList" class="recipe-list"></div>
                            </div>
                        </aside>
                    </div>
                </div>
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
const inventoryTabsEl = document.getElementById("inventoryTabs");
const playerInventoryTitleEl = document.getElementById("playerInventoryTitle");
const recipeTitleEl = document.getElementById("recipeTitle");
const selectedItemDetailsEl = document.getElementById("selectedItemDetails");
const selectedRecipeEl = document.getElementById("selectedRecipe");
const gameplayWindowEl = document.getElementById("gameplayWindow");
const gameSettingsWindowEl = document.getElementById("gameSettingsWindow");
const chatMessagesEl = document.getElementById("chatMessages");
const chatInputEl = document.getElementById("chatInput");

export let gameState = STATE_MAIN;
let gameplayOverlay = null;
const cursorStack = { id: AIR, count: 0 };
let hoveredSlot = null;
let dragState = null;
let lastSlotClick = null;
let settingsOpen = false;
let recipeCategory = "all";
let detailItemId = AIR;
let selectedRecipeId = null;
let lastUsedRecipeId = null;
let shiftTransferState = null;
let shiftHeld = false;
const transferFeedbackKeys = new Set();
const mockCursor = {
    x: innerWidth / 2,
    y: innerHeight / 2,
    hover: null,
    downTarget: null,
    range: null,
};
let suppressPause = false;
let rawPointerLock = false;
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
    const giveId = { shop: SHOP, shopper: SHOPPER }[parts[1]];
    if (parts[0] === "/give" && giveId && (parts.length === 2 || parts.length === 3)) {
        if (!cheatsEnabled) {
            addChatMessage("Cheats are disabled", true);
            return;
        }
        const amount = parts.length === 3 ? Number(parts[2]) : 1;
        if (!Number.isInteger(amount) || amount < 1) {
            addChatMessage("Invalid amount", true);
            return;
        }
        const left = addToSlots(inv, giveId, amount);
        inventoryChanged();
        addChatMessage(left ? `Inventory full (${left} not given)` : `Given ${parts[1]} ×${amount}`);
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
    chatInputEl.value = "";
    chatInputEl.focus();
}

function closeChat() {
    if (!chatOpen) return;
    chatOpen = false;
    chatEl.classList.remove("open");
    if (!gameplayOverlay) document.body.classList.remove("game-ui-open");
    chatInputEl.blur();
    crossEl.style.display = gameState === STATE_PLAY && !gameplayOverlay ? "block" : "none";
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
        closeGameplayUI();
        closeChat();
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

function updateHotbarSelection() {
    hotbarEl.children[lastNamedSlot]?.classList.remove("sel");
    hotbarEl.children[sel]?.classList.add("sel");
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
        if (transferFeedbackKeys.has(key)) element.classList.add("slot-transfer");
        element.addEventListener("pointerdown", (event) => beginSlotAction(event, ref));
        element.addEventListener("pointerenter", () => {
            hoveredSlot = ref;
            detailItemId = resolveSlot(ref)?.id ?? AIR;
            renderItemDetails();
            if (shiftTransferState && shiftHeld && !shiftTransferState.keys.has(key)) {
                shiftTransferState.keys.add(key);
                transferSlot(ref);
                return;
            }
            if (dragState && !dragState.keys.has(key)) {
                dragState.keys.add(key);
                dragState.refs.push(ref);
                dragState.slots.set(key, { ...resolveSlot(ref) });
                element.classList.add("drag-target");
                if (dragState.pickedOnDown) releasePickedStack(ref);
                else updateDragDistribution();
            }
        });
        element.addEventListener("pointerleave", () => {
            if (hoveredSlot && refKey(hoveredSlot) === key) hoveredSlot = null;
            detailItemId = inv[sel]?.id ?? AIR;
            renderItemDetails();
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
    let firstDestination = null;
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
                if (moved && !firstDestination) firstDestination = ref;
            } else if (emptyPass && target.id === AIR) {
                const moved = Math.min(source.count, maxStack(source.id));
                target.id = source.id;
                target.count = moved;
                source.count -= moved;
                if (moved && !firstDestination) firstDestination = ref;
            }
        }
    }
    if (!source.count) clearStack(source);
    return firstDestination;
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
    return moveIntoRefs(source, destinations);
}

function animateSlotTransfer(sourceRef, destinationRef, id) {
    if (!destinationRef || id === AIR) return;
    const source = overlayEl.querySelector(`.slot[data-container="${sourceRef.container}"][data-index="${sourceRef.index}"]`);
    const destination = overlayEl.querySelector(`.slot[data-container="${destinationRef.container}"][data-index="${destinationRef.index}"]`);
    if (!source || !destination) return;
    const from = source.getBoundingClientRect();
    const to = destination.getBoundingClientRect();
    const ghost = createItemIcon(id, "transfer-ghost");
    ghost.style.left = `${from.left + 5}px`;
    ghost.style.top = `${from.top + 5}px`;
    document.body.appendChild(ghost);
    const animation = ghost.animate([
        { transform: "translate3d(0, 0, 0) scale(1)", opacity: 1 },
        { transform: `translate3d(${to.left - from.left}px, ${to.top - from.top}px, 0) scale(.72)`, opacity: .2 },
    ], { duration: 170, easing: "cubic-bezier(.2,.8,.2,1)" });
    animation.onfinish = () => ghost.remove();
    animation.oncancel = () => ghost.remove();
}

function transferSlot(ref) {
    const source = resolveSlot(ref);
    if (!source || source.id === AIR) return;
    const id = source.id;
    const before = source.count;
    const destination = quickMove(ref);
    const moved = before - source.count;
    if (!moved) return;
    transferFeedbackKeys.add(refKey(ref));
    if (destination) transferFeedbackKeys.add(refKey(destination));
    animateSlotTransfer(ref, destination, id);
    inventoryChanged();
    transferFeedbackKeys.clear();
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
    const movingId = cursorStack.id;
    const before = `${cursorStack.id}:${cursorStack.count}:${target.id}:${target.count}`;
    slotClick(ref, 0);
    if (before === `${cursorStack.id}:${cursorStack.count}:${target.id}:${target.count}`) return;
    animateSlotTransfer(dragState.source, ref, movingId);
    overlayEl.querySelector(`.slot[data-container="${ref.container}"][data-index="${ref.index}"]`)?.classList.add("slot-transfer");
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
        shiftHeld = true;
        shiftTransferState = { button: event.button, keys: new Set([refKey(ref)]) };
        transferSlot(ref);
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
    event.currentTarget.classList.add("moving", "drag-target");
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
    gameCursorEl.style.transform = `translate3d(${mockCursor.x - 2}px, ${mockCursor.y - 2}px, 0)`;
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
    const storage = document.createElement("div");
    storage.className = "slot-grid inventory-grid inventory-storage";
    for (let i = HOTBAR_SIZE; i < INV_SIZE; i++) {
        storage.appendChild(makeSlot(inv[i], false, { container: "player", index: i }));
    }
    const hotbar = document.createElement("div");
    hotbar.className = "slot-grid inventory-grid inventory-hotbar";
    for (let i = 0; i < HOTBAR_SIZE; i++) {
        hotbar.appendChild(makeSlot(inv[i], i === sel, { container: "player", index: i }));
    }
    inventoryGridEl.append(storage, hotbar);
}

function renderItemDetails() {
    selectedItemDetailsEl.replaceChildren();
    const item = ITEMS[detailItemId];
    if (!item) {
        selectedItemDetailsEl.hidden = true;
        return;
    }
    selectedItemDetailsEl.hidden = false;
    selectedItemDetailsEl.appendChild(createItemIcon(item.id, "item-detail-icon"));
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = item.name;
    const meta = document.createElement("small");
    const kind = item.tool ? "Tool" : item.placeBlock ? "Block" : "Item";
    meta.textContent = `${kind} · ${countItem(item.id)} owned`;
    copy.append(name, meta);
    selectedItemDetailsEl.appendChild(copy);
}

function renderRecipes(station) {
    recipeListEl.innerHTML = "";
    const stations = station === "crafting_table"
        ? new Set(["inventory", "crafting_table"])
        : new Set([station]);
    const search = recipeSearchEl.value.trim().toLowerCase();
    const recipes = RECIPES.filter((entry) => {
        if (!stations.has(entry.station)) return false;
        const output = ITEMS[entry.output.id];
        if (recipeCategory === "blocks" && !output.placeBlock) return false;
        if (recipeCategory === "tools" && !output.tool) return false;
        if (recipeCategory === "items" && (output.placeBlock || output.tool)) return false;
        if (!search) return true;
        const names = [ITEMS[entry.output.id].name, ...Object.keys(entry.inputs).map((id) => ITEMS[id].name)];
        return names.some((name) => name.toLowerCase().includes(search));
    });
    const selectedRecipe = recipes.find((recipe) => recipe.id === selectedRecipeId);
    selectedRecipeEl.replaceChildren();
    selectedRecipeEl.hidden = false;
    if (selectedRecipe) {
        const available = canCraft(selectedRecipe);
        const craftButton = document.createElement("button");
        craftButton.type = "button";
        craftButton.className = "selected-recipe-card";
        craftButton.setAttribute("aria-disabled", String(!available));
        craftButton.title = `Craft ${ITEMS[selectedRecipe.output.id].name}`;
        const flow = document.createElement("span");
        flow.className = "recipe-flow";
        const inputs = document.createElement("span");
        inputs.className = "recipe-flow-inputs";
        for (const [id, required] of Object.entries(selectedRecipe.inputs)) {
            const ingredient = document.createElement("span");
            ingredient.className = "recipe-flow-item";
            ingredient.appendChild(createItemIcon(Number(id), "recipe-flow-icon"));
            const amount = document.createElement("b");
            amount.textContent = `×${required}`;
            ingredient.appendChild(amount);
            inputs.appendChild(ingredient);
        }
        const arrow = document.createElement("span");
        arrow.className = "recipe-flow-arrow";
        arrow.textContent = "→";
        const output = document.createElement("span");
        output.className = "recipe-flow-item recipe-flow-output";
        output.appendChild(createItemIcon(selectedRecipe.output.id, "recipe-flow-icon"));
        const outputAmount = document.createElement("b");
        outputAmount.textContent = `×${selectedRecipe.output.count}`;
        output.appendChild(outputAmount);
        flow.append(inputs, arrow, output);
        craftButton.appendChild(flow);
        craftButton.addEventListener("click", () => {
            if (craft(selectedRecipe)) {
                lastUsedRecipeId = selectedRecipe.id;
                showToast(`Crafted ${ITEMS[selectedRecipe.output.id].name}`);
            }
            else showToast("Missing materials or inventory space", true);
        });
        selectedRecipeEl.appendChild(craftButton);
    } else {
        const empty = document.createElement("div");
        empty.className = "no-selected-recipe";
        empty.textContent = "No selected recipe";
        selectedRecipeEl.appendChild(empty);
    }
    for (const recipe of recipes) {
        const button = document.createElement("button");
        button.type = "button";
        const available = canCraft(recipe);
        button.className = `recipe${recipe.id === selectedRecipeId ? " selected" : ""}${available ? "" : " unavailable"}`;
        button.setAttribute("aria-disabled", String(!available));
        button.title = ITEMS[recipe.output.id].name;
        button.appendChild(createItemIcon(recipe.output.id, "recipe-output-icon"));
        button.addEventListener("click", () => {
            if (!available) {
                selectedRecipeId = null;
                renderRecipes(station);
                updateMockHover();
                return;
            }
            selectedRecipeId = recipe.id;
            lastUsedRecipeId = recipe.id;
            detailItemId = recipe.output.id;
            renderItemDetails();
            renderRecipes(station);
            updateMockHover();
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
        <div class="furnace-panel-content">
            <h3>Furnace</h3>
            <div class="furnace-layout">
                <div class="station-slot" data-index="0"></div>
                <div class="meters"><span>Smelt</span><i><b style="width:${progress}%"></b></i><span>Fuel</span><i><b style="width:${burn}%"></b></i></div>
                <div class="station-slot" data-index="2"></div>
                <div class="station-slot fuel-slot" data-index="1"></div>
            </div>
        </div>`;
    for (const host of stationPanelEl.querySelectorAll(".station-slot")) {
        const index = Number(host.dataset.index);
        host.appendChild(makeSlot([furnace.input, furnace.fuel, furnace.output][index], false, { container: "furnace", index }));
    }
}

function renderChest() {
    stationPanelEl.innerHTML = '<div class="storage-panel-content"><h3>Chest</h3><div class="slot-grid chest-grid"></div></div>';
    const grid = stationPanelEl.querySelector(".chest-grid");
    getChest(gameplayOverlay.key).forEach((slot, index) => {
        grid.appendChild(makeSlot(slot, false, { container: "chest", index }));
    });
}

function renderOverlay() {
    if (!gameplayOverlay) return;
    overlayEl.classList.toggle("inventory-menu", gameplayOverlay.type === "inventory");
    overlayEl.classList.toggle("crafting-menu", gameplayOverlay.type === "crafting_table");
    overlayEl.classList.toggle("storage-menu", gameplayOverlay.type === "chest");
    overlayEl.classList.toggle("furnace-menu", gameplayOverlay.type === "furnace");
    overlayEl.classList.toggle("settings-menu", settingsOpen);
    gameplayWindowEl.hidden = settingsOpen;
    gameSettingsWindowEl.hidden = !settingsOpen;
    const hasRecipeCategories = gameplayOverlay.type === "crafting_table";
    inventoryTabsEl.hidden = !hasRecipeCategories;
    playerInventoryTitleEl.hidden = !["inventory", "chest", "furnace", "crafting_table"].includes(gameplayOverlay.type);
    recipeTitleEl.hidden = !["inventory", "crafting_table"].includes(gameplayOverlay.type);
    recipeTitleEl.textContent = gameplayOverlay.type === "crafting_table" ? "Crafting Table" : "Crafting";
    renderInventory();
    renderItemDetails();
    stationPanelEl.innerHTML = "";
    recipeSectionEl.style.display = "none";
    recipeSearchEl.style.display = "";
    recipeListEl.style.display = "";
    if (gameplayOverlay.type === "inventory") {
        recipeSectionEl.style.display = "block";
        recipeSearchEl.style.display = "none";
        renderRecipes("inventory");
    } else if (gameplayOverlay.type === "crafting_table") {
        recipeSectionEl.style.display = "block";
        renderRecipes("crafting_table");
    } else if (gameplayOverlay.type === "furnace") {
        renderFurnace();
    } else if (gameplayOverlay.type === "chest") {
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
    settingsOpen = false;
    recipeCategory = "all";
    const lastUsedRecipe = RECIPES.find((recipe) => recipe.id === lastUsedRecipeId);
    const recipeAvailableHere = lastUsedRecipe && (
        lastUsedRecipe.station === type ||
        (type === "crafting_table" && lastUsedRecipe.station === "inventory")
    );
    selectedRecipeId = recipeAvailableHere && canCraft(lastUsedRecipe)
        ? lastUsedRecipe.id
        : null;
    for (const tab of inventoryTabsEl.querySelectorAll(".inventory-tab")) {
        tab.classList.toggle("active", tab.dataset.category === "all");
    }
    detailItemId = inv[sel]?.id ?? AIR;
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

export function closeGameplayUI() {
    if (!gameplayOverlay) return;
    returnCursorStack();
    gameplayOverlay = null;
    settingsOpen = false;
    shiftTransferState = null;
    dragState = null;
    hoveredSlot = null;
    mockCursor.hover?.dispatchEvent(new PointerEvent("pointerleave", { bubbles: false }));
    mockCursor.hover = null;
    mockCursor.downTarget = null;
    mockCursor.range = null;
    overlayEl.style.display = "none";
    document.body.classList.remove("game-ui-open");
    gameCursorEl.hidden = true;
    crossEl.style.display = gameState === STATE_PLAY ? "block" : "none";
}

export async function requestLock() {
    try {
        await canvas.requestPointerLock({ unadjustedMovement: true });
        rawPointerLock = true;
    } catch {
        try {
            await canvas.requestPointerLock();
            rawPointerLock = false;
        } catch {
            suppressPause = false;
        }
    }
}

export function initUI() {
    setHotbarCallback(() => {
        drawHotbar();
        if (gameplayOverlay) renderOverlay();
    });
    setSelectionCallback(updateHotbarSelection);
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
    document.getElementById("inventorySettingsBtn").addEventListener("click", () => {
        settingsOpen = true;
        renderOverlay();
        positionGameCursor();
        updateMockHover();
    });
    document.getElementById("inventorySettingsBackBtn").addEventListener("click", () => {
        settingsOpen = false;
        renderOverlay();
        positionGameCursor();
        updateMockHover();
    });
    const categoryIcons = {
        all: CRAFTING_TABLE,
        blocks: PLANKS,
        tools: CROOK,
        items: STRING,
    };
    for (const tab of inventoryTabsEl.querySelectorAll(".inventory-tab")) {
        tab.appendChild(createItemIcon(categoryIcons[tab.dataset.category], "inventory-tab-icon"));
        tab.addEventListener("click", () => {
            recipeCategory = tab.dataset.category;
            for (const other of inventoryTabsEl.querySelectorAll(".inventory-tab")) {
                other.classList.toggle("active", other === tab);
            }
            renderRecipes(gameplayOverlay.type === "crafting_table" ? "crafting_table" : "inventory");
            updateMockHover();
        });
    }
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
            rawPointerLock = false;
            suppressPause = false;
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.code === "ShiftLeft" || event.code === "ShiftRight") shiftHeld = true;
        if (chatOpen) {
            if (event.code === "Enter") {
                event.preventDefault();
                event.stopImmediatePropagation();
                submitChat();
                closeChat();
            } else if (event.code === "Escape") {
                event.preventDefault();
                event.stopImmediatePropagation();
                closeChat();
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
            if (gameplayOverlay) closeGameplayUI();
            else openInventory();
        }
    }, true);

    document.addEventListener("keyup", (event) => {
        if (event.code !== "ShiftLeft" && event.code !== "ShiftRight") return;
        shiftHeld = false;
        shiftTransferState = null;
    }, true);

    document.addEventListener("pointerup", (event) => {
        if (shiftTransferState?.button === event.button) shiftTransferState = null;
        if (!dragState || event.button !== dragState.button) return;
        const finished = dragState;
        dragState = null;
        overlayEl.classList.remove("dragging-stack");
        for (const slot of overlayEl.querySelectorAll(".drag-target")) {
            slot.classList.remove("drag-target", "moving");
        }
        if (finished.pickedOnDown) {
            if (!finished.released && hoveredSlot && refKey(hoveredSlot) !== refKey(finished.source)) {
                const movingId = cursorStack.id;
                slotClick(hoveredSlot, 0);
                animateSlotTransfer(finished.source, hoveredSlot, movingId);
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
        shiftHeld = event.shiftKey;
        const speed = Math.hypot(event.movementX, event.movementY);
        const gain = rawPointerLock ? 1 + Math.min(1.5, speed / 18) : 1;
        mockCursor.x = Math.max(0, Math.min(innerWidth - 1, mockCursor.x + event.movementX * gain));
        mockCursor.y = Math.max(0, Math.min(innerHeight - 1, mockCursor.y + event.movementY * gain));
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
            bubbles: true,
            button: event.button,
            buttons: 1 << event.button,
            clientX: mockCursor.x,
            clientY: mockCursor.y,
            shiftKey: event.shiftKey,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
            metaKey: event.metaKey,
        }));
    }, true);

    document.addEventListener("mouseup", (event) => {
        if (!event.isTrusted || !gameplayOverlay || document.pointerLockElement !== canvas) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const target = targetAtGameCursor();
        target?.dispatchEvent(new PointerEvent("pointerup", {
            bubbles: true,
            button: event.button,
            buttons: 0,
            clientX: mockCursor.x,
            clientY: mockCursor.y,
            shiftKey: event.shiftKey,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
            metaKey: event.metaKey,
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
            closeGameplayUI();
            return;
        }
        dropCursor(event.button === 2 ? 1 : cursorStack.count);
        inventoryChanged();
    });
    overlayEl.addEventListener("contextmenu", (event) => event.preventDefault());
    document.addEventListener("pointerdown", (event) => {
        event.target.closest?.("button, .btn")?.classList.add("pressed");
    });
    document.addEventListener("pointerup", () => {
        for (const button of document.querySelectorAll(".pressed")) {
            button.classList.remove("pressed");
            button.classList.add("released");
            button.addEventListener("animationend", () => button.classList.remove("released"), { once: true });
        }
    });
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

    window.addEventListener("wheel", (event) => {
        if (gameState !== STATE_PLAY || gameplayOverlay) return;
        event.preventDefault();
        const direction = Math.sign(event.deltaY);
        if (!direction) return;
        if (keys.KeyC) adjustZoomLevel(direction);
        else updateSel(sel + direction);
    }, { capture: true, passive: false });
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
