import {
    WebGLRenderer,
    Scene,
    PerspectiveCamera,
    AmbientLight,
    HemisphereLight,
    DirectionalLight,
    Vector2,
    SphereGeometry,
    ShaderMaterial,
    Mesh,
    BackSide,
    FogExp2,
    PCFSoftShadowMap,
    SRGBColorSpace,
    ACESFilmicToneMapping,
    HalfFloatType,
    TextureLoader,
    SpriteMaterial,
    Sprite,
    Color,
    Object3D,
    Points,
    PointsMaterial,
    BufferGeometry,
    Float32BufferAttribute,
    CanvasTexture,
    Vector3,
    NearestFilter,
    EqualDepth
} from "three";
import {
    BloomEffect,
    EffectComposer,
    EffectPass,
    RenderPass,
    GodRaysEffect,
    KernelSize,
    HueSaturationEffect,
    BrightnessContrastEffect,
    BlendFunction,
    NormalPass,
    SSAOEffect,
    SMAAEffect,
    SMAAPreset,
    DepthDownsamplingPass,
    VignetteEffect
} from "postprocessing";
import { SUN_SCALE, MOON_SCALE } from "../constants.js";

// Settings
export let fov = 70;
const ZOOM_LEVELS = [0.14, 0.2, 0.27, 0.35, 0.45, 0.58, 0.72];
const DEFAULT_ZOOM_LEVEL = 3;
let zoomLevel = DEFAULT_ZOOM_LEVEL;
let zoomActive = false;

