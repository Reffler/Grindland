import { camera, scene, sun, sunMesh, sunGlow, moon, moonMesh, moonGlow, renderer, composer, skyDome, updateSkyColors, updateZoom, disposeGraphics } from "./Graphics/setup.js";
import { world } from "./Graphics/world.js";
import { disposeHeldItem, renderHeldItem, updateHeldItem } from "./Graphics/heldItem.js";
import { disposeItemVoxelAssets } from "./Graphics/itemVoxel.js";
import { disposeMaterialAssets } from "./Graphics/materials.js";
import { buildSkyblockWithTree } from "./WorldGen/island.js";
import { player, updatePlayer, setSpawnPoint } from "./Player/player.js";
import { updateInteraction } from "./Player/interaction.js";
import { consumeLookInput, keys } from "./Player/input.js";
import { updateEnvironment } from "./Mechanics/environment.js";
import { disposeItemDrops, updateItemDrops } from "./Mechanics/itemDrops.js";
import { updateFurnaces } from "./Mechanics/stations.js";
import { updateBlockParticles } from "./Graphics/blockParticles.js";
import { spawnSpriteEntity, updateSpriteEntities } from "./Entities/spriteEntity.js";
import { initUI, gameState, updateFPS, setPlayerAndSpawn, isGameplayUIOpen } from "./Hud/ui.js";
import { STATE_MAIN, STATE_PLAY, STATE_PAUSE, DAY_DURATION, CELESTIAL_RADIUS } from "./constants.js";
import * as THREE from "three";

// World Gen
export const SPAWN = buildSkyblockWithTree(world);
player.pos.set(SPAWN.x, SPAWN.y, SPAWN.z);
setSpawnPoint(SPAWN); // Set spawn point for void fall respawn
Promise.all([
    spawnSpriteEntity("shop", SPAWN.oakCenter, Math.PI),
    spawnSpriteEntity("shopper", SPAWN.oakCenter, Math.PI),
]).catch(console.error);

// Sun/Moon targets for shadow direction
const sunTarget = new THREE.Object3D();
const moonTarget = new THREE.Object3D();
sunTarget.position.set(SPAWN.x, SPAWN.y, SPAWN.z);
moonTarget.position.set(SPAWN.x, SPAWN.y, SPAWN.z);
scene.add(sunTarget);
scene.add(moonTarget);
sun.target = sunTarget;
moon.target = moonTarget;

// Pass player and spawn to UI (breaks circular dependency)
setPlayerAndSpawn(player, SPAWN);

// UI Init
initUI();

// Day/night cycle time tracking
let dayTime = DAY_DURATION * 0.25; // Start at sunrise (0.25 of cycle)

window.addEventListener("game-command", (event) => {
    if (event.detail?.type === "time") {
        dayTime = DAY_DURATION * (event.detail.value === "night" ? 0.75 : 0.25);
    }
});

/**
 * Updates sun and moon positions based on time of day
 * Minecraft-style: Sun rises from -Z (east), overhead at midday, sets at +Z (west)
 * Rotation is around the X axis
 * @param {THREE.Vector3} center - The center point (player or spawn position)
 * @param {number} time - Current day time in seconds
 */
function updateCelestialBodies(center, time) {
    // Calculate angle: 0 = sunrise (east/-Z), 0.25 = midday (overhead), 0.5 = sunset (west/+Z), 0.75 = midnight
    const dayProgress = (time % DAY_DURATION) / DAY_DURATION;
    const angle = dayProgress * Math.PI * 2;

    // Sun position: rotates around X axis
    // At angle 0 (sunrise): Y=0, Z=-radius (east)
    // At angle π/2 (midday): Y=+radius, Z=0 (overhead)
    // At angle π (sunset): Y=0, Z=+radius (west)
    // At angle 3π/2 (midnight): Y=-radius, Z=0 (below)
    const sunY = Math.sin(angle) * CELESTIAL_RADIUS;
    const sunZ = -Math.cos(angle) * CELESTIAL_RADIUS;

    sun.position.set(center.x, center.y + sunY, center.z + sunZ);
    sunMesh.position.copy(sun.position);
    sunGlow.position.copy(sun.position);
    sunTarget.position.copy(center);

    // Moon is exactly opposite the sun (180 degrees / π radians offset)
    const moonY = Math.sin(angle + Math.PI) * CELESTIAL_RADIUS;
    const moonZ = -Math.cos(angle + Math.PI) * CELESTIAL_RADIUS;

    moon.position.set(center.x, center.y + moonY, center.z + moonZ);
    moonMesh.position.copy(moon.position);
    moonGlow.position.copy(moon.position);
    moonTarget.position.copy(center);

    // Adjust light intensities based on sun height
    const sunHeight = Math.sin(angle); // -1 to 1
    const dayIntensity = Math.max(0, sunHeight);
    const nightIntensity = Math.max(0, -sunHeight);

    // Sun brightness: full at midday, off at midnight
    sun.intensity = 1.2 * Math.pow(dayIntensity, 0.5);

    // Moon brightness: full at midnight, off at midday
    moon.intensity = 0.4 * Math.pow(nightIntensity, 0.5);

    // Update sky colors based on time
    updateSkyColors(dayProgress, time);

    // Keep sky dome centered on camera
    skyDome.position.copy(camera.position);
}

// Loop
let last = performance.now(),
    frames = 0,
    acc = 0;

function renderFrame() {
    composer.render();
    renderHeldItem();
}

function tick(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;
    updateZoom(dt, gameState === STATE_PLAY && keys.KeyC && !isGameplayUIOpen());
    updateHeldItem(dt, gameState === STATE_PLAY && !isGameplayUIOpen());
    updateSpriteEntities(now * 0.001);

    const gameplayUIOpen = isGameplayUIOpen();
    if (gameState !== STATE_PLAY || !gameplayUIOpen) dayTime += dt;

    // Main Menu Camera Orbit
    if (gameState === STATE_MAIN) {
        const t = now * 0.0002;
        camera.position.set(
            SPAWN.x + Math.sin(t) * 12,
            SPAWN.y + 6,
            SPAWN.z + Math.cos(t) * 12
        );
        camera.lookAt(SPAWN.x, SPAWN.y, SPAWN.z);

        // Update sun/moon centered on spawn
        updateCelestialBodies(SPAWN, dayTime);

        renderFrame();
        return;
    }

    // Pause State
    if (gameState === STATE_PAUSE) {
        renderFrame();
        return;
    }

    // Play State
    if (!gameplayUIOpen) {
        consumeLookInput();
        updatePlayer(dt);
    }

    // Update sun/moon centered on player
    updateCelestialBodies(player.pos, dayTime);

    if (!gameplayUIOpen) updateInteraction(dt);
    updateEnvironment(dt);
    updateBlockParticles(dt);
    updateItemDrops(dt);
    updateFurnaces(dt);

    renderFrame();
    frames++;
    acc += dt;
    if (acc > 0.25) {
        updateFPS(frames, acc);
        frames = 0;
        acc = 0;
    }
}

renderer.setAnimationLoop(tick);

addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    disposeItemDrops();
    disposeHeldItem();
    disposeItemVoxelAssets();
    disposeMaterialAssets();
    disposeGraphics();
});
