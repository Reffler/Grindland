import * as THREE from "three";
import { EPS, RAD, HEIGHT_STAND, EYE_STAND, EYE_CROUCH, HEIGHT_CROUCH, CROUCH_SMOOTH_SPEED, GRAV, JUMP, VOID_FALL_DEPTH, VOID_RESPAWN_HEIGHT, TERMINAL_VELOCITY } from "../constants.js";
import { world } from "../Graphics/world.js";
import { camera } from "../Graphics/setup.js";
import { keys, sprinting } from "./input.js";

// Spawn point for void fall respawn
let spawnPoint = null;

export function setSpawnPoint(spawn) {
    spawnPoint = spawn;
}

// Player State
export const player = {
    pos: new THREE.Vector3(0, 0, 0), // Will be set to SPAWN in main
    vel: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    grounded: false,
    crouching: false,
    height: HEIGHT_STAND,
    crouchBlend: 0,
};

export const aimOrigin = new THREE.Vector3();

// Reusable vectors for movement calculation (avoids GC pressure)
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();

// Physics Helpers
function twoClear(px, py, pz, height) {
    const minX = Math.floor(px - RAD),
        maxX = Math.floor(px + RAD),
        minZ = Math.floor(pz - RAD),
        maxZ = Math.floor(pz + RAD),
        baseY = Math.floor(py);
    const top = baseY + Math.ceil(height) - 1;
    for (let y = baseY; y <= top; y++)
        for (let z = minZ; z <= maxZ; z++)
            for (let x = minX; x <= maxX; x++)
                if (world.isSolid(x, y, z)) return false;
    return true;
}

function sweepY(pos, vel, dt) {
    const H = player.height,
        m = vel.y * dt;
    if (m === 0) return;
    if (m > 0) {
        const target = pos.y + m,
            yLayer = Math.floor(target + H);
        const minX = Math.floor(pos.x - RAD),
            maxX = Math.floor(pos.x + RAD),
            minZ = Math.floor(pos.z - RAD),
            maxZ = Math.floor(pos.z + RAD);
        for (let z = minZ; z <= maxZ; z++)
            for (let x = minX; x <= maxX; x++)
                if (world.isSolid(x, yLayer, z)) {
                    pos.y = yLayer - H - EPS;
                    vel.y = 0;
                    return;
                }
        pos.y = target;
    } else {
        const target = pos.y + m,
            yLayer = Math.floor(target);
        const minX = Math.floor(pos.x - RAD),
            maxX = Math.floor(pos.x + RAD),
            minZ = Math.floor(pos.z - RAD),
            maxZ = Math.floor(pos.z + RAD);
        for (let z = minZ; z <= maxZ; z++)
            for (let x = minX; x <= maxX; x++)
                if (world.isSolid(x, yLayer, z)) {
                    pos.y = yLayer + 1 + EPS;
                    vel.y = 0;
                    player.grounded = true;
                    return;
                }
        player.grounded = false;
        pos.y = target;
    }
}

