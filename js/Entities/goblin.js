import * as THREE from "three";
import { scene } from "../Graphics/setup.js";

const FACE_ORDER = ["east", "west", "up", "down", "south", "north"];
let modelPromise;

function loadModel() {
    return modelPromise ??= fetch("./models/goblin.bbmodel").then((response) => response.json());
}

function setFaceUvs(geometry, faces, width, height) {
    const uv = geometry.attributes.uv;
    FACE_ORDER.forEach((name, faceIndex) => {
        const [u1, v1, u2, v2] = faces[name].uv;
        const values = [u1 / width, 1 - v1 / height, u2 / width, 1 - v1 / height,
            u1 / width, 1 - v2 / height, u2 / width, 1 - v2 / height];
        for (let i = 0; i < 4; i++) uv.setXY(faceIndex * 4 + i, values[i * 2], values[i * 2 + 1]);
    });
    uv.needsUpdate = true;
}

async function createGoblin() {
    const data = await loadModel();
    const texture = await new THREE.TextureLoader().loadAsync(data.textures[0].source);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: .85, alphaTest: .1 });
    const root = new THREE.Group();
    for (const element of data.elements) {
        const size = element.to.map((value, axis) => (value - element.from[axis]) / 16);
        const geometry = new THREE.BoxGeometry(...size);
        setFaceUvs(geometry, element.faces, data.resolution.width, data.resolution.height);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(
            (element.from[0] + element.to[0]) / 32,
            (element.from[1] + element.to[1]) / 32,
            (element.from[2] + element.to[2]) / 32,
        );
        mesh.castShadow = mesh.receiveShadow = true;
        root.add(mesh);
    }
    return root;
}

export async function spawnGoblin(position, rotationY) {
    const goblin = await createGoblin();
    goblin.position.copy(position);
    goblin.rotation.y = rotationY;
    scene.add(goblin);
    return goblin;
}
