import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { AIR } from "../constants.js";
import { BLOCK_ICON } from "./materials.js";
import { getItemVoxelAsset } from "./itemVoxel.js";
import { ITEMS } from "../registries.js";
import { getSelected } from "../Player/inventory.js";
import { player } from "../Player/player.js";
import { world } from "./world.js";
import {
    ambientLight,
    camera,
    hemiLight,
    moon,
    renderer,
    sun,
} from "./setup.js";

const heldScene = new THREE.Scene();
const heldCamera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 20);
const viewModel = new THREE.Group();
const punchRig = new THREE.Group();
const actionRig = new THREE.Group();
const swapRig = new THREE.Group();
const itemHolder = new THREE.Group();
const textureLoader = new THREE.TextureLoader();
const textures = new Map();
const inverseCameraRotation = new THREE.Quaternion();
const lightDirection = new THREE.Vector3();
const shadowRay = new THREE.Vector3();

const heldAmbient = new THREE.AmbientLight();
const heldHemisphere = new THREE.HemisphereLight();
const heldSun = new THREE.DirectionalLight();
const heldMoon = new THREE.DirectionalLight();
heldScene.add(heldAmbient, heldHemisphere, heldSun, heldMoon, viewModel);
viewModel.add(punchRig);
punchRig.add(actionRig);
actionRig.add(swapRig);
swapRig.add(itemHolder);

function coloredBox(width, height, depth, colors) {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const values = new Float32Array(geometry.attributes.position.count * 3);
    const color = new THREE.Color();
    for (const group of geometry.groups) {
        color.setHex(colors[group.materialIndex]);
        const end = group.start + group.count;
        for (let i = group.start; i < end; i++) {
            const vertex = geometry.index ? geometry.index.getX(i) : i;
            values[vertex * 3] = color.r;
            values[vertex * 3 + 1] = color.g;
            values[vertex * 3 + 2] = color.b;
        }
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(values, 3));
    geometry.clearGroups();
    return geometry;
}

const sleeveGeometry = coloredBox(
    0.36, 0.36, 1.48,
    [0x315c86, 0x426f99, 0x5786ae, 0x294d72, 0x3c6b95, 0x294f75],
);
const handGeometry = coloredBox(
    0.4, 0.4, 0.4,
    [0xc98260, 0xb66f52, 0xe4aa82, 0xa96149, 0xd99770, 0xb96f51],
);
sleeveGeometry.translate(0, 0, -0.04);
handGeometry.translate(0, 0, -0.82);
const armGeometry = mergeGeometries([sleeveGeometry, handGeometry]);
sleeveGeometry.dispose();
handGeometry.dispose();
const armMesh = new THREE.Mesh(armGeometry, new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.78,
    metalness: 0,
}));

const arm = new THREE.Group();
arm.add(armMesh);
arm.rotation.set(0.43, 0.3, 0.08);
swapRig.add(arm);

function getTexture(path) {
    if (textures.has(path)) return textures.get(path);
    const texture = textureLoader.load(path);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    textures.set(path, texture);
    return texture;
}

function texturedMaterial(path, options = {}) {
    return new THREE.MeshStandardMaterial({
        map: getTexture(path),
        roughness: options.roughness ?? 0.82,
        metalness: 0,
        transparent: options.transparent || false,
        alphaTest: options.alphaTest || 0.1,
        side: options.side || THREE.FrontSide,
    });
}

function clearItem() {
    while (itemHolder.children.length) {
        const object = itemHolder.children[0];
        itemHolder.remove(object);
        if (object.userData.sharedVoxelAsset) continue;
        object.geometry?.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => material?.dispose());
    }
}

function refreshHeldVoxel(asset, id) {
    if (shownId === id) renderHeldObject(id);
}

function renderHeldObject(id) {
    clearItem();
    if (id === AIR || !ITEMS[id]) return;

    const faces = BLOCK_ICON[id];
    if (faces) {
        const side = faces.side;
        const front = faces.front || side;
        const top = faces.top || side;
        const bottom = faces.bottom || top;
        const materials = [
            texturedMaterial(side), texturedMaterial(side),
            texturedMaterial(top), texturedMaterial(bottom),
            texturedMaterial(front), texturedMaterial(side),
        ];
        const block = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.58, 0.58), materials);
        block.rotation.set(0.38, -0.72, 0.03);
        itemHolder.add(block);
    } else {
        const voxel = getItemVoxelAsset(id, refreshHeldVoxel);
        const item = voxel
            ? new THREE.Mesh(voxel.geometry, voxel.material)
            : new THREE.Mesh(
                new THREE.PlaneGeometry(0.76, 0.76),
                texturedMaterial(ITEMS[id].icon, { alphaTest: 0.5, side: THREE.DoubleSide }),
            );
        if (voxel) {
            item.scale.setScalar(0.76 / 0.34);
            item.userData.sharedVoxelAsset = true;
        }
        item.rotation.set(0.08, -0.22, -0.2);
        itemHolder.add(item);
    }
}