function applyCrouchEdgeStop(pos, axis, m) {
    if (m === 0 || !player.crouching || !player.grounded) return m;
    const footY = Math.floor(pos.y) - 1;

    // Check if current position has any support
    function hasAnySupport(px, pz) {
        const minX = Math.floor(px - RAD + EPS);
        const maxX = Math.floor(px + RAD - EPS);
        const minZ = Math.floor(pz - RAD + EPS);
        const maxZ = Math.floor(pz + RAD - EPS);
        for (let bx = minX; bx <= maxX; bx++) {
            for (let bz = minZ; bz <= maxZ; bz++) {
                if (world.isSolid(bx, footY, bz)) return true;
            }
        }
        return false;
    }

    // If we don't have support currently, don't apply edge stop
    if (!hasAnySupport(pos.x, pos.z)) return m;

    // Calculate new position
    const newX = axis === "x" ? pos.x + m : pos.x;
    const newZ = axis === "z" ? pos.z + m : pos.z;

    // If new position still has support, allow full movement
    if (hasAnySupport(newX, newZ)) return m;

    // Otherwise, find the maximum we can move while keeping support
    // Binary search for the edge
    let lo = 0, hi = Math.abs(m);
    const sign = m > 0 ? 1 : -1;
    for (let i = 0; i < 10; i++) {
        const mid = (lo + hi) / 2;
        const testX = axis === "x" ? pos.x + sign * mid : pos.x;
        const testZ = axis === "z" ? pos.z + sign * mid : pos.z;
        if (hasAnySupport(testX, testZ)) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    return sign * lo;
}

function sweepAxis(pos, vel, dt, axis) {
    let m = vel[axis] * dt;
    if (m === 0) return;

    // Apply crouch edge stop to prevent falling off when holding shift
    m = applyCrouchEdgeStop(pos, axis, m);

    if (axis !== "y") {
        const nx = axis === "x" ? pos.x + m : pos.x,
            nz = axis === "z" ? pos.z + m : pos.z;
        if (!twoClear(nx, pos.y, nz, player.height)) {
            vel[axis] = 0;
            return;
        }
    }
    pos[axis] += m;

    let minX = Math.floor(pos.x - RAD),
        maxX = Math.floor(pos.x + RAD);
    let minZ = Math.floor(pos.z - RAD),
        maxZ = Math.floor(pos.z + RAD);
    let minY = Math.floor(pos.y),
        maxY = Math.ceil(pos.y + player.height) - 1;
    const rng = (a, b, up) =>
        up
            ? (function* () {
                for (let i = a; i <= b; i++) yield i;
            })()
            : (function* () {
                for (let i = b; i >= a; i--) yield i;
            })();
    if (axis === "x") {
        const xs =
            vel.x > 0 ? rng(minX, maxX, 1) : rng(minX, maxX, 0);
        for (const y of rng(minY, maxY, 1))
            for (const z of rng(minZ, maxZ, 1))
                for (const x of xs)
                    if (world.isSolid(x, y, z)) {
                        pos.x =
                            vel.x > 0
                                ? x - RAD - EPS
                                : x + 1 + RAD + EPS;
                        vel.x = 0;
                        return;
                    }
    } else {
        const zs =
            vel.z > 0 ? rng(minZ, maxZ, 1) : rng(minZ, maxZ, 0);
        for (const y of rng(minY, maxY, 1))
            for (const z of zs)
                for (const x of rng(minX, maxX, 1))
                    if (world.isSolid(x, y, z)) {
                        pos.z =
                            vel.z > 0
                                ? z - RAD - EPS
                                : z + 1 + RAD + EPS;
                        vel.z = 0;
                        return;
                    }
    }
}

export function updatePlayer(dt) {
    // Determine desired crouch state
    const wantCrouch =
        keys["ShiftLeft"] || keys["ShiftRight"] ? 1 : 0;
    const canStand = twoClear(
        player.pos.x,
        player.pos.y,
        player.pos.z,
        HEIGHT_STAND,
    );
    const forcedCrouch = !canStand ? 1 : 0;
    const targetBlend = Math.max(wantCrouch, forcedCrouch);

    // Smoothly interpolate crouch blend (0 to 1)
    const blendSpeed = dt * CROUCH_SMOOTH_SPEED;
    player.crouchBlend +=
        (targetBlend - player.crouchBlend) * blendSpeed;

    // Calculate actual eye height and player height from blend
    const eyeH = THREE.MathUtils.lerp(
        EYE_STAND,
        EYE_CROUCH,
        player.crouchBlend,
    );
    player.height = THREE.MathUtils.lerp(
        HEIGHT_STAND,
        HEIGHT_CROUCH,
        player.crouchBlend,
    );
    player.crouching = player.crouchBlend > 0.5;

    // Base camera position at eye level - NO OFFSET APPLIED
    camera.position.set(
        player.pos.x,
        player.pos.y + eyeH,
        player.pos.z,
    );

    // Camera stays locked to eye position, no peek offset
    aimOrigin.copy(camera.position);
    camera.rotation.set(player.pitch, player.yaw, 0);

    // movement input - reuse vectors to avoid GC
    _forward.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    _right.set(-_forward.z, 0, _forward.x);
    const wr = (keys["KeyD"] ? 1 : 0) - (keys["KeyA"] ? 1 : 0),
        wf = (keys["KeyW"] ? 1 : 0) - (keys["KeyS"] ? 1 : 0);
    const len = Math.hypot(wr, wf) || 1;
    const moveSpeed = player.crouching ? 3.0 : sprinting && wf > 0 ? 8.5 : 5.0;
    player.vel.x =
        (_right.x * (wr / len) + _forward.x * (wf / len)) * moveSpeed;
    player.vel.z =
        (_right.z * (wr / len) + _forward.z * (wf / len)) * moveSpeed;

    // gravity & collisions
    player.vel.y -= GRAV * dt;
    // Clamp to terminal velocity to prevent clipping
    if (player.vel.y < -TERMINAL_VELOCITY) {
        player.vel.y = -TERMINAL_VELOCITY;
    }
    if ((keys["Space"] || keys["KeyZ"]) && player.grounded) {
        player.vel.y = JUMP;
        player.grounded = false;
    }
    sweepY(player.pos, player.vel, dt);
    sweepAxis(player.pos, player.vel, dt, "x");
    sweepAxis(player.pos, player.vel, dt, "z");

    // Void fall: teleport above spawn when fallen too far
    if (spawnPoint && player.pos.y < spawnPoint.y - VOID_FALL_DEPTH) {
        player.pos.set(
            spawnPoint.x,
            spawnPoint.y + VOID_RESPAWN_HEIGHT,
            spawnPoint.z
        );
        // Keep falling velocity for smooth continuation
        player.vel.x = 0;
        player.vel.z = 0;
        // Reset grounded state
        player.grounded = false;
    }
}