// Renderer Setup for Postprocessing
export const renderer = new WebGLRenderer({
    powerPreference: "high-performance",
    antialias: false,
    stencil: false,
    depth: true
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

// Enable shadows
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;

// Append to DOM
if (!document.body.contains(renderer.domElement)) {
    document.body.appendChild(renderer.domElement);
}

export const scene = new Scene();

export function excludeCutoutFromNormalPass(mesh) {
    let skipped = false;
    const beforeRender = mesh.onBeforeRender;
    const afterRender = mesh.onAfterRender;
    mesh.onBeforeRender = function (...args) {
        beforeRender.apply(this, args);
        const material = args[4];
        if (!material.isMeshNormalMaterial) return;
        material.colorWrite = false;
        skipped = true;
    };
    mesh.onAfterRender = function (...args) {
        if (skipped) {
            args[4].colorWrite = true;
            skipped = false;
        }
        afterRender.apply(this, args);
    };
}

// --- Sky Dome ---
const skyGeo = new SphereGeometry(400, 32, 32);
const skyMat = new ShaderMaterial({
    uniforms: {
        topColor: { value: new Color(0x4a90d9) },
        bottomColor: { value: new Color(0x87ceeb) },
        starVisibility: { value: 0 },
        starRotation: { value: 0 },
    },
    vertexShader: `
        varying vec3 vDirection;
        void main() {
            vDirection = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float starVisibility;
        uniform float starRotation;
        varying vec3 vDirection;

        float hash21(vec2 p) {
            p = fract(p * vec2(123.34, 456.21));
            p += dot(p, p + 45.32);
            return fract(p.x * p.y);
        }

        void main() {
            vec3 direction = normalize(vDirection);
            float skyMix = pow(smoothstep(-0.08, 0.85, direction.y), 0.62);
            float horizon = exp(-abs(direction.y) * 8.0);
            vec3 color = mix(bottomColor, topColor, skyMix);
            color = mix(color, bottomColor, horizon * 0.28);

            float starCos = cos(starRotation);
            float starSin = sin(starRotation);
            vec3 starDirection = vec3(
                direction.x,
                direction.y * starCos - direction.z * starSin,
                direction.y * starSin + direction.z * starCos
            );
            vec3 axis = abs(starDirection);
            vec2 starUv;
            float face;
            if (axis.x >= axis.y && axis.x >= axis.z) {
                starUv = starDirection.zy / axis.x;
                face = starDirection.x > 0.0 ? 0.0 : 1.0;
            } else if (axis.y >= axis.z) {
                starUv = starDirection.xz / axis.y;
                face = starDirection.y > 0.0 ? 2.0 : 3.0;
            } else {
                starUv = starDirection.xy / axis.z;
                face = starDirection.z > 0.0 ? 4.0 : 5.0;
            }
            starUv = starUv * 0.5 + 0.5;
            vec2 starGrid = starUv * 180.0;
            vec2 starCell = floor(starGrid);
            vec2 starPixel = abs(fract(starGrid) - 0.5);
            float seed = hash21(starCell + vec2(face * 211.0, face * 97.0));
            float variation = hash21(starCell + vec2(face * 43.0, 17.0));
            float starSize = mix(0.13, 0.24, variation);
            float square = 1.0 - smoothstep(starSize, starSize + 0.08, max(starPixel.x, starPixel.y));
            float star = step(0.992, seed) * square * mix(0.7, 1.15, variation);
            float tint = hash21(starCell + vec2(73.0, face * 61.0));
            vec3 starColor = vec3(0.92, 0.95, 1.0);
            if (tint < 0.1) starColor = vec3(0.82, 1.0, 0.88);
            else if (tint < 0.2) starColor = vec3(1.0, 0.95, 0.76);
            else if (tint < 0.3) starColor = vec3(0.76, 0.87, 1.0);
            else if (tint < 0.4) starColor = vec3(1.0, 0.82, 0.94);
            color += starColor * star * starVisibility;

            float dither = (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
            gl_FragColor = vec4(color + dither, 1.0);
        }
    `,
    side: BackSide,
    fog: false
});
export const skyDome = new Mesh(skyGeo, skyMat);
scene.add(skyDome);

function cloudTexture(seed) {
    const columns = 4;
    const rows = 2;
    const cellSize = 128;
    const canvas = document.createElement("canvas");
    canvas.width = cellSize * columns;
    canvas.height = cellSize * rows;
    const context = canvas.getContext("2d");
    let state = seed;
    const random = () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
    for (let variant = 0; variant < columns * rows; variant++) {
        const offsetX = variant % columns * cellSize;
        const offsetY = Math.floor(variant / columns) * cellSize;
        const baseWidth = (6 + Math.floor(random() * 7)) * 8;
        const baseHeight = (2 + Math.floor(random() * 2)) * 8;
        const baseX = Math.floor((cellSize - baseWidth) / 16) * 8;
        const baseY = (7 + Math.floor(random() * 2)) * 8;
        const blocks = [[baseX, baseY, baseWidth, baseHeight]];
        const lobeCount = 3 + Math.floor(random() * 8);
        for (let i = 0; i < lobeCount; i++) {
            const width = (2 + Math.floor(random() * 5)) * 8;
            const height = (1 + Math.floor(random() * 3)) * 8;
            const x = (1 + Math.floor(random() * Math.max(1, 14 - width / 8))) * 8;
            const y = (4 + Math.floor(random() * 4)) * 8;
            blocks.push([x, y, width, height]);
        }
        context.fillStyle = "rgba(135,150,175,.9)";
        for (const [x, y, width, height] of blocks) {
            context.fillRect(offsetX + x + 4, offsetY + y + 6, width, height);
        }
        context.fillStyle = "rgba(215,225,238,.94)";
        for (const [x, y, width, height] of blocks) {
            context.fillRect(offsetX + x, offsetY + y, width, height);
        }
        context.fillStyle = "rgba(250,252,255,.72)";
        for (const [x, y, width, height] of blocks) {
            context.fillRect(
                offsetX + x,
                offsetY + y,
                width,
                Math.max(4, Math.floor(height * 0.35)),
            );
        }
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.generateMipmaps = false;
    return texture;
}

const cloudLayers = [];
const dayCloudColor = new Color(0xffffff);
const sunsetCloudColor = new Color(0xffd1a3);
const nightCloudColor = new Color(0x53627f);
const currentCloudColor = new Color();
function enableCloudSizes(material) {
    material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
            .replace(
                "uniform float size;",
                "uniform float size;\nattribute float cloudSize;\nattribute float cloudVariant;\nvarying float vCloudVariant;",
            )
            .replace(
                "gl_PointSize = size;",
                "vCloudVariant = cloudVariant;\ngl_PointSize = size * cloudSize;",
            );
        shader.fragmentShader = shader.fragmentShader
            .replace(
                "uniform vec3 diffuse;",
                "uniform vec3 diffuse;\nvarying float vCloudVariant;",
            )
            .replace("#include <map_particle_fragment>", `
                vec2 cloudUv = (uvTransform * vec3(gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1.0)).xy;
                vec2 cloudCell = vec2(mod(vCloudVariant, 4.0), floor(vCloudVariant / 4.0));
                cloudUv = (cloudUv + cloudCell) / vec2(4.0, 2.0);
                diffuseColor *= texture2D(map, cloudUv);
            `);
    };
    material.customProgramCacheKey = () => "clustered-cloud-atlas-v2";
}

function createCloudLayer(index, count, size, speed, radius) {
    const positions = [];
    const colors = [];
    const sizes = [];
    const variants = [];
    let state = 971 + index * 1597;
    const random = () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const clusterSize = 3 + index;
    const clusterCount = Math.ceil(count / clusterSize);
    for (let i = 0; i < count; i++) {
        const cluster = i % clusterCount;
        const y = 1 - 2 * (cluster + 0.5) / clusterCount;
        const radial = Math.sqrt(1 - y * y);
        const angle = cluster * goldenAngle + index * 1.73;
        const center = new Vector3(Math.cos(angle) * radial, y, Math.sin(angle) * radial);
        const tangent = new Vector3(-center.z, 0, center.x).normalize();
        const bitangent = new Vector3().crossVectors(center, tangent).normalize();
        const spread = i < clusterCount ? 0 : 0.035 + random() * 0.13;
        const offsetAngle = random() * Math.PI * 2;
        center.addScaledVector(tangent, Math.cos(offsetAngle) * spread)
            .addScaledVector(bitangent, Math.sin(offsetAngle) * spread)
            .normalize();
        positions.push(center.x * radius, center.y * radius, center.z * radius);
        const shade = 0.9 + ((i * 37 + index * 11) % 10) * 0.01;
        colors.push(shade, shade, shade);
        sizes.push(0.58 + random() * 1.05);
        variants.push((i * 5 + Math.floor(random() * 8)) % 8);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    geometry.setAttribute("cloudSize", new Float32BufferAttribute(sizes, 1));
    geometry.setAttribute("cloudVariant", new Float32BufferAttribute(variants, 1));
    const texture = cloudTexture(431 + index * 977);
    const material = new PointsMaterial({
        map: texture,
        size,
        sizeAttenuation: false,
        vertexColors: true,
        transparent: true,
        opacity: 0.42,
        alphaTest: 0.04,
        depthTest: true,
        depthFunc: EqualDepth,
        depthWrite: false,
        fog: false,
        toneMapped: false,
    });
    enableCloudSizes(material);
    const depthMaterial = new PointsMaterial({
        map: texture,
        size,
        sizeAttenuation: false,
        vertexColors: false,
        transparent: true,
        opacity: 1,
        alphaTest: 0.04,
        depthTest: true,
        depthWrite: true,
        colorWrite: false,
        fog: false,
        toneMapped: false,
    });
    enableCloudSizes(depthMaterial);
    const depthPoints = new Points(geometry, depthMaterial);
    const points = new Points(geometry, material);
    const layer = new Object3D();
    layer.rotation.x = (index - 1) * 0.16;
    depthPoints.renderOrder = 10;
    points.renderOrder = 11;
    excludeCutoutFromNormalPass(depthPoints);
    excludeCutoutFromNormalPass(points);
    layer.add(depthPoints, points);
    skyDome.add(layer);
    cloudLayers.push({
        points: layer,
        material,
        depthMaterial,
        speed,
        baseOpacity: material.opacity,
        baseSize: size,
    });
}

createCloudLayer(0, 24, 48, 0.006, 334);
createCloudLayer(1, 18, 54, 0.009, 340);
createCloudLayer(2, 14, 60, 0.012, 346);

// Fog
scene.fog = new FogExp2(0x87ceeb, 0.015);

export const camera = new PerspectiveCamera(
    fov,
    innerWidth / innerHeight,
    0.05,
    500,
);
camera.rotation.order = "YXZ";

// --- Lighting ---

// Ambient light
export const ambientLight = new AmbientLight(0xb4d7ff, 0.5);
scene.add(ambientLight);

// Hemisphere light
export const hemiLight = new HemisphereLight(0x87ceeb, 0x5a3d2b, 0.3);
const nightHemisphereFill = new Color(0x7188c4);
scene.add(hemiLight);

function configureWorldShadow(light) {
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.camera.near = 20;
    light.shadow.camera.far = 180;
    light.shadow.camera.left = -20;
    light.shadow.camera.right = 20;
    light.shadow.camera.top = 20;
    light.shadow.camera.bottom = -20;
    light.shadow.camera.updateProjectionMatrix();
    light.shadow.bias = -0.00002;
    light.shadow.normalBias = 0.002;
    light.shadow.radius = 1.25;
}

// Sun Light
export const sun = new DirectionalLight(0xfff5e6, 1.2);
sun.position.set(0.8, 1, 0.6).multiplyScalar(60);
configureWorldShadow(sun);
scene.add(sun);

// Sun Sprite
const texLoader = new TextureLoader();
const sunTex = texLoader.load("./textures/sun.png");
const sunMat = new SpriteMaterial({
    map: sunTex,
    fog: false,
    transparent: true,
    color: 0xffffff
});
export const sunMesh = new Sprite(sunMat);
sunMesh.scale.set(SUN_SCALE, SUN_SCALE, 1);
sunMesh.position.copy(sun.position);
scene.add(sunMesh);

// Moon Light - Blue tinted
export const moon = new DirectionalLight(0x6688cc, 0.3);
moon.position.set(-0.8, 1, -0.6).multiplyScalar(60);
configureWorldShadow(moon);
scene.add(moon);

// Moon Sprite
const moonTex = texLoader.load("./textures/moon.png");
const moonMat = new SpriteMaterial({
    map: moonTex,
    fog: false,
    transparent: true,
    color: 0xccddff
});
export const moonMesh = new Sprite(moonMat);
moonMesh.scale.set(MOON_SCALE, MOON_SCALE, 1);
moonMesh.position.copy(moon.position);
scene.add(moonMesh);

// Compatibility placeholders
export const sunGlow = new Object3D();
export const moonGlow = new Object3D();
export const sunGlowMat = { opacity: 0, color: new Color() };
export const moonGlowMat = { opacity: 0 };


// --- Post Processing ---

export const composer = new EffectComposer(renderer, {
    frameBufferType: HalfFloatType
});

// Render Pass
composer.addPass(new RenderPass(scene, camera));

// Normal Pass (required for SSAO)
const normalPass = new NormalPass(scene, camera);
composer.addPass(normalPass);

// SSAO Effect - Optimized for Performance
const ssaoEffect = new SSAOEffect(camera, normalPass.texture, {
    blendFunction: BlendFunction.MULTIPLY,
    distanceScaling: true,
    depthAwareUpsampling: true,
    samples: 16,               // Good balance
    rings: 4,
    distanceThreshold: 0.8,
    distanceFalloff: 0.15,
    rangeThreshold: 0.4,
    rangeFalloff: 0.02,
    luminanceInfluence: 0.7,
    minRadiusScale: 0.33,
    radius: 0.1,
    intensity: 1.35,
    bias: 0.025,
    fade: 0.01,
    color: null,
    resolutionScale: 0.5       // Half res for performance
});

// Bloom Effect
const bloomEffect = new BloomEffect({
    intensity: 0.4,
    luminanceThreshold: 1.0,
    luminanceSmoothing: 0.2,
    mipmapBlur: true,
    radius: 0.5
});

// Sun God Rays
const sunGodRaysEffect = new GodRaysEffect(camera, sunMesh, {
    height: 480,
    kernelSize: KernelSize.SMALL,
    density: 0.96,
    decay: 0.93,
    weight: 0.4,
    exposure: 0.55,
    samples: 60,
    clampMax: 1.0
});

// Moon God Rays
const moonGodRaysEffect = new GodRaysEffect(camera, moonMesh, {
    height: 480,
    kernelSize: KernelSize.SMALL,
    density: 0.96,
    decay: 0.92,
    weight: 0.3,
    exposure: 0.4,
    samples: 60,
    clampMax: 1.0
});

// Color Grading Effects
const hueSaturationEffect = new HueSaturationEffect({
    blendFunction: BlendFunction.NORMAL,
    saturation: 0.0,
    hue: 0.0
});

const brightnessContrastEffect = new BrightnessContrastEffect({
    blendFunction: BlendFunction.NORMAL,
    brightness: 0.01,
    contrast: 0.06
});

// Vignette Effect - Cinematic edges
const vignetteEffect = new VignetteEffect({
    eskil: false,
    offset: 0.25,
    darkness: 0.28
});

const smaaEffect = new SMAAEffect({
    preset: SMAAPreset.HIGH,
});

// Combine all effects
composer.addPass(new EffectPass(
    camera,
    ssaoEffect,
    bloomEffect,
    sunGodRaysEffect,
    moonGodRaysEffect,
    hueSaturationEffect,
    brightnessContrastEffect,
    vignetteEffect,
    smaaEffect
));


// --- Update Logic ---

const DAY_SKY_TOP = new Color(0x4a90d9);
const DAY_SKY_BOTTOM = new Color(0x87ceeb);
const SUNSET_SKY_TOP = new Color(0x2a3a60);
const SUNSET_SKY_BOTTOM = new Color(0xff8c42);
const NIGHT_SKY_TOP = new Color(0x020210);
const NIGHT_SKY_BOTTOM = new Color(0x0a0a2a);
const currentSkyTop = new Color();
const currentSkyBottom = new Color();
const smootherstep = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/**
 * Updates sky colors, lighting, and post-processing effects based on time of day
 * Extended golden hour for longer sunrise/sunset transitions
 * @param {number} dayProgress - 0 to 1 representing progress through the day
 */
export function updateSkyColors(dayProgress, worldTime = 0) {
    dayProgress = dayProgress % 1;
    if (dayProgress < 0) dayProgress += 1;

    const angle = dayProgress * Math.PI * 2;
    const sunHeight = Math.sin(angle);
    const moonHeight = -sunHeight;

    // VERY EXTENDED thresholds for much longer sunrise/sunset
    const DAY_THRESHOLD = 0.55;     // Even longer golden hour
    const NIGHT_THRESHOLD = -0.4;   // Much longer twilight

    const topColor = currentSkyTop;
    const bottomColor = currentSkyBottom;

    // Extended golden hour detection (very large range)
    const isGoldenHour = sunHeight > -0.25 && sunHeight < 0.6;
    const goldenCenter = 0.15;
    const goldenRange = 0.6;   // Very extended range
    const goldenIntensity = isGoldenHour ?
        Math.pow(Math.max(0, 1 - Math.abs(sunHeight - goldenCenter) / goldenRange), 1.2) : 0;

    if (sunHeight >= DAY_THRESHOLD) {
        topColor.copy(DAY_SKY_TOP);
        bottomColor.copy(DAY_SKY_BOTTOM);
    } else if (sunHeight >= 0) {
        // Very gradual Day <-> Sunset transition
        const t = sunHeight / DAY_THRESHOLD;
        const smooth = smootherstep(t);
        topColor.copy(SUNSET_SKY_TOP).lerp(DAY_SKY_TOP, smooth);
        bottomColor.copy(SUNSET_SKY_BOTTOM).lerp(DAY_SKY_BOTTOM, smooth);
    } else if (sunHeight >= NIGHT_THRESHOLD) {
        // Very gradual Sunset <-> Night transition
        const t = (sunHeight - NIGHT_THRESHOLD) / (0 - NIGHT_THRESHOLD);
        const smooth = smootherstep(t);
        topColor.copy(NIGHT_SKY_TOP).lerp(SUNSET_SKY_TOP, smooth);
        bottomColor.copy(NIGHT_SKY_BOTTOM).lerp(SUNSET_SKY_BOTTOM, smooth);
    } else {
        topColor.copy(NIGHT_SKY_TOP);
        bottomColor.copy(NIGHT_SKY_BOTTOM);
    }

    skyMat.uniforms.topColor.value.copy(topColor);
    skyMat.uniforms.bottomColor.value.copy(bottomColor);
    skyMat.uniforms.starVisibility.value = Math.max(0, Math.min(1, (-sunHeight - 0.05) / 0.35));
    skyMat.uniforms.starRotation.value = dayProgress * Math.PI * 2;
    scene.fog.color.copy(bottomColor);

    // --- Time Factors ---
    const dayFactor = Math.max(0, Math.min(1, (sunHeight + 0.2) / 1.2));
    const nightFactor = Math.max(0, Math.min(1, (-sunHeight + 0.2) / 1.2));
    const cloudTime = worldTime;
    const cloudZoomScale = Math.tan(fov * Math.PI / 360) /
        Math.tan(camera.fov * Math.PI / 360);
    currentCloudColor.copy(nightCloudColor).lerp(dayCloudColor, dayFactor);
    currentCloudColor.lerp(sunsetCloudColor, goldenIntensity * 0.55);
    for (const layer of cloudLayers) {
        layer.points.rotation.y = cloudTime * layer.speed;
        layer.material.color.copy(currentCloudColor);
        layer.material.opacity = layer.baseOpacity * (0.58 + dayFactor * 0.42);
        layer.material.size = layer.baseSize * cloudZoomScale;
        layer.depthMaterial.size = layer.baseSize * cloudZoomScale;
    }

    // --- Sun/Moon Horizon Fade ---
    const sunOpacity = Math.max(0, Math.min(1, (sunHeight + 0.08) / 0.18));
    const sunScale = SUN_SCALE * (0.7 + sunOpacity * 0.3);
    sunMat.opacity = sunOpacity;
    sunMesh.scale.set(sunScale, sunScale, 1);
    sunMesh.visible = sunOpacity > 0.01;

    const moonOpacity = Math.max(0, Math.min(1, (moonHeight + 0.08) / 0.18));
    const moonScale = MOON_SCALE * (0.7 + moonOpacity * 0.3);
    moonMat.opacity = moonOpacity;
    moonMesh.scale.set(moonScale, moonScale, 1);
    moonMesh.visible = moonOpacity > 0.01;

    // --- Directional Lights ---
    // Sun: Very bright direct light for high contrast
    const sunWarmth = Math.max(0, 1 - sunHeight * 1.5);
    sun.color.setRGB(
        1.0,
        0.8 + sunHeight * 0.2,
        0.6 + sunHeight * 0.4 - sunWarmth * 0.15
    );
    sun.intensity = 3.0 * Math.pow(Math.max(0, sunHeight), 0.45);

    // Moon: Bright cool blue light (actually illuminates surfaces!)
    moon.color.setRGB(0.55, 0.68, 1.0);
    moon.intensity = 0.95 * Math.pow(Math.max(0, moonHeight), 0.4);

    // --- Ambient Light (STRONG Block Color Tinting) ---
    // Golden hour: VERY warm orange
    const warmR = 1.0, warmG = 0.5, warmB = 0.2;   // Strong orange!
    // Day: neutral white
    const dayR = 1.0, dayG = 1.0, dayB = 1.0;
    // Night: STRONG blue
    const nightR = 0.52, nightG = 0.62, nightB = 0.9;

    let ambientR, ambientG, ambientB;

    if (sunHeight > 0) {
        // Blend between warm (golden hour) and neutral (day)
        ambientR = warmR * goldenIntensity + dayR * (1 - goldenIntensity);
        ambientG = warmG * goldenIntensity + dayG * (1 - goldenIntensity);
        ambientB = warmB * goldenIntensity + dayB * (1 - goldenIntensity);
        // Low ambient for dark shadows, boost during golden hour
        ambientLight.intensity = 0.15 + dayFactor * 0.11 + goldenIntensity * 0.07;
    } else {
        // Night: Strong blue tint on blocks
        const nightBlend = Math.min(1, nightFactor * 1.2);
        ambientR = warmR * (1 - nightBlend) + nightR * nightBlend;
        ambientG = warmG * (1 - nightBlend) + nightG * nightBlend;
        ambientB = warmB * (1 - nightBlend) + nightB * nightBlend;
        ambientLight.intensity = 0.25 + (1 - nightBlend) * 0.04;
    }
    ambientLight.color.setRGB(ambientR, ambientG, ambientB);

    // --- Hemisphere Light ---
    // Night: brighter hemi light for moonlit fill
    hemiLight.intensity = 0.22 + dayFactor * 0.18 + nightFactor * 0.24;
    hemiLight.color.copy(bottomColor);

    if (isGoldenHour) {
        hemiLight.groundColor.setRGB(0.45, 0.28, 0.15);
    } else if (sunHeight > 0) {
        hemiLight.groundColor.setRGB(0.28, 0.22, 0.15);
    } else {
        hemiLight.color.lerp(nightHemisphereFill, nightFactor * 0.8);
        hemiLight.groundColor.setRGB(0.32, 0.38, 0.55);
    }

    // --- God Rays ---
    sunGodRaysEffect.blendMode.opacity.value = sunOpacity * 0.38;
    moonGodRaysEffect.blendMode.opacity.value = moonOpacity * 0.2;

    // --- SSAO Intensity ---
    // Stronger at night, subtle during day (shadows provided by sun)
    ssaoEffect.intensity = 1.05 + nightFactor * 0.12;

    // --- Color Grading (Subtle - colors come from ambient light) ---
    if (isGoldenHour && sunHeight > -0.1) {
        // Gentle warmth boost (main color from ambient light)
        hueSaturationEffect.hue = -goldenIntensity * 0.04;
        hueSaturationEffect.saturation = 0.08 + goldenIntensity * 0.12;
        brightnessContrastEffect.brightness = 0.01 + goldenIntensity * 0.015;
        brightnessContrastEffect.contrast = 0.06 + goldenIntensity * 0.04;
    } else if (sunHeight < 0) {
        // Gentle blue boost (main color from ambient light)
        const nightTint = Math.pow(nightFactor, 0.9);
        hueSaturationEffect.hue = nightTint * 0.04;
        hueSaturationEffect.saturation = 0.04 - nightTint * 0.02;
        brightnessContrastEffect.brightness = 0.01 + nightTint * 0.01;
        brightnessContrastEffect.contrast = 0.06 - nightTint * 0.02;
    } else {
        hueSaturationEffect.hue = 0;
        hueSaturationEffect.saturation = 0.08;
        brightnessContrastEffect.brightness = 0.015;
        brightnessContrastEffect.contrast = 0.06;
    }

    // --- Bloom ---
    bloomEffect.intensity = 0.32 + goldenIntensity * 0.2 + nightFactor * 0.12;
    scene.fog.density = 0.014 + nightFactor * 0.007 + goldenIntensity * 0.002;

    sunMat.color.setHex(0xffffff);
    moonMat.color.setHex(0xccddff);
}

addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
});

export function updateFOV(newFov) {
    fov = newFov;
    if (!zoomActive) camera.fov = fov;
    camera.updateProjectionMatrix();
}

export function adjustZoomLevel(direction) {
    if (!zoomActive) {
        zoomLevel = DEFAULT_ZOOM_LEVEL;
        zoomActive = true;
    }
    zoomLevel = Math.min(
        ZOOM_LEVELS.length - 1,
        Math.max(0, zoomLevel + Math.sign(direction)),
    );
}

export function updateZoom(dt, active) {
    if (active && !zoomActive) zoomLevel = DEFAULT_ZOOM_LEVEL;
    zoomActive = active;
    const target = active ? fov * ZOOM_LEVELS[zoomLevel] : fov;
    const blend = 1 - Math.exp(-dt * (active ? 13 : 10));
    const nextFov = camera.fov + (target - camera.fov) * blend;
    if (Math.abs(nextFov - camera.fov) < 0.001) return;
    camera.fov = nextFov;
    camera.updateProjectionMatrix();
}

export function disposeGraphics() {
    renderer.setAnimationLoop(null);

    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    scene.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry);
        const objectMaterials = Array.isArray(object.material)
            ? object.material
            : [object.material];
        for (const material of objectMaterials) {
            if (!material) continue;
            materials.add(material);
            for (const value of Object.values(material)) {
                if (value?.isTexture) textures.add(value);
            }
        }
    });

    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    sun.shadow.dispose();
    moon.shadow.dispose();
    composer.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
}