const swapOrigin = new THREE.Vector3(1.65, -1.52, -2.55);
swapRig.position.copy(swapOrigin);
itemHolder.position.set(-0.53, 0.76, -0.65);

let shownId = null;
let pendingId = null;
let bobTime = 0;
let movementBlend = 0;
let swaySide = 0;
let swayForward = 0;
let lookYaw = 0;
let lookPitch = 0;
let lastCameraYaw = player.yaw;
let lastCameraPitch = player.pitch;
let swapTime = 0;
let swapping = false;
let itemChanged = false;
let placeTime = 0;
let placing = false;
let punchTime = 0;
let punching = false;
let isVisible = false;
let sunExposure = 1;
let moonExposure = 1;

function lightIsBlocked(light) {
    shadowRay.copy(light.position).sub(player.pos).normalize();
    let x = Math.floor(camera.position.x);
    let y = Math.floor(camera.position.y);
    let z = Math.floor(camera.position.z);
    const stepX = Math.sign(shadowRay.x);
    const stepY = Math.sign(shadowRay.y);
    const stepZ = Math.sign(shadowRay.z);
    const deltaX = shadowRay.x ? Math.abs(1 / shadowRay.x) : Infinity;
    const deltaY = shadowRay.y ? Math.abs(1 / shadowRay.y) : Infinity;
    const deltaZ = shadowRay.z ? Math.abs(1 / shadowRay.z) : Infinity;
    let nextX = shadowRay.x ? ((stepX > 0 ? x + 1 : x) - camera.position.x) / shadowRay.x : Infinity;
    let nextY = shadowRay.y ? ((stepY > 0 ? y + 1 : y) - camera.position.y) / shadowRay.y : Infinity;
    let nextZ = shadowRay.z ? ((stepZ > 0 ? z + 1 : z) - camera.position.z) / shadowRay.z : Infinity;
    let distance = 0;

    while (distance < 100) {
        if (nextX < nextY && nextX < nextZ) {
            x += stepX;
            distance = nextX;
            nextX += deltaX;
        } else if (nextY < nextZ) {
            y += stepY;
            distance = nextY;
            nextY += deltaY;
        } else {
            z += stepZ;
            distance = nextZ;
            nextZ += deltaZ;
        }
        if (world.isSolid(x, y, z)) return true;
    }
    return false;
}

function updateWorldShadow(dt) {
    const blend = 1 - Math.exp(-dt * 18);
    const targetSun = lightIsBlocked(sun) ? 0 : 1;
    const targetMoon = lightIsBlocked(moon) ? 0 : 1;
    sunExposure += (targetSun - sunExposure) * blend;
    moonExposure += (targetMoon - moonExposure) * blend;
}

