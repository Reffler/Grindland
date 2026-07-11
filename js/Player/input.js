import { updateSel } from "./inventory.js";
import { renderer } from "../Graphics/setup.js";
import { player } from "./player.js";

export const keys = Object.create(null);
export let sensitivity = 0.0025;
export let sprinting = false;
let lastForwardTap = -Infinity;

export function setSensitivity(val) {
    sensitivity = val;
}

addEventListener("keydown", (e) => {
    if (document.body.classList.contains("game-ui-open") || e.target.matches?.("input, textarea")) return;
    // Prevent browser shortcuts when playing (pointer locked)
    if (locked() && !document.body.classList.contains("game-ui-open")) {
        // Prevent Ctrl+key shortcuts (like Ctrl+W, Ctrl+D, etc.)
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
        }
    }

    keys[e.code] = true;
    if (e.code === "KeyW" && !e.repeat) {
        const now = performance.now();
        sprinting = now - lastForwardTap <= 280;
        lastForwardTap = now;
    }
    const map = {
        Digit1: 0,
        Digit2: 1,
        Digit3: 2,
        Digit4: 3,
        Digit5: 4,
        Digit6: 5,
        Digit7: 6,
        Digit8: 7,
        Digit9: 8,
        Digit0: 9,
    };
    if (e.code in map) {
        updateSel(map[e.code]);
    }
});
addEventListener("keyup", (e) => {
    keys[e.code] = false;
    if (e.code === "KeyW") sprinting = false;
});

const canvas = renderer.domElement;
export const locked = () => document.pointerLockElement === canvas;

addEventListener("contextmenu", (e) => {
    if (locked()) e.preventDefault();
});
addEventListener("mousemove", (e) => {
    if (!locked() || document.body.classList.contains("game-ui-open")) return;
    player.yaw -= e.movementX * sensitivity;
    player.pitch -= e.movementY * sensitivity;
    player.pitch = Math.max(
        -Math.PI / 2 + 0.001,
        Math.min(Math.PI / 2 - 0.001, player.pitch),
    );
});