function cubicEase(t) {
    return t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function cubicReturn(t) {
    const overshootAt = 0.65;
    const overshoot = -0.025;
    if (t < overshootAt) {
        return 1 + (overshoot - 1) * cubicEase(t / overshootAt);
    }
    return overshoot * (1 - cubicEase((t - overshootAt) / (1 - overshootAt)));
}

function updateItemSwap(dt, id) {
    if (shownId === null) {
        shownId = id;
        renderHeldObject(id);
    } else if (!swapping && !placing && id !== shownId) {
        pendingId = id;
        swapTime = 0;
        swapping = true;
        itemChanged = false;
    }

    if (!swapping) {
        swapRig.position.copy(swapOrigin);
        swapRig.rotation.set(0, 0, 0);
        return;
    }

    pendingId = id;
    swapTime += dt;
    const outDuration = 0.16;
    const returnDuration = 0.32;
    let motion;

    if (swapTime < outDuration) {
        motion = cubicEase(swapTime / outDuration);
    } else {
        const progress = Math.min((swapTime - outDuration) / returnDuration, 1);
        motion = cubicReturn(progress);
        const stillOffscreen = motion > 0.5;
        if (!itemChanged || (stillOffscreen && shownId !== pendingId)) {
            shownId = pendingId;
            renderHeldObject(shownId);
            itemChanged = true;
        }
        if (progress === 1) swapping = false;
    }

    swapRig.position.set(
        swapOrigin.x - motion * 1.05,
        swapOrigin.y - motion * 1.15,
        swapOrigin.z,
    );
    swapRig.rotation.set(motion * 0.08, 0, motion * 0.8);
}

function updatePlaceAnimation(dt) {
    if (!placing) return;
    placeTime += dt;
    const thrustDuration = 0.075;
    const returnDuration = 0.185;
    let motion;

    if (placeTime < thrustDuration) {
        motion = cubicEase(placeTime / thrustDuration);
    } else {
        const progress = Math.min((placeTime - thrustDuration) / returnDuration, 1);
        motion = cubicReturn(progress);
        if (progress === 1) placing = false;
    }

    actionRig.position.set(-motion * 0.04, -motion * 0.22, -motion * 0.58);
    actionRig.rotation.set(motion * 0.12, 0, -motion * 0.06);
}

export function playPlaceAnimation() {
    placeTime = 0;
    placing = true;
}

function updatePunchAnimation(dt) {
    if (!punching) return;
    punchTime += dt;
    const strikeDuration = 0.0625;
    const returnDuration = 0.204;
    let motion;

    if (punchTime < strikeDuration) {
        motion = cubicEase(punchTime / strikeDuration);
    } else {
        const progress = Math.min((punchTime - strikeDuration) / returnDuration, 1);
        motion = cubicReturn(progress);
        if (progress === 1) punching = false;
    }

    punchRig.position.set(-motion * 0.18, -motion * 0.28, -motion * 0.8);
    punchRig.rotation.set(motion * 0.22, 0, -motion * 0.18);
}

export function playPunchAnimation() {
    punchTime = 0;
    punching = true;
}

export function updateHeldItem(dt, visible = true) {
    isVisible = visible;
    if (!visible) {
        lastCameraYaw = player.yaw;
        lastCameraPitch = player.pitch;
        return;
    }

    const id = getSelected().id;
    updateWorldShadow(dt);
    updateItemSwap(dt, id);
    updatePlaceAnimation(dt);
    updatePunchAnimation(dt);

    const horizontalSpeed = Math.hypot(player.vel.x, player.vel.z);
    const targetMovement = player.grounded
        ? THREE.MathUtils.clamp(horizontalSpeed / 5, 0, 1)
        : 0;
    const movementBlendRate = 1 - Math.exp(-dt * 5);
    movementBlend += (targetMovement - movementBlend) * movementBlendRate;
    bobTime += dt * THREE.MathUtils.lerp(2, 9, movementBlend);
    const rightX = Math.cos(player.yaw);
    const rightZ = -Math.sin(player.yaw);
    const forwardX = -Math.sin(player.yaw);
    const forwardZ = -Math.cos(player.yaw);
    const targetSide = movementBlend * THREE.MathUtils.clamp(
        (player.vel.x * rightX + player.vel.z * rightZ) / 8.5,
        -1,
        1,
    );
    const targetForward = movementBlend * THREE.MathUtils.clamp(
        (player.vel.x * forwardX + player.vel.z * forwardZ) / 8.5,
        -1,
        1,
    );
    const swayBlend = 1 - Math.exp(-dt * 7);
    swaySide += (targetSide - swaySide) * swayBlend;
    swayForward += (targetForward - swayForward) * swayBlend;

    const frameTime = Math.max(dt, 0.001);
    const targetLookYaw = THREE.MathUtils.clamp(
        (player.yaw - lastCameraYaw) / frameTime / 4,
        -1,
        1,
    );
    const targetLookPitch = THREE.MathUtils.clamp(
        (player.pitch - lastCameraPitch) / frameTime / 3,
        -1,
        1,
    );
    lastCameraYaw = player.yaw;
    lastCameraPitch = player.pitch;
    const lookBlend = 1 - Math.exp(-dt * 6);
    lookYaw += (targetLookYaw - lookYaw) * lookBlend;
    lookPitch += (targetLookPitch - lookPitch) * lookBlend;

    const bobX = THREE.MathUtils.lerp(0.012, 0.06, movementBlend);
    const bobY = THREE.MathUtils.lerp(0.012, 0.07, movementBlend);
    viewModel.position.x = Math.sin(bobTime) * bobX - swaySide * 0.055 + lookYaw * 0.045;
    viewModel.position.y = -Math.abs(Math.cos(bobTime)) * bobY - lookPitch * 0.032;
    viewModel.position.z = swayForward * 0.07 + lookPitch * 0.02;
    viewModel.rotation.x = -swayForward * 0.03 + lookPitch * 0.032;
    viewModel.rotation.y = swaySide * 0.045 + lookYaw * 0.038;
    viewModel.rotation.z = Math.sin(bobTime) * THREE.MathUtils.lerp(0.006, 0.025, movementBlend)
        - lookYaw * 0.012;
}

function updateHeldLight(source, target, exposure) {
    target.color.copy(source.color);
    target.intensity = source.intensity * exposure;
    lightDirection.copy(source.position)
        .sub(player.pos)
        .applyQuaternion(inverseCameraRotation)
        .normalize();
    target.position.copy(lightDirection);
}

export function renderHeldItem() {
    if (!isVisible) return;
    heldAmbient.color.copy(ambientLight.color);
    heldAmbient.intensity = ambientLight.intensity;
    heldHemisphere.color.copy(hemiLight.color);
    heldHemisphere.groundColor.copy(hemiLight.groundColor);
    heldHemisphere.intensity = hemiLight.intensity;

    inverseCameraRotation.copy(camera.quaternion).invert();
    updateHeldLight(sun, heldSun, sunExposure);
    updateHeldLight(moon, heldMoon, moonExposure);

    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(heldScene, heldCamera);
    renderer.autoClear = autoClear;
}

export function disposeHeldItem() {
    clearItem();
    armGeometry.dispose();
    armMesh.material.dispose();
    for (const texture of textures.values()) texture.dispose();
    textures.clear();
}

addEventListener("resize", () => {
    heldCamera.aspect = innerWidth / innerHeight;
    heldCamera.updateProjectionMatrix();
});
