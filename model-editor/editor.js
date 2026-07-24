const CANVAS_SIZE = 64;
const LAYER_PADDING = 0;
const LAYER_SIZE = CANVAS_SIZE + LAYER_PADDING * 2;
const CANVAS_CONTEXT_OPTIONS = { colorSpace: "srgb", willReadFrequently: true };
const ORIENTATIONS = [
    { id: "front", label: "Front", icon: "square", x: 0, y: 0 },
    { id: "back", label: "Back", icon: "square-dashed", x: 0, y: Math.PI },
    { id: "right", label: "Left", icon: "panel-left", x: 0, y: -Math.PI / 2 },
    { id: "left", label: "Right", icon: "panel-right", x: 0, y: Math.PI / 2 },
    { id: "bottom", label: "Bottom", icon: "panel-bottom", x: -Math.PI / 2, y: 0 },
    { id: "top", label: "Top", icon: "panel-top", x: Math.PI / 2, y: 0 },
];
const viewKey = (orientation, id) => `${orientation}:${id}`;
const voxelKey = (x, y, z) => (y * CANVAS_SIZE + x) * CANVAS_SIZE + z + CANVAS_SIZE / 2;
const voxelCoordinates = (key) => {
    const z = key % CANVAS_SIZE - CANVAS_SIZE / 2;
    const index = Math.floor(key / CANVAS_SIZE);
    return { x: index % CANVAS_SIZE, y: Math.floor(index / CANVAS_SIZE), z };
};
const validVoxelKey = (key) => Number.isInteger(key) && key >= 0 && key < CANVAS_SIZE ** 3;
const validVoxelColor = (color) => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color);
const layerDepth = (layer) => {
    const depth = Math.trunc(Number(layer?.depth));
    return !Number.isFinite(depth) || depth === 0 ? 1 : Math.max(-CANVAS_SIZE, Math.min(CANVAS_SIZE, depth));
};
const layerOffset = (layer) => {
    const offset = Number(layer?.offset);
    return Math.max(-CANVAS_SIZE / 2, Math.min(CANVAS_SIZE / 2, Number.isFinite(offset) ? Math.floor(offset) : 0));
};
const layerDepthLimits = (offset) => ({
    min: -Math.min(CANVAS_SIZE, CANVAS_SIZE / 2 + 1 + offset),
    max: Math.min(CANVAS_SIZE, CANVAS_SIZE / 2 + 1 - offset),
});
const layerOffsetLimits = (depth) => depth > 0
    ? { min: -CANVAS_SIZE / 2, max: CANVAS_SIZE / 2 + 1 - depth }
    : { min: -CANVAS_SIZE / 2 - 1 - depth, max: CANVAS_SIZE / 2 };
const clampLayerDepth = (layer, offset = layerOffset(layer)) => {
    const depth = layerDepth(layer);
    const limits = layerDepthLimits(offset);
    return depth < 0 ? Math.max(limits.min, depth) : Math.min(limits.max, depth);
};
const clampLayerOffset = (layer, depth = layerDepth(layer)) => {
    const offset = layerOffset(layer);
    const limits = layerOffsetLimits(depth);
    return Math.max(limits.min, Math.min(limits.max, offset));
};
const layerDepthRanges = (layers) => {
    const ranges = new Map();
    for (const layer of layers) {
        const offset = layerOffset(layer);
        const depth = layerDepth(layer);
        ranges.set(layer.id, depth > 0
            ? { start: Math.min(CANVAS_SIZE / 2, 1 - offset) - depth, end: Math.min(CANVAS_SIZE / 2, 1 - offset) }
            : { start: Math.max(-CANVAS_SIZE / 2, -1 - offset), end: Math.max(-CANVAS_SIZE / 2, -1 - offset) - depth });
    }
    return ranges;
};
const modelDepthBounds = (layers) => {
    const ranges = [...layerDepthRanges(layers).values()];
    return ranges.length
        ? { back: Math.min(...ranges.map((range) => range.start)), front: Math.max(...ranges.map((range) => range.end)) }
        : { back: 0, front: 0 };
};
const containsDepthZ = (range, z) => z >= range.start && z < range.end;

const maskIndex = (x, y) => (y + LAYER_PADDING) * LAYER_SIZE + x + LAYER_PADDING;
const voxelOccupied = (views, x, y, z) => (views.front[(y * CANVAS_SIZE + x) * 4 + 3] || views.back[(y * CANVAS_SIZE + 63 - x) * 4 + 3])
    && (views.right[(y * CANVAS_SIZE + 31 - z) * 4 + 3] || views.left[(y * CANVAS_SIZE + 32 + z) * 4 + 3])
    && (views.top[((32 + z) * CANVAS_SIZE + x) * 4 + 3] || views.bottom[((31 - z) * CANVAS_SIZE + x) * 4 + 3]);
const voxelSelected = (masks, x, y, z) => (masks.front[maskIndex(x, y)] || masks.back[maskIndex(63 - x, y)])
    && (masks.right[maskIndex(31 - z, y)] || masks.left[maskIndex(32 + z, y)])
    && (masks.top[maskIndex(x, 32 + z)] || masks.bottom[maskIndex(x, 31 - z)]);

function createLayerCanvas() {
    const canvas = document.createElement("canvas");
    canvas.width = LAYER_SIZE;
    canvas.height = LAYER_SIZE;
    canvas.getContext("2d", CANVAS_CONTEXT_OPTIONS).imageSmoothingEnabled = false;
    return canvas;
}

function encodeImageData(image) {
    let binary = "";
    for (let offset = 0; offset < image.data.length; offset += 0x8000) binary += String.fromCharCode(...image.data.subarray(offset, offset + 0x8000));
    return btoa(binary);
}

function decodeImageData(encoded) {
    const binary = atob(encoded);
    const data = new Uint8ClampedArray(binary.length);
    for (let index = 0; index < binary.length; index++) data[index] = binary.charCodeAt(index);
    return new ImageData(data, LAYER_SIZE, LAYER_SIZE);
}

async function decodeImage(file) {
    if (window.createImageBitmap) return createImageBitmap(file);
    const url = URL.createObjectURL(file);
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            URL.revokeObjectURL(url);
            resolve(image);
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error(`Unable to open ${file.name}`));
        };
        image.src = url;
    });
}

function canvasBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function blobDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

async function blobImageData(blob) {
    const image = await decodeImage(blob);
    const canvas = createLayerCanvas();
    canvas.getContext("2d", CANVAS_CONTEXT_OPTIONS).drawImage(image, 0, 0, LAYER_SIZE, LAYER_SIZE);
    image.close?.();
    return canvas.getContext("2d", CANVAS_CONTEXT_OPTIONS).getImageData(0, 0, LAYER_SIZE, LAYER_SIZE);
}

async function encodeLosslessTexture(image) {
    const canvas = createLayerCanvas();
    canvas.getContext("2d", CANVAS_CONTEXT_OPTIONS).putImageData(image, 0, 0);
    const webp = await canvasBlob(canvas, "image/webp", 1);
    if (webp?.type === "image/webp") {
        const decoded = await blobImageData(webp);
        if (decoded.data.every((channel, index) => channel === image.data[index])) return blobDataUrl(webp);
    }
    return blobDataUrl(await canvasBlob(canvas, "image/png"));
}

async function decodeTexture(dataUrl) {
    return blobImageData(await (await fetch(dataUrl)).blob());
}

function rectangleMask(x, y, width, height) {
    const mask = new Uint8Array(LAYER_SIZE * LAYER_SIZE);
    for (let py = y; py < y + height; py++) for (let px = x; px < x + width; px++) mask[maskIndex(px, py)] = 1;
    return mask;
}

function maskBounds(mask) {
    let found = false;
    let minX = LAYER_SIZE;
    let minY = LAYER_SIZE;
    let maxX = -1;
    let maxY = -1;
    for (let index = 0; index < mask.length; index++) {
        if (!mask[index]) continue;
        found = true;
        const x = index % LAYER_SIZE - LAYER_PADDING;
        const y = Math.floor(index / LAYER_SIZE) - LAYER_PADDING;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    }
    return found ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null;
}

function maskPath(mask) {
    let path = "";
    const selected = (x, y) => x >= -LAYER_PADDING && x < CANVAS_SIZE + LAYER_PADDING
        && y >= -LAYER_PADDING && y < CANVAS_SIZE + LAYER_PADDING
        && mask[maskIndex(x, y)];
    for (let y = -LAYER_PADDING; y < CANVAS_SIZE + LAYER_PADDING; y++) for (let x = -LAYER_PADDING; x < CANVAS_SIZE + LAYER_PADDING; x++) {
        if (!selected(x, y)) continue;
        if (!selected(x, y - 1)) path += `M${x} ${y}h1`;
        if (!selected(x + 1, y)) path += `M${x + 1} ${y}v1`;
        if (!selected(x, y + 1)) path += `M${x + 1} ${y + 1}h-1`;
        if (!selected(x - 1, y)) path += `M${x} ${y + 1}v-1`;
    }
    return path;
}

function translateMask(mask, dx, dy) {
    const translated = new Uint8Array(LAYER_SIZE * LAYER_SIZE);
    for (let index = 0; index < mask.length; index++) {
        if (!mask[index]) continue;
        const x = index % LAYER_SIZE - LAYER_PADDING + dx;
        const y = Math.floor(index / LAYER_SIZE) - LAYER_PADDING + dy;
        if (x >= -LAYER_PADDING && x < CANVAS_SIZE + LAYER_PADDING && y >= -LAYER_PADDING && y < CANVAS_SIZE + LAYER_PADDING) translated[maskIndex(x, y)] = 1;
    }
    return translated;
}

function clearMaskedPixels(context, mask) {
    for (let index = 0; index < mask.length; index++) {
        if (mask[index]) context.clearRect(index % LAYER_SIZE, Math.floor(index / LAYER_SIZE), 1, 1);
    }
}

function selectionPixels(source, mask, bounds) {
    const canvas = document.createElement("canvas");
    canvas.width = bounds.width;
    canvas.height = bounds.height;
    const context = canvas.getContext("2d", CANVAS_CONTEXT_OPTIONS);
    const pixels = source.getContext("2d").getImageData(bounds.x + LAYER_PADDING, bounds.y + LAYER_PADDING, bounds.width, bounds.height);
    for (let y = 0; y < bounds.height; y++) for (let x = 0; x < bounds.width; x++) {
        if (mask[maskIndex(bounds.x + x, bounds.y + y)]) continue;
        const offset = (y * bounds.width + x) * 4;
        pixels.data[offset] = pixels.data[offset + 1] = pixels.data[offset + 2] = pixels.data[offset + 3] = 0;
    }
    context.putImageData(pixels, 0, 0);
    return canvas;
}

function maskedLayerPixels(source, mask) {
    const canvas = createLayerCanvas();
    const context = canvas.getContext("2d", CANVAS_CONTEXT_OPTIONS);
    const pixels = source.getContext("2d").getImageData(0, 0, LAYER_SIZE, LAYER_SIZE);
    for (let index = 0; index < mask.length; index++) if (!mask[index]) pixels.data.fill(0, index * 4, index * 4 + 4);
    context.putImageData(pixels, 0, 0);
    return canvas;
}

function hexColor(hex) {
    return [
        Number.parseInt(hex.slice(1, 3), 16),
        Number.parseInt(hex.slice(3, 5), 16),
        Number.parseInt(hex.slice(5, 7), 16),
        255,
    ];
}

function quantizeImage(source, maxColors) {
    const result = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
    const colorMap = new Map();
    for (let offset = 0; offset < source.data.length; offset += 4) {
        if (!source.data[offset + 3]) continue;
        const key = source.data[offset] << 16 | source.data[offset + 1] << 8 | source.data[offset + 2];
        const color = colorMap.get(key);
        if (color) color.count++;
        else colorMap.set(key, { key, r: source.data[offset], g: source.data[offset + 1], b: source.data[offset + 2], count: 1 });
    }
    if (colorMap.size <= maxColors) return result;

    const colors = [...colorMap.values()];
    const distance = (a, b) => {
        const redMean = (a.r + b.r) / 2;
        return (2 + redMean / 256) * (a.r - b.r) ** 2
            + 4 * (a.g - b.g) ** 2
            + (2 + (255 - redMean) / 256) * (a.b - b.b) ** 2;
    };
    const palette = [colors.reduce((best, color) => color.count > best.count ? color : best)];
    const nearest = new Map(colors.map((color) => [color.key, distance(color, palette[0])]));
    while (palette.length < maxColors) {
        const next = colors.reduce((best, color) => {
            const score = nearest.get(color.key) * (1 + Math.log2(color.count));
            return score > best.score ? { color, score } : best;
        }, { color: colors[0], score: -1 }).color;
        palette.push(next);
        for (const color of colors) nearest.set(color.key, Math.min(nearest.get(color.key), distance(color, next)));
    }

    const matches = new Map();
    for (const color of colorMap.values()) {
        matches.set(color.key, palette.reduce((best, candidate) => {
            const difference = distance(color, candidate);
            return difference < best.distance ? { color: candidate, distance: difference } : best;
        }, { color: palette[0], distance: Infinity }).color);
    }
    for (let offset = 0; offset < result.data.length; offset += 4) {
        if (!result.data[offset + 3]) continue;
        const key = result.data[offset] << 16 | result.data[offset + 1] << 8 | result.data[offset + 2];
        const match = matches.get(key);
        [result.data[offset], result.data[offset + 1], result.data[offset + 2]] = [match.r, match.g, match.b];
    }
    return result;
}

function imagePalette(image, maxColors = 64) {
    const counts = new Map();
    for (let offset = 0; offset < image.data.length; offset += 4) {
        if (!image.data[offset + 3]) continue;
        const color = `#${image.data[offset].toString(16).padStart(2, "0")}${image.data[offset + 1].toString(16).padStart(2, "0")}${image.data[offset + 2].toString(16).padStart(2, "0")}`;
        counts.set(color, (counts.get(color) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]).map(([color]) => color).slice(0, maxColors);
}

document.addEventListener("alpine:init", () => {
    Alpine.data("pixelEditor", () => {
        const canvases = new Map();
        const transparentDragImage = document.createElement("canvas");
        transparentDragImage.width = transparentDragImage.height = 1;
        let nextLayerId = 0;
        let nextPaletteId = 0;
        let nextGroupId = 0;
        let selectionAnchor = null;
        let selectionMask = null;
        let selectionViewKey = null;
        let perspectiveSelectionMasks = null;
        let moveState = null;
        let straightStroke = null;
        let internalClipboard = null;
        let pasteAuthorizedUntil = 0;
        let layerValueEdit = null;
        let pointerTarget = null;
        let quantizationSource = null;
        let paletteHighlightTimer = null;
        let THREE = null;
        let voxelRenderer = null;
        let voxelDisplayContext = null;
        let previewDisplayContext = null;
        let sharedRendererSize = 0;
        let voxelRenderFrame = null;
        let voxelRulersDirty = true;
        let voxelRulerCoordinate = null;
        let voxelContextLost = false;
        let voxelScene = null;
        let voxelCamera = null;
        let voxelRoot = null;
        let voxelViewRoot = null;
        let voxelBackdrop = null;
        let voxelGeometry = null;
        let voxelMaterial = null;
        let previewVoxelMaterial = null;
        const previewGridUniform = { value: 0 };
        let voxelHighlightMesh = null;
        let voxelHighlightFrame = null;
        let voxelCursor = null;
        const voxelMirrorCursors = [];
        let voxelCrosshair = null;
        let voxelSelection = null;
        let voxelSelectionFrame = null;
        let voxelGrid = null;
        let voxelSnapFrame = null;
        let voxelPan = null;
        let voxelResizeObserver = null;
        let voxelRaycaster = null;
        let previewRenderFrame = null;
        let previewInteracting = false;
        let previewViewDirection = null;
        let previewInverseQuaternion = null;
        let previewFaceNormals = null;
        let previewScene = null;
        let previewCamera = null;
        let previewRoot = null;
        let previewModelRoot = null;
        let previewHighlightMesh = null;
        let previewVoxelCursor = null;
        let previewWallHit = null;
        let previewWallHitFrame = null;
        let previewDrag = null;
        let previewSnapFrame = null;
        let previewResizeObserver = null;
        let modelRenderFrame = null;
        const voxelLayerMeshes = new Map();
        const voxelFaceMeshes = new Map();
        const previewLayerMeshes = new Map();
        const previewFaceMeshes = new Map();
        const voxelFaceGeometries = new Map();
        const quantizedPalettes = new Map();
        const paletteOrders = new Map();
        const paletteSources = new Map();
        const paletteSourcePalettes = new Map();
        const paletteSourceEdits = new Set();
        const editedViews = new Set();
        const voxelColorOverrides = new Map();
        const copyVoxelOverrides = (id) => new Map(voxelColorOverrides.get(id) ?? []);
        const setVoxelOverrides = (id, overrides) => {
            if (overrides?.size) voxelColorOverrides.set(id, overrides);
            else voxelColorOverrides.delete(id);
        };
        const deletePaletteSource = (key) => {
            paletteSources.delete(key);
            paletteSourcePalettes.delete(key);
        };

        return {
            projectName: "New File",
            tool: "pencil",
            pencilSize: 1,
            eraserSize: 1,
            quantization: 64,
            quantizationMax: 64,
            quantizationPending: false,
            wandTolerance: 1,
            color: "#000000",
            palette: [],
            importedPalettes: [],
            activePaletteId: "default",
            appliedPaletteId: "default",
            gridVisible: false,
            verticalSymmetry: false,
            horizontalSymmetry: false,
            voxelReady: false,
            voxelZoom: 1,
            previewGridVisible: false,
            previewPreset: "perspective",
            orientations: ORIENTATIONS,
            activeOrientation: "front",
            layers: [],
            groups: [],
            activeLayerId: null,
            activeGroupId: null,
            selectedLayerIds: [],
            layerSelectionAnchorId: null,
            draggedLayerId: null,
            draggedLayerIds: [],
            draggedLayerWasGrouped: false,
            draggedLayerOriginalGroupId: null,
            draggedGroupId: null,
            editingLayerId: null,
            editingGroupId: null,
            layerDragChanged: false,
            layerDropTarget: null,
            layerDropPosition: null,
            dropActive: false,
            selection: null,
            selectionPath: "",
            canvasMenu: null,
            layerMenu: null,
            centerGuideX: false,
            centerGuideY: false,
            hoverPoint: null,
            history: [],
            future: [],
            drawing: false,
            sampling: false,
            pointerId: null,
            lastPoint: null,
            context: null,

            init() {
                if (this.context) return;
                this.context = this.$refs.canvas.getContext("2d", CANVAS_CONTEXT_OPTIONS);
                this.context.imageSmoothingEnabled = false;
                this.$watch("projectName", (name) => { document.title = name.trim() || "New File"; });
                this.$watch("tool", () => {
                    this.confirmQuantization();
                    this.clearCenterGuides();
                });
                this.$watch("gridVisible", (visible) => {
                    if (voxelGrid) voxelGrid.visible = visible && !voxelSnapFrame;
                    this.renderVoxelScene();
                });
                this.$watch("previewGridVisible", (visible) => {
                    previewGridUniform.value = Number(visible);
                    this.renderPreviewScene();
                });
                window.addEventListener("blur", () => { internalClipboard = null; });
                this.render();
                this.refreshUI();
                import("https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js")
                    .then((module) => { THREE = module; this.initVoxelScene(); })
                    .catch(console.error);
            },

            initVoxelScene() {
                const canvas = this.$refs.voxelCanvas;
                voxelDisplayContext = canvas.getContext("2d");
                const renderCanvas = document.createElement("canvas");
                voxelRenderer = new THREE.WebGLRenderer({ canvas: renderCanvas, antialias: false, alpha: false, premultipliedAlpha: false, precision: "highp", powerPreference: "high-performance" });
                voxelRenderer.setPixelRatio(2);
                voxelRenderer.outputColorSpace = THREE.SRGBColorSpace;
                voxelRenderer.toneMapping = THREE.NoToneMapping;
                voxelRenderer.getContext().disable(voxelRenderer.getContext().DITHER);
                renderCanvas.addEventListener("webglcontextlost", (event) => {
                    event.preventDefault();
                    voxelContextLost = true;
                    cancelAnimationFrame(voxelRenderFrame);
                    cancelAnimationFrame(previewRenderFrame);
                    voxelRenderFrame = null;
                    previewRenderFrame = null;
                });
                renderCanvas.addEventListener("webglcontextrestored", () => {
                    voxelContextLost = false;
                    this.renderVoxelScene();
                    this.renderPreviewScene();
                });
                voxelScene = new THREE.Scene();
                voxelScene.background = new THREE.Color(0xffffff);
                const viewSize = CANVAS_SIZE;
                voxelCamera = new THREE.OrthographicCamera(-viewSize / 2, viewSize / 2, viewSize / 2, -viewSize / 2, 1, 200);
                voxelCamera.position.z = 100;
                voxelCamera.zoom = this.voxelZoom;
                this.$refs.canvas.addEventListener("wheel", (event) => {
                    event.preventDefault();
                    this.setVoxelZoom(voxelCamera.zoom * Math.exp(-event.deltaY * 0.001), event);
                }, { passive: false });
                voxelRoot = new THREE.Group();
                voxelScene.add(voxelRoot);
                voxelViewRoot = new THREE.Group();
                voxelRoot.add(voxelViewRoot);
                const orientation = this.orientationRotation();
                voxelRoot.rotation.set(orientation.x, orientation.y, 0);
                voxelViewRoot.rotation.set(-orientation.x, -orientation.y, 0);

                const checker = document.createElement("canvas");
                checker.width = checker.height = 16;
                const checkerContext = checker.getContext("2d", CANVAS_CONTEXT_OPTIONS);
                checkerContext.fillStyle = "#e6e8e8";
                checkerContext.fillRect(0, 0, 16, 16);
                checkerContext.fillStyle = "#c7cbcc";
                checkerContext.fillRect(0, 0, 8, 8);
                checkerContext.fillRect(8, 8, 8, 8);
                const checkerTexture = new THREE.CanvasTexture(checker);
                checkerTexture.wrapS = checkerTexture.wrapT = THREE.RepeatWrapping;
                checkerTexture.repeat.set(8, 8);
                checkerTexture.colorSpace = THREE.SRGBColorSpace;
                checkerTexture.magFilter = THREE.NearestFilter;
                checkerTexture.minFilter = THREE.NearestFilter;
                checkerTexture.generateMipmaps = false;
                voxelBackdrop = new THREE.Mesh(
                    new THREE.PlaneGeometry(CANVAS_SIZE, CANVAS_SIZE),
                    new THREE.MeshBasicMaterial({ map: checkerTexture, depthTest: false, depthWrite: false, toneMapped: false, dithering: false }),
                );
                voxelBackdrop.renderOrder = -10;
                voxelScene.add(voxelBackdrop);

                voxelGrid = new THREE.GridHelper(CANVAS_SIZE, CANVAS_SIZE, 0x747b7f, 0x747b7f);
                voxelGrid.rotation.x = Math.PI / 2;
                voxelGrid.position.z = 0.02;
                voxelGrid.material.transparent = true;
                voxelGrid.material.opacity = 0.28;
                voxelGrid.visible = this.gridVisible;
                voxelViewRoot.add(voxelGrid);

                voxelGeometry = new THREE.BoxGeometry(1.001, 1.001, 1);
                voxelMaterial = new THREE.MeshBasicMaterial({ toneMapped: false, dithering: false, fog: false });
                previewVoxelMaterial = voxelMaterial.clone();
                previewVoxelMaterial.onBeforeCompile = (shader) => {
                    shader.uniforms.previewGridVisible = previewGridUniform;
                    shader.vertexShader = shader.vertexShader
                        .replace("#include <common>", "#include <common>\nvarying vec2 previewGridUv;")
                        .replace("#include <uv_vertex>", "#include <uv_vertex>\npreviewGridUv = uv;");
                    shader.fragmentShader = shader.fragmentShader
                        .replace("#include <common>", "#include <common>\nvarying vec2 previewGridUv;\nuniform float previewGridVisible;")
                        .replace("#include <color_fragment>", `#include <color_fragment>
                            float previewGridEdge = min(min(previewGridUv.x, 1.0 - previewGridUv.x), min(previewGridUv.y, 1.0 - previewGridUv.y));
                            float previewGridWidth = fwidth(previewGridEdge);
                            float previewGridLine = 1.0 - smoothstep(previewGridWidth, previewGridWidth * 2.0, previewGridEdge);
                            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.455, 0.475, 0.49), previewGridLine * previewGridVisible);
                        `);
                };
                previewVoxelMaterial.customProgramCacheKey = () => "preview-voxel-grid";
                for (const orientation of ORIENTATIONS) {
                    const geometry = new THREE.PlaneGeometry(1.05, 1.05);
                    if (orientation.id === "back") geometry.rotateY(Math.PI);
                    if (orientation.id === "right") geometry.rotateY(Math.PI / 2);
                    if (orientation.id === "left") geometry.rotateY(-Math.PI / 2);
                    if (orientation.id === "top") geometry.rotateX(-Math.PI / 2);
                    if (orientation.id === "bottom") geometry.rotateX(Math.PI / 2);
                    voxelFaceGeometries.set(orientation.id, geometry);
                }
                voxelHighlightMesh = new THREE.InstancedMesh(
                    new THREE.BoxGeometry(1.02, 1.02, 1.06),
                    new THREE.MeshBasicMaterial({ color: 0xff00ff, transparent: true, opacity: 0, depthWrite: false }),
                    CANVAS_SIZE * CANVAS_SIZE,
                );
                voxelHighlightMesh.count = 0;
                voxelHighlightMesh.renderOrder = 10;
                voxelViewRoot.add(voxelHighlightMesh);
                voxelCursor = new THREE.LineSegments(
                    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1.08)),
                    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false, depthWrite: false }),
                );
                voxelCursor.visible = false;
                voxelCursor.renderOrder = 13;
                voxelViewRoot.add(voxelCursor);
                for (let index = 0; index < 3; index++) {
                    const cursor = new THREE.LineSegments(
                        voxelCursor.geometry,
                        new THREE.LineBasicMaterial({ color: 0xff00ff, transparent: true, depthTest: false, depthWrite: false }),
                    );
                    cursor.visible = false;
                    cursor.renderOrder = 13;
                    voxelMirrorCursors.push(cursor);
                    voxelViewRoot.add(cursor);
                }
                voxelCrosshair = new THREE.LineSegments(
                    new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([
                        -0.42, 0, 0, -0.12, 0, 0,
                        0.12, 0, 0, 0.42, 0, 0,
                        0, -0.42, 0, 0, -0.12, 0,
                        0, 0.12, 0, 0, 0.42, 0,
                    ], 3)),
                    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false, depthWrite: false }),
                );
                voxelCrosshair.visible = false;
                voxelCrosshair.renderOrder = 14;
                voxelViewRoot.add(voxelCrosshair);
                voxelSelection = new THREE.LineSegments(
                    new THREE.BufferGeometry(),
                    new THREE.ShaderMaterial({
                        uniforms: { phase: { value: 0 } },
                        vertexShader: `
                            attribute float lineDistance;
                            varying float distanceAlongLine;
                            void main() {
                                distanceAlongLine = lineDistance;
                                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                            }
                        `,
                        fragmentShader: `
                            uniform float phase;
                            varying float distanceAlongLine;
                            void main() {
                                float band = mod(distanceAlongLine + phase, 0.5);
                                vec3 color = band < 0.25 ? vec3(1.0) : vec3(0.08, 0.09, 0.10);
                                gl_FragColor = vec4(color, 1.0);
                            }
                        `,
                        transparent: true,
                        depthTest: false,
                        depthWrite: false,
                        toneMapped: false,
                    }),
                );
                voxelSelection.visible = false;
                voxelSelection.renderOrder = 12;
                voxelViewRoot.add(voxelSelection);
                voxelRaycaster = new THREE.Raycaster();

                const resize = () => {
                    const size = canvas.getBoundingClientRect();
                    canvas.width = Math.max(1, Math.round(size.width * 2));
                    canvas.height = Math.max(1, Math.round(size.height * 2));
                    this.updateSharedRendererSize();
                    for (const element of this.$refs.previewCanvas.closest(".workspace-content").querySelectorAll(".preview-controls, .future-window")) element.style.maxWidth = `${size.height}px`;
                    const aspect = size.width / size.height;
                    voxelCamera.left = -viewSize * aspect / 2;
                    voxelCamera.right = viewSize * aspect / 2;
                    voxelCamera.top = viewSize / 2;
                    voxelCamera.bottom = -viewSize / 2;
                    voxelCamera.updateProjectionMatrix();
                    voxelRulersDirty = true;
                    this.renderVoxelScene();
                };
                voxelResizeObserver = new ResizeObserver(resize);
                voxelResizeObserver.observe(canvas);
                this.voxelReady = true;
                resize();
                this.initPreviewScene();
                this.renderVoxels();
            },

            updateSharedRendererSize() {
                if (!voxelRenderer) return;
                const main = this.$refs.voxelCanvas.getBoundingClientRect();
                const preview = this.$refs.previewCanvas.getBoundingClientRect();
                const size = Math.max(1, Math.ceil(Math.max(main.width, main.height, preview.width, preview.height)));
                if (size === sharedRendererSize) return;
                sharedRendererSize = size;
                voxelRenderer.setSize(size, size, false);
            },

            renderSharedScene(scene, camera, canvas, context) {
                voxelRenderer.setViewport(0, 0, canvas.width / 2, canvas.height / 2);
                voxelRenderer.render(scene, camera);
                context.drawImage(
                    voxelRenderer.domElement,
                    0,
                    voxelRenderer.domElement.height - canvas.height,
                    canvas.width,
                    canvas.height,
                    0,
                    0,
                    canvas.width,
                    canvas.height,
                );
            },

            renderVoxelScene() {
                if (previewInteracting || voxelContextLost) return;
                if (!voxelRenderer || voxelRenderFrame) return;
                voxelRenderFrame = requestAnimationFrame(() => {
                    voxelRenderFrame = null;
                    if (voxelRulersDirty) {
                        voxelRulersDirty = false;
                        this.renderCanvasRulers();
                    }
                    this.renderSharedScene(voxelScene, voxelCamera, this.$refs.voxelCanvas, voxelDisplayContext);
                });
            },

            renderCanvasRulers() {
                if (!voxelCamera || !this.$refs.horizontalRuler) return;
                const size = this.$refs.voxelCanvas.getBoundingClientRect();
                const ratio = Math.min(window.devicePixelRatio, 2);
                const prepare = (canvas, width, height) => {
                    const pixelWidth = Math.round(width * ratio);
                    const pixelHeight = Math.round(height * ratio);
                    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
                    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
                    const context = canvas.getContext("2d");
                    context.setTransform(ratio, 0, 0, ratio, 0, 0);
                    context.clearRect(0, 0, width, height);
                    context.fillStyle = "#1b1e21";
                    context.fillRect(0, 0, width, height);
                    context.strokeStyle = "#72797d";
                    context.fillStyle = "#b8bdc0";
                    context.font = "9px Inter, sans-serif";
                    return context;
                };
                const horizontal = this.$refs.horizontalRuler;
                const vertical = this.$refs.verticalRuler;
                const horizontalHeight = horizontal.getBoundingClientRect().height;
                const verticalWidth = vertical.getBoundingClientRect().width;
                const horizontalContext = prepare(horizontal, size.width, horizontalHeight);
                const verticalContext = prepare(vertical, verticalWidth, size.height);
                const visibleWidth = (voxelCamera.right - voxelCamera.left) / voxelCamera.zoom;
                const visibleHeight = (voxelCamera.top - voxelCamera.bottom) / voxelCamera.zoom;
                const left = voxelCamera.position.x - visibleWidth / 2;
                const top = voxelCamera.position.y + visibleHeight / 2;
                horizontalContext.beginPath();
                verticalContext.beginPath();
                for (let value = 1; value <= CANVAS_SIZE; value++) {
                    const major = value % 8 === 0;
                    const medium = value % 4 === 0;
                    const length = major ? 10 : medium ? 7 : 4;
                    const x = (value - CANVAS_SIZE / 2 - left) / visibleWidth * size.width;
                    if (x >= 0 && x <= size.width) {
                        horizontalContext.moveTo(Math.round(x) + 0.5, 0);
                        horizontalContext.lineTo(Math.round(x) + 0.5, length);
                        if (major) {
                            horizontalContext.textAlign = "center";
                            horizontalContext.textBaseline = "bottom";
                            horizontalContext.fillText(value, x, horizontalHeight - 2);
                        }
                    }
                    const y = (top - (CANVAS_SIZE / 2 - value)) / visibleHeight * size.height;
                    if (y >= 0 && y <= size.height) {
                        verticalContext.moveTo(0, Math.round(y) + 0.5);
                        verticalContext.lineTo(length, Math.round(y) + 0.5);
                        if (major) {
                            verticalContext.textAlign = "center";
                            verticalContext.textBaseline = "middle";
                            verticalContext.fillText(value, (7 + verticalWidth) / 2, y);
                        }
                    }
                }
                horizontalContext.stroke();
                verticalContext.stroke();
                if (this.hoverPoint) {
                    const coordinateX = Math.max(0, Math.min(CANVAS_SIZE - 1, Math.floor(this.hoverPoint.x))) + 1;
                    const coordinateY = Math.max(0, Math.min(CANVAS_SIZE - 1, Math.floor(this.hoverPoint.y))) + 1;
                    const caretX = (coordinateX - CANVAS_SIZE / 2 - left) / visibleWidth * size.width;
                    const caretY = (top - (CANVAS_SIZE / 2 - coordinateY)) / visibleHeight * size.height;
                    horizontalContext.fillStyle = "#d7dcde";
                    horizontalContext.beginPath();
                    horizontalContext.moveTo(caretX, 0);
                    horizontalContext.lineTo(caretX - 4, 7);
                    horizontalContext.lineTo(caretX + 4, 7);
                    horizontalContext.closePath();
                    horizontalContext.fill();
                    horizontalContext.font = "bold 9px Inter, sans-serif";
                    horizontalContext.textAlign = "center";
                    horizontalContext.textBaseline = "bottom";
                    horizontalContext.fillText(coordinateX, caretX, horizontalHeight - 2);
                    verticalContext.fillStyle = "#d7dcde";
                    verticalContext.beginPath();
                    verticalContext.moveTo(0, caretY);
                    verticalContext.lineTo(7, caretY - 4);
                    verticalContext.lineTo(7, caretY + 4);
                    verticalContext.closePath();
                    verticalContext.fill();
                    verticalContext.font = "bold 9px Inter, sans-serif";
                    verticalContext.textAlign = "center";
                    verticalContext.textBaseline = "middle";
                    verticalContext.fillText(coordinateY, (7 + verticalWidth) / 2, caretY);
                }
            },

            setVoxelZoom(value, event = null) {
                const zoom = Math.max(1, Math.min(4, Number(value) || 1));
                let anchor = null;
                if (voxelCamera && event && zoom > 1) {
                    const rect = this.$refs.canvas.getBoundingClientRect();
                    const x = (event.clientX - rect.left) / rect.width * 2 - 1;
                    const y = -(event.clientY - rect.top) / rect.height * 2 + 1;
                    anchor = {
                        x: voxelCamera.position.x + x * (voxelCamera.right - voxelCamera.left) / (2 * voxelCamera.zoom),
                        y: voxelCamera.position.y + y * (voxelCamera.top - voxelCamera.bottom) / (2 * voxelCamera.zoom),
                        pointerX: x,
                        pointerY: y,
                    };
                }
                this.voxelZoom = zoom;
                if (!voxelCamera) return;
                voxelCamera.zoom = this.voxelZoom;
                if (this.voxelZoom === 1) {
                    voxelCamera.position.x = 0;
                    voxelCamera.position.y = 0;
                } else if (anchor) {
                    voxelCamera.position.x = anchor.x - anchor.pointerX * (voxelCamera.right - voxelCamera.left) / (2 * voxelCamera.zoom);
                    voxelCamera.position.y = anchor.y - anchor.pointerY * (voxelCamera.top - voxelCamera.bottom) / (2 * voxelCamera.zoom);
                }
                this.clampVoxelCamera();
                voxelCamera.updateProjectionMatrix();
                voxelRulersDirty = true;
                this.renderVoxelScene();
            },

            clampVoxelCamera() {
                const limitX = Math.max(0, CANVAS_SIZE / 2 - (voxelCamera.right - voxelCamera.left) / (2 * voxelCamera.zoom));
                const limitY = Math.max(0, CANVAS_SIZE / 2 - (voxelCamera.top - voxelCamera.bottom) / (2 * voxelCamera.zoom));
                voxelCamera.position.x = Math.max(-limitX, Math.min(limitX, voxelCamera.position.x));
                voxelCamera.position.y = Math.max(-limitY, Math.min(limitY, voxelCamera.position.y));
            },

            initPreviewScene() {
                const canvas = this.$refs.previewCanvas;
                previewDisplayContext = canvas.getContext("2d");
                previewScene = new THREE.Scene();
                previewScene.background = new THREE.Color(0xffffff);
                previewCamera = new THREE.OrthographicCamera(-50, 50, 50, -50, 1, 200);
                previewCamera.position.z = 100;
                canvas.addEventListener("wheel", (event) => {
                    event.preventDefault();
                    previewCamera.zoom = THREE.MathUtils.clamp(previewCamera.zoom * Math.exp(-event.deltaY * 0.001), 0.5, 4);
                    previewCamera.updateProjectionMatrix();
                    this.renderPreviewScene();
                }, { passive: false });
                previewRoot = new THREE.Group();
                previewRoot.rotation.set(Math.PI / 6, -Math.PI / 4, 0);
                previewViewDirection = new THREE.Vector3();
                previewInverseQuaternion = new THREE.Quaternion();
                previewFaceNormals = {
                    front: new THREE.Vector3(0, 0, 1),
                    back: new THREE.Vector3(0, 0, -1),
                    right: new THREE.Vector3(1, 0, 0),
                    left: new THREE.Vector3(-1, 0, 0),
                    top: new THREE.Vector3(0, 1, 0),
                    bottom: new THREE.Vector3(0, -1, 0),
                };
                previewModelRoot = new THREE.Group();
                previewRoot.add(previewModelRoot);
                previewHighlightMesh = new THREE.InstancedMesh(voxelHighlightMesh.geometry, voxelHighlightMesh.material, CANVAS_SIZE * CANVAS_SIZE);
                previewHighlightMesh.count = 0;
                previewHighlightMesh.renderOrder = 20;
                previewModelRoot.add(previewHighlightMesh);
                previewVoxelCursor = new THREE.LineSegments(
                    new THREE.EdgesGeometry(new THREE.PlaneGeometry(1.05, 1.05)),
                    new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false }),
                );
                previewVoxelCursor.visible = false;
                previewVoxelCursor.renderOrder = 21;
                previewModelRoot.add(previewVoxelCursor);
                const previewBounds = new THREE.LineSegments(
                    new THREE.EdgesGeometry(new THREE.BoxGeometry(CANVAS_SIZE, CANVAS_SIZE, CANVAS_SIZE)),
                    new THREE.LineBasicMaterial({ color: 0xff00ff, depthTest: true }),
                );
                previewBounds.renderOrder = 15;
                previewRoot.add(previewBounds);
                previewWallHit = new THREE.Group();
                const wallPlane = new THREE.Mesh(
                    new THREE.PlaneGeometry(CANVAS_SIZE, CANVAS_SIZE),
                    new THREE.MeshBasicMaterial({ color: 0x55d6be, transparent: true, opacity: 0, depthTest: false, depthWrite: false, side: THREE.DoubleSide }),
                );
                wallPlane.renderOrder = 17;
                previewWallHit.add(wallPlane);
                const wallFrame = new THREE.LineSegments(
                    new THREE.EdgesGeometry(new THREE.PlaneGeometry(CANVAS_SIZE, CANVAS_SIZE)),
                    new THREE.LineBasicMaterial({ color: 0x75ead4, transparent: true, opacity: 0, depthTest: false }),
                );
                wallFrame.renderOrder = 18;
                previewWallHit.add(wallFrame);
                previewWallHit.visible = false;
                previewRoot.add(previewWallHit);
                const previewAxes = new THREE.LineSegments(
                    new THREE.BufferGeometry()
                        .setAttribute("position", new THREE.Float32BufferAttribute([
                            -8, 0, 0, 8, 0, 0,
                            0, -8, 0, 0, 8, 0,
                            0, 0, -8, 0, 0, 8,
                        ], 3))
                        .setAttribute("color", new THREE.Float32BufferAttribute([
                            1, 0, 0, 1, 0, 0,
                            0, 1, 0, 0, 1, 0,
                            0, 0.45, 1, 0, 0.45, 1,
                        ], 3)),
                    new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }),
                );
                previewAxes.renderOrder = 16;
                previewRoot.add(previewAxes);
                previewScene.add(previewRoot);
                const resize = () => {
                    const size = canvas.getBoundingClientRect();
                    canvas.width = Math.max(1, Math.round(size.width * 2));
                    canvas.height = Math.max(1, Math.round(size.height * 2));
                    this.updateSharedRendererSize();
                    const aspect = size.width / size.height;
                    previewCamera.left = -50 * aspect;
                    previewCamera.right = 50 * aspect;
                    previewCamera.top = 50;
                    previewCamera.bottom = -50;
                    previewCamera.updateProjectionMatrix();
                    this.renderPreviewScene();
                };
                previewResizeObserver = new ResizeObserver(resize);
                previewResizeObserver.observe(canvas);
                resize();
            },

            renderPreviewScene() {
                if (!voxelRenderer || previewRenderFrame || voxelContextLost) return;
                previewRenderFrame = requestAnimationFrame(() => {
                    previewRenderFrame = null;
                    this.updatePreviewFaceVisibility();
                    this.renderSharedScene(previewScene, previewCamera, this.$refs.previewCanvas, previewDisplayContext);
                });
            },

            updatePreviewFaceVisibility() {
                if (!previewRoot || !previewFaceNormals) return;
                previewInverseQuaternion.copy(previewRoot.quaternion).invert();
                previewViewDirection.set(0, 0, 1).applyQuaternion(previewInverseQuaternion);
                for (const [key, mesh] of previewFaceMeshes) {
                    const orientation = key.slice(0, key.indexOf(":"));
                    mesh.visible = mesh.userData.sourceVisible && previewFaceNormals[orientation].dot(previewViewDirection) > 0.0001;
                }
            },

            setPreviewInteraction(active) {
                if (previewInteracting === active) return;
                previewInteracting = active;
                if (active) {
                    cancelAnimationFrame(voxelRenderFrame);
                    voxelRenderFrame = null;
                    return;
                }
                this.renderPreviewScene();
                this.renderVoxelScene();
            },

            syncPreviewVoxels() {
                if (!previewModelRoot) return;
                const syncMesh = (source, key, targets) => {
                    let target = targets.get(key);
                    if (!target || target.instanceMatrix.count < source.count) {
                        if (target) {
                            target.removeFromParent();
                            target.dispose();
                        }
                        const capacity = Math.max(1, 2 ** Math.ceil(Math.log2(Math.max(1, source.count))));
                        target = new THREE.InstancedMesh(source.geometry, targets === previewFaceMeshes ? previewVoxelMaterial : source.material, capacity);
                        target.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
                        targets.set(key, target);
                        previewModelRoot.add(target);
                    }
                    target.userData.sourceVisible = source.count > 0;
                    target.visible = source.count > 0;
                    target.count = source.count;
                    if (!source.count) return;
                    target.instanceMatrix.array.set(source.instanceMatrix.array.subarray(0, source.count * 16));
                    target.instanceMatrix.needsUpdate = true;
                    if (source.instanceColor) {
                        if (!target.instanceColor) {
                            target.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(target.instanceMatrix.count * 3), 3);
                            target.instanceColor.setUsage(THREE.DynamicDrawUsage);
                        }
                        target.instanceColor.array.set(source.instanceColor.array.subarray(0, source.count * 3));
                        target.instanceColor.needsUpdate = true;
                    }
                    target.boundingSphere = source.boundingSphere?.clone() ?? null;
                };
                for (const [id, mesh] of voxelLayerMeshes) syncMesh(mesh, id, previewLayerMeshes);
                for (const [key, mesh] of voxelFaceMeshes) syncMesh(mesh, key, previewFaceMeshes);
                previewModelRoot.position.z = 0;
                this.renderPreviewScene();
            },

            startPreviewDrag(event) {
                if ((event.button !== 0 && event.button !== 1) || !previewRoot) return;
                event.preventDefault();
                this.blurActiveControl();
                cancelAnimationFrame(previewSnapFrame);
                previewSnapFrame = null;
                this.setPreviewInteraction(true);
                event.currentTarget.setPointerCapture(event.pointerId);
                previewDrag = {
                    canvas: event.currentTarget,
                    pointerId: event.pointerId,
                    mode: event.button === 0 ? "pan" : "rotate",
                    clientX: event.clientX,
                    clientY: event.clientY,
                    positionX: previewRoot.position.x,
                    positionY: previewRoot.position.y,
                    rotationX: previewRoot.rotation.x,
                    rotationY: previewRoot.rotation.y,
                    panScale: 100 / (event.currentTarget.getBoundingClientRect().height * previewCamera.zoom),
                };
            },

            continuePreviewDrag(event) {
                if (event.pointerId !== previewDrag?.pointerId) return;
                const deltaX = event.clientX - previewDrag.clientX;
                const deltaY = event.clientY - previewDrag.clientY;
                if (previewDrag.mode === "pan") {
                    previewRoot.position.x = previewDrag.positionX + deltaX * previewDrag.panScale;
                    previewRoot.position.y = previewDrag.positionY - deltaY * previewDrag.panScale;
                } else {
                    previewRoot.rotation.x = previewDrag.rotationX + deltaY * 0.01;
                    previewRoot.rotation.y = previewDrag.rotationY + deltaX * 0.01;
                }
                this.renderPreviewScene();
            },

            endPreviewDrag(event) {
                if (event.pointerId !== previewDrag?.pointerId) return;
                const mode = previewDrag.mode;
                if (previewDrag.canvas.hasPointerCapture(event.pointerId)) previewDrag.canvas.releasePointerCapture(event.pointerId);
                previewDrag = null;
                if (mode === "rotate") this.previewPreset = null;
                this.setPreviewInteraction(false);
            },

            resetPreviewPosition() {
                if (!previewRoot) return;
                previewRoot.position.set(0, 0, 0);
                this.renderPreviewScene();
            },

            flashPreviewWall(side) {
                if (!previewWallHit) return;
                cancelAnimationFrame(previewWallHitFrame);
                previewWallHit.position.z = side === "front" ? CANVAS_SIZE / 2 : -CANVAS_SIZE / 2;
                previewWallHit.visible = true;
                const started = performance.now();
                const flash = (time) => {
                    const progress = Math.min(1, (time - started) / 320);
                    const pulse = Math.sin(progress * Math.PI);
                    previewWallHit.children[0].material.opacity = pulse * 0.18;
                    previewWallHit.children[1].material.opacity = pulse * 0.9;
                    previewWallHit.scale.setScalar(0.96 + pulse * 0.04);
                    if (progress < 1) previewWallHitFrame = requestAnimationFrame(flash);
                    else {
                        previewWallHitFrame = null;
                        previewWallHit.visible = false;
                        previewWallHit.scale.setScalar(1);
                    }
                    this.renderPreviewScene();
                };
                previewWallHitFrame = requestAnimationFrame(flash);
            },

            setPreviewView(view) {
                if (!previewRoot) return;
                const rotations = {
                    perspective: [Math.PI / 6, -Math.PI / 4],
                    front: [0, 0],
                    back: [0, Math.PI],
                    right: [0, -Math.PI / 2],
                    left: [0, Math.PI / 2],
                    top: [Math.PI / 2, 0],
                    bottom: [-Math.PI / 2, 0],
                };
                const preset = rotations[view] ? view : "perspective";
                const [x, y] = rotations[preset];
                this.previewPreset = preset;
                this.setPreviewInteraction(true);
                cancelAnimationFrame(previewSnapFrame);
                const startRotation = previewRoot.quaternion.clone();
                const targetRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, 0));
                const started = performance.now();
                const snap = (time) => {
                    const progress = Math.min(1, (time - started) / 260);
                    previewRoot.quaternion.slerpQuaternions(startRotation, targetRotation, 1 - (1 - progress) ** 3);
                    if (progress < 1) previewSnapFrame = requestAnimationFrame(snap);
                    else {
                        previewSnapFrame = null;
                        previewRoot.rotation.set(x, y, 0);
                        this.setPreviewInteraction(false);
                    }
                    this.renderPreviewScene();
                };
                previewSnapFrame = requestAnimationFrame(snap);
            },

            layerViewKey(id = this.activeLayerId, orientation = this.activeOrientation) {
                return viewKey(orientation, id);
            },

            canvasFor(id = this.activeLayerId, orientation = this.activeOrientation) {
                return canvases.get(this.layerViewKey(id, orientation));
            },

            markViewEdited(id = this.activeLayerId) {
                if (this.activeOrientation === "front") {
                    if (this.appliedPaletteId === "default") for (const orientation of ORIENTATIONS) deletePaletteSource(this.layerViewKey(id, orientation.id));
                    else paletteSourceEdits.add(this.layerViewKey(id, "front"));
                } else {
                    const key = this.layerViewKey(id);
                    editedViews.add(key);
                    if (this.appliedPaletteId === "default") deletePaletteSource(key);
                    else paletteSourceEdits.add(key);
                }
            },

            syncDerivedOrientations() {
                const ranges = layerDepthRanges(this.layers);
                for (const layer of this.layers) {
                    const frontPalette = quantizedPalettes.get(viewKey("front", layer.id));
                    const source = this.canvasFor(layer.id, "front").getContext("2d").getImageData(LAYER_PADDING, LAYER_PADDING, CANVAS_SIZE, CANVAS_SIZE);
                    const range = ranges.get(layer.id);
                    for (const orientation of ORIENTATIONS.slice(1)) {
                        const key = viewKey(orientation.id, layer.id);
                        if (editedViews.has(key)) continue;
                        const target = this.canvasFor(layer.id, orientation.id).getContext("2d");
                        const projection = target.createImageData(CANVAS_SIZE, CANVAS_SIZE, { colorSpace: "srgb" });
                        const copy = (sourceOffset, x, y) => {
                            if (x < 0 || x >= CANVAS_SIZE || y < 0 || y >= CANVAS_SIZE) return;
                            const targetOffset = (y * CANVAS_SIZE + x) * 4;
                            for (let channel = 0; channel < 4; channel++) projection.data[targetOffset + channel] = source.data[sourceOffset + channel];
                        };
                        if (orientation.id === "back") {
                            for (let y = 0; y < CANVAS_SIZE; y++) for (let x = 0; x < CANVAS_SIZE; x++) {
                                const offset = (y * CANVAS_SIZE + CANVAS_SIZE - 1 - x) * 4;
                                if (source.data[offset + 3]) copy(offset, x, y);
                            }
                        } else if (orientation.id === "right" || orientation.id === "left") {
                            for (let y = 0; y < CANVAS_SIZE; y++) {
                                const start = orientation.id === "right" ? CANVAS_SIZE - 1 : 0;
                                const step = orientation.id === "right" ? -1 : 1;
                                let offset = -1;
                                for (let x = start; x >= 0 && x < CANVAS_SIZE; x += step) {
                                    const candidate = (y * CANVAS_SIZE + x) * 4;
                                    if (source.data[candidate + 3]) { offset = candidate; break; }
                                }
                                for (let z = range.start; offset >= 0 && z < range.end; z++) {
                                    copy(offset, orientation.id === "right" ? 31 - z : 32 + z, y);
                                }
                            }
                        } else {
                            for (let x = 0; x < CANVAS_SIZE; x++) {
                                const start = orientation.id === "top" ? 0 : CANVAS_SIZE - 1;
                                const step = orientation.id === "top" ? 1 : -1;
                                let offset = -1;
                                for (let y = start; y >= 0 && y < CANVAS_SIZE; y += step) {
                                    const candidate = (y * CANVAS_SIZE + x) * 4;
                                    if (source.data[candidate + 3]) { offset = candidate; break; }
                                }
                                for (let z = range.start; offset >= 0 && z < range.end; z++) {
                                    copy(offset, x, orientation.id === "top" ? 32 + z : 31 - z);
                                }
                            }
                        }
                        target.clearRect(0, 0, LAYER_SIZE, LAYER_SIZE);
                        target.putImageData(projection, LAYER_PADDING, LAYER_PADDING);
                        if (frontPalette) {
                            const palette = [...frontPalette.palette];
                            quantizedPalettes.set(key, { palette, colors: palette.map(hexColor), allowed: new Set(palette), confirmed: !!frontPalette.confirmed, locked: false });
                        } else quantizedPalettes.delete(key);
                    }
                }
            },

            pruneVoxelColorOverrides(id, views, range) {
                const overrides = voxelColorOverrides.get(id);
                if (!overrides) return;
                for (const [key] of overrides) {
                    const { x, y, z } = voxelCoordinates(key);
                    if (!containsDepthZ(range, z) || !voxelOccupied(views, x, y, z)) overrides.delete(key);
                }
                if (!overrides.size) voxelColorOverrides.delete(id);
            },

            renderVoxels() {
                if (!voxelGeometry) return;
                const matrix = new THREE.Matrix4();
                const color = new THREE.Color();
                const visibleLayers = this.layers.filter((layer) => layer.visible);
                const visibleIds = new Set(visibleLayers.map((layer) => layer.id));
                const visibleFaceKeys = new Set();
                const bounds = modelDepthBounds(this.layers);
                const ranges = layerDepthRanges(this.layers);
                const countOpaque = (pixels) => {
                    let count = 0;
                    for (let offset = 3; offset < pixels.length; offset += 4) if (pixels[offset]) count++;
                    return count;
                };
                const ensureMesh = (meshes, key, geometry, required, material = voxelMaterial) => {
                    const capacity = Math.max(1, 2 ** Math.ceil(Math.log2(Math.max(1, required))));
                    let mesh = meshes.get(key);
                    if (!mesh || mesh.instanceMatrix.count < required) {
                        if (mesh) {
                            mesh.removeFromParent();
                            mesh.dispose();
                        }
                        mesh = new THREE.InstancedMesh(geometry, material, capacity);
                        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
                        meshes.set(key, mesh);
                        voxelRoot.add(mesh);
                    }
                    return mesh;
                };
                const editingSurface = this.activeOrientation === "front" ? bounds.front : this.activeOrientation === "back" ? -bounds.back : CANVAS_SIZE / 2;
                voxelGrid.position.z = editingSurface + visibleLayers.length * 0.001 + 0.01;
                for (const [index, layer] of visibleLayers.entries()) {
                    const pixels = this.canvasFor(layer.id, "front").getContext("2d").getImageData(LAYER_PADDING, LAYER_PADDING, CANVAS_SIZE, CANVAS_SIZE).data;
                    const range = ranges.get(layer.id);
                    const backPixels = this.canvasFor(layer.id, "back").getContext("2d").getImageData(LAYER_PADDING, LAYER_PADDING, CANVAS_SIZE, CANVAS_SIZE).data;
                    const rightPixels = this.canvasFor(layer.id, "right").getContext("2d").getImageData(LAYER_PADDING, LAYER_PADDING, CANVAS_SIZE, CANVAS_SIZE).data;
                    const leftPixels = this.canvasFor(layer.id, "left").getContext("2d").getImageData(LAYER_PADDING, LAYER_PADDING, CANVAS_SIZE, CANVAS_SIZE).data;
                    const topPixels = this.canvasFor(layer.id, "top").getContext("2d").getImageData(LAYER_PADDING, LAYER_PADDING, CANVAS_SIZE, CANVAS_SIZE).data;
                    const bottomPixels = this.canvasFor(layer.id, "bottom").getContext("2d").getImageData(LAYER_PADDING, LAYER_PADDING, CANVAS_SIZE, CANVAS_SIZE).data;
                    const views = { front: pixels, back: backPixels, right: rightPixels, left: leftPixels, top: topPixels, bottom: bottomPixels };
                    this.pruneVoxelColorOverrides(layer.id, views, range);
                    const overrides = voxelColorOverrides.get(layer.id);
                    const occupied = (x, y, z) => voxelOccupied(views, x, y, z);
                    const fallbackBodyColor = (x, y) => {
                        const pixelOffset = (y * CANVAS_SIZE + x) * 4;
                        const colorPixels = pixels[pixelOffset + 3] ? pixels : backPixels;
                        const colorOffset = pixels[pixelOffset + 3] ? pixelOffset : (y * CANVAS_SIZE + 63 - x) * 4;
                        return colorPixels[colorOffset + 3] ? colorPixels[colorOffset] << 16 | colorPixels[colorOffset + 1] << 8 | colorPixels[colorOffset + 2] : null;
                    };
                    const bodyColor = (x, y, z) => overrides?.get(voxelKey(x, y, z)) ? Number.parseInt(overrides.get(voxelKey(x, y, z)).slice(1), 16) : fallbackBodyColor(x, y);
                    let segmentCount = 0;
                    for (let y = 0; y < CANVAS_SIZE; y++) for (let x = 0; x < CANVAS_SIZE; x++) {
                        if (!pixels[(y * CANVAS_SIZE + x) * 4 + 3] && !backPixels[(y * CANVAS_SIZE + 63 - x) * 4 + 3]) continue;
                        let previousColor = null;
                        for (let z = range.start; z < range.end; z++) {
                            const next = !!occupied(x, y, z);
                            const nextColor = next ? bodyColor(x, y, z) : null;
                            if (next && nextColor !== previousColor) segmentCount++;
                            previousColor = nextColor;
                        }
                    }
                    const mesh = ensureMesh(voxelLayerMeshes, layer.id, voxelGeometry, segmentCount);
                    const offset = (visibleLayers.length - index) * 0.001;
                    const left = new Int16Array(CANVAS_SIZE * CANVAS_SIZE).fill(-1);
                    const right = new Int16Array(CANVAS_SIZE * CANVAS_SIZE).fill(-1);
                    const top = new Int16Array(CANVAS_SIZE * CANVAS_SIZE).fill(-1);
                    const bottom = new Int16Array(CANVAS_SIZE * CANVAS_SIZE).fill(-1);
                    let count = 0;
                    for (let y = 0; y < CANVAS_SIZE; y++) for (let x = 0; x < CANVAS_SIZE; x++) {
                        let runStart = null;
                        let runColor = null;
                        for (let z = range.start; z <= range.end; z++) {
                            const next = z < range.end && occupied(x, y, z);
                            const nextColor = next ? bodyColor(x, y, z) : null;
                            if (next && runStart !== null && nextColor !== runColor) {
                                matrix.makeScale(1, 1, z - runStart);
                                matrix.setPosition(x - 31.5, 31.5 - y, runStart + (z - runStart) / 2);
                                mesh.setMatrixAt(count, matrix);
                                color.setRGB((runColor >> 16 & 255) / 255, (runColor >> 8 & 255) / 255, (runColor & 255) / 255, THREE.SRGBColorSpace);
                                mesh.setColorAt(count++, color);
                                runStart = null;
                            }
                            if (next) {
                                const rowIndex = y * CANVAS_SIZE + z + 32;
                                const columnIndex = x * CANVAS_SIZE + z + 32;
                                if (left[rowIndex] < 0) left[rowIndex] = x;
                                right[rowIndex] = x;
                                if (top[columnIndex] < 0) top[columnIndex] = y;
                                bottom[columnIndex] = y;
                            }
                            if (next && runStart === null) {
                                runStart = z;
                                runColor = nextColor;
                            }
                            if ((!next || z === range.end) && runStart !== null) {
                                matrix.makeScale(1, 1, z - runStart);
                                matrix.setPosition(x - 31.5, 31.5 - y, runStart + (z - runStart) / 2);
                                mesh.setMatrixAt(count, matrix);
                                color.setRGB((runColor >> 16 & 255) / 255, (runColor >> 8 & 255) / 255, (runColor & 255) / 255, THREE.SRGBColorSpace);
                                mesh.setColorAt(count++, color);
                                runStart = null;
                            }
                        }
                    }
                    mesh.visible = true;
                    mesh.count = count;
                    mesh.instanceMatrix.needsUpdate = true;
                    if (mesh.instanceColor) {
                        mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
                        mesh.instanceColor.needsUpdate = true;
                    }
                    mesh.computeBoundingSphere();
                    for (const orientation of ORIENTATIONS) {
                        const key = viewKey(orientation.id, layer.id);
                        visibleFaceKeys.add(key);
                        const facePixels = this.canvasFor(layer.id, orientation.id).getContext("2d").getImageData(LAYER_PADDING, LAYER_PADDING, CANVAS_SIZE, CANVAS_SIZE).data;
                        const face = ensureMesh(voxelFaceMeshes, key, voxelFaceGeometries.get(orientation.id), countOpaque(facePixels));
                        let faceCount = 0;
                        for (let y = 0; y < CANVAS_SIZE; y++) for (let x = 0; x < CANVAS_SIZE; x++) {
                            const pixelOffset = (y * CANVAS_SIZE + x) * 4;
                            if (!facePixels[pixelOffset + 3]) continue;
                            let position = null;
                            let faceVoxel = null;
                            if (orientation.id === "front") {
                                const z = range.end - 1;
                                if (occupied(x, y, z)) {
                                    position = [x - 31.5, 31.5 - y, z + 1 + offset + 0.002];
                                    faceVoxel = [x, y, z];
                                }
                            }
                            if (orientation.id === "back" && occupied(CANVAS_SIZE - 1 - x, y, range.start)) {
                                position = [31.5 - x, 31.5 - y, range.start - offset - 0.002];
                                faceVoxel = [CANVAS_SIZE - 1 - x, y, range.start];
                            }
                            if (orientation.id === "right") {
                                const z = 31 - x;
                                const edge = containsDepthZ(range, z) ? right[y * CANVAS_SIZE + z + 32] : -1;
                                if (edge >= 0) {
                                    position = [edge - 31.5 + 0.502 + offset, 31.5 - y, z + 0.5];
                                    faceVoxel = [edge, y, z];
                                }
                            }
                            if (orientation.id === "left") {
                                const z = x - 32;
                                const edge = containsDepthZ(range, z) ? left[y * CANVAS_SIZE + z + 32] : -1;
                                if (edge >= 0) {
                                    position = [edge - 31.5 - 0.502 - offset, 31.5 - y, z + 0.5];
                                    faceVoxel = [edge, y, z];
                                }
                            }
                            if (orientation.id === "top") {
                                const z = y - 32;
                                const topIndex = x * CANVAS_SIZE + z + 32;
                                const edge = containsDepthZ(range, z) ? top[topIndex] : -1;
                                if (edge >= 0) {
                                    position = [x - 31.5, 31.5 - edge + 0.502 + offset, z + 0.5];
                                    faceVoxel = [x, edge, z];
                                }
                            }
                            if (orientation.id === "bottom") {
                                const z = 31 - y;
                                const edge = containsDepthZ(range, z) ? bottom[x * CANVAS_SIZE + z + 32] : -1;
                                if (edge >= 0) {
                                    position = [x - 31.5, 31.5 - edge - 0.502 - offset, z + 0.5];
                                    faceVoxel = [x, edge, z];
                                }
                            }
                            if (!position) continue;
                            matrix.makeTranslation(...position);
                            face.setMatrixAt(faceCount, matrix);
                            const override = overrides?.get(voxelKey(...faceVoxel));
                            const faceColor = override ? Number.parseInt(override.slice(1), 16) : facePixels[pixelOffset] << 16 | facePixels[pixelOffset + 1] << 8 | facePixels[pixelOffset + 2];
                            color.setRGB((faceColor >> 16 & 255) / 255, (faceColor >> 8 & 255) / 255, (faceColor & 255) / 255, THREE.SRGBColorSpace);
                            face.setColorAt(faceCount++, color);
                        }
                        face.count = faceCount;
                        face.visible = faceCount > 0 && orientation.id === this.activeOrientation;
                        face.instanceMatrix.needsUpdate = true;
                        if (face.instanceColor) {
                            face.instanceColor.setUsage(THREE.DynamicDrawUsage);
                            face.instanceColor.needsUpdate = true;
                        }
                        face.computeBoundingSphere();
                    }
                }
                const pruneMeshes = (sources, targets, valid) => {
                    for (const [key, mesh] of sources) {
                        if (valid.has(key)) continue;
                        mesh.removeFromParent();
                        mesh.dispose();
                        sources.delete(key);
                        const target = targets.get(key);
                        if (!target) continue;
                        target.removeFromParent();
                        target.dispose();
                        targets.delete(key);
                    }
                };
                pruneMeshes(voxelLayerMeshes, previewLayerMeshes, visibleIds);
                pruneMeshes(voxelFaceMeshes, previewFaceMeshes, visibleFaceKeys);
                this.syncPreviewVoxels();
                if (voxelSelection) voxelSelection.position.z = this.voxelLayerDepth() + 0.52;
                this.renderVoxelScene();
            },

            voxelLayerDepth(id = this.activeLayerId) {
                const visibleLayers = this.layers.filter((layer) => layer.visible);
                const index = visibleLayers.findIndex((layer) => layer.id === id);
                if (index < 0) return 0.5;
                const range = layerDepthRanges(this.layers).get(id);
                const surface = this.activeOrientation === "front"
                    ? range.end - 0.5
                    : this.activeOrientation === "back" ? -range.start - 0.5
                        : CANVAS_SIZE / 2 - 0.5;
                return surface + (visibleLayers.length - index) * 0.001;
            },

            renderVoxelSelection() {
                if (!voxelSelection) return;
                const positions = [];
                const distances = [];
                const selected = (x, y) => x >= 0 && x < CANVAS_SIZE && y >= 0 && y < CANVAS_SIZE && selectionMask?.[maskIndex(x, y)];
                const addEdge = (x1, y1, x2, y2) => {
                    positions.push(x1 - 32, 32 - y1, 0, x2 - 32, 32 - y2, 0);
                    distances.push(0, Math.hypot(x2 - x1, y2 - y1));
                };
                for (let y = 0; y < CANVAS_SIZE; y++) for (let x = 0; x < CANVAS_SIZE; x++) {
                    if (!selected(x, y)) continue;
                    if (!selected(x, y - 1)) addEdge(x, y, x + 1, y);
                    if (!selected(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
                    if (!selected(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
                    if (!selected(x - 1, y)) addEdge(x, y + 1, x, y);
                }
                const geometry = new THREE.BufferGeometry();
                geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
                geometry.setAttribute("lineDistance", new THREE.Float32BufferAttribute(distances, 1));
                geometry.computeBoundingSphere();
                const previousGeometry = voxelSelection.geometry;
                voxelSelection.geometry = geometry;
                previousGeometry.dispose();
                voxelSelection.position.z = this.voxelLayerDepth() + 0.52;
                voxelSelection.visible = positions.length > 0;
                if (voxelSelection.visible && !voxelSelectionFrame) this.animateVoxelSelection();
                this.renderVoxelScene();
            },

            animateVoxelSelection() {
                const animate = (time) => {
                    if (!voxelSelection?.visible) {
                        voxelSelectionFrame = null;
                        return;
                    }
                    voxelSelection.material.uniforms.phase.value = time * 0.002;
                    this.renderVoxelScene();
                    voxelSelectionFrame = requestAnimationFrame(animate);
                };
                voxelSelectionFrame = requestAnimationFrame(animate);
            },

            refreshUI() {
                this.$nextTick(() => {
                    this.renderThumbnails();
                    lucide.createIcons();
                });
            },

            queueRender() {
                if (modelRenderFrame) return;
                modelRenderFrame = requestAnimationFrame(() => {
                    modelRenderFrame = null;
                    this.render();
                });
            },

            render() {
                if (modelRenderFrame) {
                    cancelAnimationFrame(modelRenderFrame);
                    modelRenderFrame = null;
                }
                if (selectionMask && selectionViewKey !== this.layerViewKey()) this.clearSelection();
                for (const layer of this.layers) for (const orientation of ORIENTATIONS) this.normalizeLayerColors(layer.id, orientation.id);
                this.syncDerivedOrientations();
                this.context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
                for (const layer of [...this.layers].reverse()) {
                    if (layer.visible) this.context.drawImage(
                        this.canvasFor(layer.id),
                        LAYER_PADDING,
                        LAYER_PADDING,
                        CANVAS_SIZE,
                        CANVAS_SIZE,
                        0,
                        0,
                        CANVAS_SIZE,
                        CANVAS_SIZE,
                    );
                }
                this.renderThumbnails();
                const colorCount = this.updatePalette();
                if (!this.quantizationPending && !quantizationSource) this.syncQuantizationLimit(colorCount);
                this.renderVoxels();
            },

            normalizeLayerColors(id, orientation = this.activeOrientation) {
                const key = this.layerViewKey(id, orientation);
                const frontKey = this.layerViewKey(id, "front");
                const frontPalette = quantizedPalettes.get(frontKey);
                const cached = frontPalette?.confirmed ? frontPalette : quantizedPalettes.get(key);
                if (!cached?.confirmed || quantizationSource?.layers?.some((layer) => layer.key === key) || quantizationSource?.key === key) return;
                const context = this.canvasFor(id, orientation).getContext("2d", CANVAS_CONTEXT_OPTIONS);
                const image = context.getImageData(LAYER_PADDING, LAYER_PADDING, CANVAS_SIZE, CANVAS_SIZE);
                let changed = false;
                for (let offset = 0; offset < image.data.length; offset += 4) {
                    if (!image.data[offset + 3]) continue;
                    const color = this.palettePixelColor(image.data, offset, cached);
                    const current = `#${image.data[offset].toString(16).padStart(2, "0")}${image.data[offset + 1].toString(16).padStart(2, "0")}${image.data[offset + 2].toString(16).padStart(2, "0")}`;
                    if (color === current) continue;
                    [image.data[offset], image.data[offset + 1], image.data[offset + 2]] = hexColor(color);
                    changed = true;
                }
                if (changed) context.putImageData(image, LAYER_PADDING, LAYER_PADDING);
            },

            perspectiveMask(id = this.activeLayerId, orientation = this.activeOrientation) {
                const mask = new Uint8Array(CANVAS_SIZE * CANVAS_SIZE);
                const canvas = this.canvasFor(id, orientation);
                if (!canvas) return mask;
                const pixels = canvas.getContext("2d").getImageData(LAYER_PADDING, LAYER_PADDING, CANVAS_SIZE, CANVAS_SIZE).data;
                for (let index = 0; index < mask.length; index++) mask[index] = pixels[index * 4 + 3] > 0;
                return mask;
            },

            canonicalPixelColor(pixels, offset, id = this.activeLayerId, orientation = this.activeOrientation) {
                const exact = `#${pixels[offset].toString(16).padStart(2, "0")}${pixels[offset + 1].toString(16).padStart(2, "0")}${pixels[offset + 2].toString(16).padStart(2, "0")}`;
                const activeKey = this.layerViewKey(id, orientation);
                const activePalette = quantizedPalettes.get(activeKey);
                const frontPalette = quantizedPalettes.get(this.layerViewKey(id, "front"));
                const canonical = orientation !== "front" && !editedViews.has(activeKey)
                    ? frontPalette
                    : frontPalette?.confirmed ? frontPalette : activePalette;
                return canonical?.colors.length && !canonical.allowed.has(exact)
                    ? this.palettePixelColor(pixels, offset, canonical)
                    : exact;
            },

            updatePalette(maxColors = 64) {
                if (!this.layers.length) {
                    if (this.palette.length) this.palette = [];
                    return 0;
                }
                const colors = new Map();
                for (const orientation of ORIENTATIONS) for (const layer of this.layers) {
                    const pixels = this.canvasFor(layer.id, orientation.id).getContext("2d").getImageData(LAYER_PADDING, LAYER_PADDING, CANVAS_SIZE, CANVAS_SIZE).data;
                    for (let offset = 0; offset < pixels.length; offset += 4) {
                        if (!pixels[offset + 3]) continue;
                        const color = this.canonicalPixelColor(pixels, offset, layer.id, orientation.id);
                        colors.set(color, (colors.get(color) ?? 0) + 1);
                    }
                }
                const ranked = [...colors]
                    .sort((a, b) => b[1] - a[1])
                    .map(([color]) => color);
                const previous = this.palette;
                const palette = [...previous.filter((color) => colors.has(color)), ...ranked.filter((color) => !previous.includes(color))].slice(0, maxColors);
                if (palette.join() !== this.palette.join()) this.palette = palette;
                return colors.size;
            },

            palettePixelColor(pixels, offset, cached) {
                const color = `#${pixels[offset].toString(16).padStart(2, "0")}${pixels[offset + 1].toString(16).padStart(2, "0")}${pixels[offset + 2].toString(16).padStart(2, "0")}`;
                if (!cached?.colors.length || cached.allowed.has(color)) return color;
                let nearest = 0;
                let distance = Infinity;
                for (let index = 0; index < cached.colors.length; index++) {
                    const candidate = cached.colors[index];
                    const difference = (pixels[offset] - candidate[0]) ** 2 + (pixels[offset + 1] - candidate[1]) ** 2 + (pixels[offset + 2] - candidate[2]) ** 2;
                    if (difference < distance) [nearest, distance] = [index, difference];
                }
                return cached.palette[nearest];
            },

            matchesPalettePixel(pixels, offset, target, tolerance, cached) {
                if (target[3] === 0) return pixels[offset + 3] <= tolerance;
                if (!pixels[offset + 3]) return false;
                const color = hexColor(this.palettePixelColor(pixels, offset, cached));
                const red = color[0] - target[0];
                const green = color[1] - target[1];
                const blue = color[2] - target[2];
                return Math.sqrt((red * red + green * green + blue * blue) / 3) <= tolerance;
            },

            highlightPaletteColor(color) {
                const canvas = this.$refs.paletteHighlight;
                const context = canvas.getContext("2d");
                const highlight = context.createImageData(CANVAS_SIZE, CANVAS_SIZE);
                const layers = [];
                for (const layer of this.layers.filter((candidate) => candidate.visible)) {
                    const masks = {};
                    for (const orientation of ORIENTATIONS) {
                        const pixels = this.canvasFor(layer.id, orientation.id).getContext("2d").getImageData(LAYER_PADDING, LAYER_PADDING, CANVAS_SIZE, CANVAS_SIZE).data;
                        const mask = new Uint8ClampedArray(highlight.data.length);
                        for (let offset = 0; offset < pixels.length; offset += 4) {
                            if (pixels[offset + 3] && this.canonicalPixelColor(pixels, offset, layer.id, orientation.id) === color) mask[offset + 3] = 255;
                        }
                        masks[orientation.id] = mask;
                    }
                    const mask = masks[this.activeOrientation];
                    for (let offset = 0; offset < mask.length; offset += 4) {
                        if (!mask[offset + 3]) continue;
                        highlight.data[offset] = 255;
                        highlight.data[offset + 2] = 255;
                        highlight.data[offset + 3] = 255;
                    }
                    layers.push({ id: layer.id, mask, masks });
                }
                if (this.pulseVoxelHighlight(layers, color)) return;
                clearTimeout(paletteHighlightTimer);
                canvas.classList.remove("pulse");
                context.putImageData(highlight, 0, 0);
                void canvas.offsetWidth;
                canvas.classList.add("pulse");
                paletteHighlightTimer = setTimeout(() => canvas.classList.remove("pulse"), 1000);
            },

            togglePaletteColorSelection(color, additive = false) {
                const source = this.canvasFor();
                if (!source) return;
                const pixels = source.getContext("2d").getImageData(LAYER_PADDING, LAYER_PADDING, CANVAS_SIZE, CANVAS_SIZE).data;
                const visible = this.perspectiveMask();
                const matches = [];
                for (let index = 0; index < CANVAS_SIZE * CANVAS_SIZE; index++) {
                    const offset = index * 4;
                    if (!visible[index] || !pixels[offset + 3] || this.canonicalPixelColor(pixels, offset) !== color) continue;
                    matches.push(maskIndex(index % CANVAS_SIZE, Math.floor(index / CANVAS_SIZE)));
                }
                if (!matches.length) return;
                const target = new Uint8Array(LAYER_SIZE * LAYER_SIZE);
                for (const index of matches) target[index] = 1;
                const exact = selectionMask && matches.every((index) => selectionMask[index]) && selectionMask.every((selected, index) => !selected || target[index]);
                if (!additive) return this.setSelectionMask(exact ? new Uint8Array(LAYER_SIZE * LAYER_SIZE) : target);
                const remove = matches.every((index) => selectionMask?.[index]);
                this.mergeSelectionMask(target, remove);
            },

            pulseVoxelHighlight(layers, color) {
                if (!voxelHighlightMesh) return false;
                const required = layers.reduce((count, layer) => count + layer.mask.reduce((total, alpha, index) => total + (index % 4 === 3 && alpha ? 1 : 0), 0), 0);
                const previewPositions = [];
                const previewOccupiedKeys = new Set();
                for (const layer of layers) {
                    const range = layerDepthRanges(this.layers).get(layer.id);
                    const views = Object.fromEntries(ORIENTATIONS.map((orientation) => [
                        orientation.id,
                        this.canvasFor(layer.id, orientation.id).getContext("2d").getImageData(LAYER_PADDING, LAYER_PADDING, CANVAS_SIZE, CANVAS_SIZE).data,
                    ]));
                    const occupied = (x, y, z) => voxelOccupied(views, x, y, z);
                    const left = new Int16Array(CANVAS_SIZE * CANVAS_SIZE).fill(-1);
                    const right = new Int16Array(CANVAS_SIZE * CANVAS_SIZE).fill(-1);
                    const top = new Int16Array(CANVAS_SIZE * CANVAS_SIZE).fill(-1);
                    const bottom = new Int16Array(CANVAS_SIZE * CANVAS_SIZE).fill(-1);
                    for (let y = 0; y < CANVAS_SIZE; y++) for (let x = 0; x < CANVAS_SIZE; x++) for (let z = range.start; z < range.end; z++) {
                        if (!occupied(x, y, z)) continue;
                        const rowIndex = y * CANVAS_SIZE + z + 32;
                        const columnIndex = x * CANVAS_SIZE + z + 32;
                        if (left[rowIndex] < 0) left[rowIndex] = x;
                        right[rowIndex] = x;
                        if (top[columnIndex] < 0) top[columnIndex] = y;
                        bottom[columnIndex] = y;
                    }
                    const matches = (orientation, x, y) => !!layer.masks[orientation][(y * CANVAS_SIZE + x) * 4 + 3];
                    const overrides = voxelColorOverrides.get(layer.id);
                    for (let y = 0; y < CANVAS_SIZE; y++) for (let x = 0; x < CANVAS_SIZE; x++) for (let z = range.start; z < range.end; z++) {
                        if (!occupied(x, y, z)) continue;
                        const key = voxelKey(x, y, z);
                        if (previewOccupiedKeys.has(key)) continue;
                        previewOccupiedKeys.add(key);
                        const rowIndex = y * CANVAS_SIZE + z + 32;
                        const columnIndex = x * CANVAS_SIZE + z + 32;
                        const override = overrides?.get(key);
                        const highlighted = override
                            ? override.toLowerCase() === color.toLowerCase()
                            : z === range.end - 1 && matches("front", x, y)
                                || z === range.start && matches("back", 63 - x, y)
                                || right[rowIndex] === x && matches("right", 31 - z, y)
                                || left[rowIndex] === x && matches("left", 32 + z, y)
                                || top[columnIndex] === y && matches("top", x, 32 + z)
                                || bottom[columnIndex] === y && matches("bottom", x, 31 - z);
                        if (!highlighted) continue;
                        previewPositions.push([x - 31.5, 31.5 - y, z + 0.5]);
                    }
                }
                const ensureCapacity = (mesh, parent, capacity) => {
                    if (!mesh || mesh.instanceMatrix.count >= capacity) return mesh;
                    const replacement = new THREE.InstancedMesh(mesh.geometry, mesh.material, 2 ** Math.ceil(Math.log2(capacity)));
                    replacement.renderOrder = mesh.renderOrder;
                    mesh.removeFromParent();
                    mesh.dispose();
                    parent.add(replacement);
                    return replacement;
                };
                voxelHighlightMesh = ensureCapacity(voxelHighlightMesh, voxelViewRoot, required);
                previewHighlightMesh = ensureCapacity(previewHighlightMesh, previewModelRoot, previewPositions.length);
                const matrix = new THREE.Matrix4();
                let count = 0;
                for (const layer of layers) {
                    const depth = this.voxelLayerDepth(layer.id) + 0.03;
                    for (let index = 0; index < CANVAS_SIZE * CANVAS_SIZE; index++) {
                        if (!layer.mask[index * 4 + 3]) continue;
                        const viewX = index % CANVAS_SIZE;
                        const viewY = Math.floor(index / CANVAS_SIZE);
                        matrix.makeTranslation(viewX - 31.5, 31.5 - viewY, depth);
                        voxelHighlightMesh.setMatrixAt(count++, matrix);
                    }
                }
                for (let index = 0; previewHighlightMesh && index < previewPositions.length; index++) {
                    matrix.makeTranslation(...previewPositions[index]);
                    previewHighlightMesh.setMatrixAt(index, matrix);
                }
                voxelHighlightMesh.count = count;
                voxelHighlightMesh.instanceMatrix.needsUpdate = true;
                voxelHighlightMesh.computeBoundingSphere();
                if (previewHighlightMesh) {
                    previewHighlightMesh.count = previewPositions.length;
                    previewHighlightMesh.instanceMatrix.needsUpdate = true;
                    previewHighlightMesh.computeBoundingSphere();
                }
                cancelAnimationFrame(voxelHighlightFrame);
                const started = performance.now();
                const pulse = (time) => {
                    const progress = Math.min(1, (time - started) / 1000);
                    voxelHighlightMesh.material.opacity = Math.sin(progress * Math.PI) * 0.85;
                    this.renderVoxelScene();
                    this.renderPreviewScene();
                    if (progress < 1) voxelHighlightFrame = requestAnimationFrame(pulse);
                    else {
                        voxelHighlightFrame = null;
                        voxelHighlightMesh.material.opacity = 0;
                    }
                };
                voxelHighlightFrame = requestAnimationFrame(pulse);
                return true;
            },

            syncQuantizationLimit(colorCount = this.updatePalette()) {
                const limit = Math.max(1, Math.min(64, colorCount));
                this.quantizationMax = limit;
                this.quantization = limit;
            },

            allowPaletteColor(color = this.color) {
                const canonical = quantizedPalettes.get(this.layerViewKey(this.activeLayerId, "front"));
                const allow = (cached) => {
                    if (!cached || cached.allowed.has(color)) return;
                    cached.palette.push(color);
                    cached.colors.push(hexColor(color));
                    cached.allowed.add(color);
                };
                allow(canonical);
                const key = this.layerViewKey();
                let cached = quantizedPalettes.get(key);
                if (!cached) {
                    const palette = [...this.palette];
                    cached = { palette, colors: palette.map(hexColor), allowed: new Set(palette) };
                    quantizedPalettes.set(key, cached);
                }
                allow(cached);
            },

            activePaletteColors() {
                return this.palette;
            },

            uploadedPaletteColors() {
                return this.importedPalettes.find((entry) => entry.id === this.activePaletteId)?.colors ?? [];
            },

            syncPaletteSourceEdits() {
                const palette = this.importedPalettes.find((entry) => entry.id === this.appliedPaletteId)?.colors;
                if (!palette) return;
                const colors = palette.map(hexColor);
                for (const key of paletteSourceEdits) {
                    const source = paletteSources.get(key);
                    const canvas = canvases.get(key);
                    if (!source || !canvas) continue;
                    const current = canvas.getContext("2d", CANVAS_CONTEXT_OPTIONS).getImageData(0, 0, LAYER_SIZE, LAYER_SIZE).data;
                    for (let offset = 0; offset < current.length; offset += 4) {
                        let projected = [0, 0, 0, 0];
                        if (source.data[offset + 3]) projected = colors.reduce((best, candidate) => {
                            const distance = (source.data[offset] - candidate[0]) ** 2 + (source.data[offset + 1] - candidate[1]) ** 2 + (source.data[offset + 2] - candidate[2]) ** 2;
                            return distance < best.distance ? { color: candidate, distance } : best;
                        }, { color: colors[0], distance: Infinity }).color;
                        if (current[offset] === projected[0] && current[offset + 1] === projected[1] && current[offset + 2] === projected[2] && current[offset + 3] === projected[3]) continue;
                        for (let channel = 0; channel < 4; channel++) source.data[offset + channel] = current[offset + channel];
                    }
                }
                paletteSourceEdits.clear();
            },

            selectPalette(id) {
                this.activePaletteId = id;
            },

            forcePaletteUsage() {
                this.syncPaletteSourceEdits();
                const entry = this.importedPalettes.find((candidate) => candidate.id === this.activePaletteId);
                if (!entry) return this.restorePaletteSources();
                this.appliedPaletteId = "default";
                this.applyPalette(entry.colors);
            },

            async importPaletteFile(file) {
                if (!file) return;
                const lines = (await file.text()).split(/\r?\n/);
                if (lines[0]?.replace(/^\uFEFF/, "").trim() !== "GIMP Palette") return;
                const palette = [...new Set(lines.flatMap((line) => {
                    const match = line.match(/^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s|$)/);
                    if (!match) return [];
                    const channels = match.slice(1, 4).map((value) => Math.max(0, Math.min(255, Number(value))));
                    return [`#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`];
                }))].slice(0, 64);
                if (!palette.length) return;
                const name = lines.find((line) => /^\s*Name\s*:/i.test(line))?.replace(/^\s*Name\s*:\s*/i, "").trim()
                    || file.name.replace(/\.[^.]+$/, "") || `Palette ${nextPaletteId + 1}`;
                const entry = { id: `palette-${++nextPaletteId}`, name, colors: palette };
                this.importedPalettes.push(entry);
                this.selectPalette(entry.id);
            },

            applyPalette(palette) {
                this.confirmQuantization();
                const colors = palette.map(hexColor);
                for (const layer of this.layers) for (const orientation of ORIENTATIONS) {
                    if (layer.locked) continue;
                    const key = viewKey(orientation.id, layer.id);
                    if (orientation.id !== "front" && !editedViews.has(key)) continue;
                    const context = this.canvasFor(layer.id, orientation.id).getContext("2d", CANVAS_CONTEXT_OPTIONS);
                    const cached = quantizedPalettes.get(key);
                    if (!paletteSourcePalettes.has(key) && cached && !cached.locked) {
                        paletteSourcePalettes.set(key, { palette: [...cached.palette], confirmed: !!cached.confirmed || orientation.id === "front", locked: false });
                    }
                    let source = paletteSources.get(key);
                    if (!source) {
                        source = context.getImageData(0, 0, LAYER_SIZE, LAYER_SIZE);
                        paletteSources.set(key, source);
                    }
                    const sourcePalette = paletteSourcePalettes.get(key);
                    const canonical = sourcePalette?.confirmed ? {
                        palette: sourcePalette.palette,
                        colors: sourcePalette.palette.map(hexColor),
                        allowed: new Set(sourcePalette.palette),
                    } : null;
                    const image = context.createImageData(LAYER_SIZE, LAYER_SIZE);
                    image.data.set(source.data);
                    for (let offset = 0; offset < image.data.length; offset += 4) {
                        if (!image.data[offset + 3]) continue;
                        const sourceColor = canonical ? hexColor(this.palettePixelColor(image.data, offset, canonical)) : image.data.subarray(offset, offset + 3);
                        const nearest = colors.reduce((best, candidate, index) => {
                            const distance = (sourceColor[0] - candidate[0]) ** 2 + (sourceColor[1] - candidate[1]) ** 2 + (sourceColor[2] - candidate[2]) ** 2;
                            return distance < best.distance ? { index, distance } : best;
                        }, { index: 0, distance: Infinity }).index;
                        [image.data[offset], image.data[offset + 1], image.data[offset + 2]] = colors[nearest];
                    }
                    context.putImageData(image, 0, 0);
                    quantizedPalettes.set(key, { palette: [...palette], colors: palette.map(hexColor), allowed: new Set(palette), confirmed: true, locked: false });
                    paletteOrders.set(key, [...palette]);
                }
                this.history = [];
                this.future = [];
                this.render();
                this.refreshUI();
            },

            restorePaletteSources() {
                this.confirmQuantization();
                this.appliedPaletteId = "default";
                for (const layer of this.layers) for (const orientation of ORIENTATIONS) {
                    const source = paletteSources.get(viewKey(orientation.id, layer.id));
                    if (source) this.canvasFor(layer.id, orientation.id).getContext("2d", CANVAS_CONTEXT_OPTIONS).putImageData(source, 0, 0);
                }
                for (const [key, cached] of quantizedPalettes) if (cached.locked) quantizedPalettes.delete(key);
                for (const [key, cached] of paletteSourcePalettes) {
                    const palette = [...cached.palette];
                    quantizedPalettes.set(key, { palette, colors: palette.map(hexColor), allowed: new Set(palette), confirmed: cached.confirmed, locked: false });
                }
                this.history = [];
                this.future = [];
                this.render();
                this.refreshUI();
            },

            quantizationPixels(id) {
                const image = this.canvasFor(id).getContext("2d").getImageData(0, 0, LAYER_SIZE, LAYER_SIZE);
                for (let offset = 0; offset < image.data.length; offset += 4) {
                    if (!image.data[offset + 3]) continue;
                    const color = hexColor(this.canonicalPixelColor(image.data, offset, id));
                    [image.data[offset], image.data[offset + 1], image.data[offset + 2]] = color;
                }
                return image;
            },

            beginQuantization() {
                const key = this.layerViewKey();
                if (quantizationSource?.key === key) return;
                const canvas = this.canvasFor();
                if (!canvas) return;
                quantizationSource = {
                    key,
                    layers: this.layers.filter((layer) => !layer.locked).map((layer) => ({
                        id: layer.id,
                        key: this.layerViewKey(layer.id),
                        pixels: this.quantizationPixels(layer.id),
                    })),
                    recorded: false,
                };
            },

            quantizeActiveLayer(value) {
                this.quantization = Math.max(1, Math.min(64, Number(value) || 1));
                if (quantizationSource?.key !== this.layerViewKey()) this.beginQuantization();
                if (!quantizationSource?.layers.length) return;
                if (!quantizationSource.recorded) {
                    this.pushHistory(false);
                    quantizationSource.recorded = true;
                }
                const sliceSize = LAYER_SIZE * LAYER_SIZE * 4;
                const combined = new ImageData(LAYER_SIZE, LAYER_SIZE * quantizationSource.layers.length);
                for (const [index, layer] of quantizationSource.layers.entries()) combined.data.set(layer.pixels.data, index * sliceSize);
                const combinedResult = quantizeImage(combined, this.quantization);
                quantizationSource.palette = imagePalette(combinedResult, this.quantization);
                quantizationSource.results = quantizationSource.layers.map((layer, index) => ({
                    ...layer,
                    result: new ImageData(new Uint8ClampedArray(combinedResult.data.slice(index * sliceSize, (index + 1) * sliceSize)), LAYER_SIZE, LAYER_SIZE),
                }));
                for (const layer of quantizationSource.results) {
                    this.markViewEdited(layer.id);
                    this.canvasFor(layer.id).getContext("2d").putImageData(layer.result, 0, 0);
                }
                quantizationSource.result = quantizationSource.results.find((layer) => layer.id === this.activeLayerId)?.result ?? quantizationSource.results[0]?.result;
                this.quantizationPending = true;
                this.render();
            },

            confirmQuantization() {
                const confirmedLimit = this.quantizationPending ? this.quantization : 64;
                const result = quantizationSource?.result;
                const key = quantizationSource?.key;
                const results = quantizationSource?.results;
                const sharedPalette = quantizationSource?.palette;
                quantizationSource = null;
                this.quantizationPending = false;
                if (sharedPalette?.length) {
                    this.palette = [...sharedPalette];
                    this.quantizationMax = sharedPalette.length;
                    this.quantization = sharedPalette.length;
                } else this.syncQuantizationLimit(Math.min(confirmedLimit, this.updatePalette()));
                if (result && key) {
                    for (const layer of results ?? [{ key, result }]) {
                        const palette = sharedPalette?.length ? [...sharedPalette] : imagePalette(layer.result, confirmedLimit);
                        const layerId = layer.id ?? layer.key.slice(layer.key.indexOf(":") + 1);
                        for (const orientation of ORIENTATIONS) {
                            const orientationKey = viewKey(orientation.id, layerId);
                            quantizedPalettes.set(orientationKey, { palette: [...palette], colors: palette.map(hexColor), allowed: new Set(palette), confirmed: true });
                            paletteOrders.set(orientationKey, [...palette]);
                            this.normalizeLayerColors(layerId, orientation.id);
                        }
                    }
                    this.history = [];
                    this.future = [];
                    this.renderVoxels();
                }
                this.updatePalette();
            },

            renderThumbnails() {
                for (const thumbnail of this.$root.querySelectorAll("[data-layer-thumbnail]")) {
                    const source = this.canvasFor(thumbnail.dataset.layerThumbnail);
                    const context = thumbnail.getContext("2d");
                    context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
                    if (source) context.drawImage(
                        source,
                        LAYER_PADDING,
                        LAYER_PADDING,
                        CANVAS_SIZE,
                        CANVAS_SIZE,
                        0,
                        0,
                        CANVAS_SIZE,
                        CANVAS_SIZE,
                    );
                }
            },

            layerEntries() {
                const entries = [];
                const groups = new Map(this.groups.map((group) => [group.id, group]));
                const groupedIds = new Set(this.layers.map((layer) => layer.groupId).filter(Boolean));
                const shownGroups = new Set();
                const emptyGroups = new Map();
                for (const group of this.groups) if (!groupedIds.has(group.id)) {
                    const position = Math.max(0, Math.min(this.layers.length, group.position ?? 0));
                    if (!emptyGroups.has(position)) emptyGroups.set(position, []);
                    emptyGroups.get(position).push(group);
                }
                const appendEmptyGroups = (position) => {
                    for (const group of emptyGroups.get(position) ?? []) {
                        entries.push({ key: `group:${group.id}`, type: "group", group });
                        shownGroups.add(group.id);
                    }
                };
                for (const [index, layer] of this.layers.entries()) {
                    appendEmptyGroups(index);
                    const group = groups.get(layer.groupId);
                    if (!group) {
                        entries.push({ key: `layer:${layer.id}`, type: "layer", layer, grouped: false });
                        continue;
                    }
                    if (shownGroups.has(group.id)) continue;
                    shownGroups.add(group.id);
                    entries.push({ key: `group:${group.id}`, type: "group", group });
                    if (!group.collapsed) {
                        const members = this.layers.filter((candidate) => candidate.groupId === group.id);
                        for (const [index, member] of members.entries()) {
                            entries.push({ key: `layer:${member.id}`, type: "layer", layer: member, grouped: true, lastInGroup: index === members.length - 1 });
                        }
                    }
                }
                appendEmptyGroups(this.layers.length);
                return entries;
            },

            createGroup() {
                this.pushHistory();
                const group = { id: `group-${++nextGroupId}`, name: `Group ${nextGroupId}`, collapsed: false, position: 0 };
                this.groups.unshift(group);
                this.activeGroupId = group.id;
                this.activeLayerId = null;
                this.selectedLayerIds = [];
                this.layerSelectionAnchorId = null;
                this.render();
                this.refreshUI();
            },

            activateGroup(id) {
                this.confirmQuantization();
                this.activeGroupId = id;
                this.activeLayerId = null;
                this.selectedLayerIds = [];
                this.layerSelectionAnchorId = null;
                this.render();
            },

            toggleGroup(group) {
                group.collapsed = !group.collapsed;
                this.refreshUI();
            },

            groupLayerCount(id) {
                return this.layers.filter((layer) => layer.groupId === id).length;
            },

            positionEmptyGroup(id, position) {
                if (!id || this.layers.some((layer) => layer.groupId === id)) return;
                const group = this.groups.find((candidate) => candidate.id === id);
                if (group) group.position = Math.max(0, Math.min(this.layers.length, position));
            },

            emptyGroupAnchors(excludedId = null) {
                const occupied = new Set(this.layers.map((layer) => layer.groupId).filter(Boolean));
                return this.groups
                    .filter((group) => group.id !== excludedId && !occupied.has(group.id))
                    .map((group) => ({ group, position: Math.max(0, Math.min(this.layers.length, group.position ?? 0)) }));
            },

            rebaseEmptyGroupAnchors(anchors, removedIndex, insertionIndex, insertBeforeEqual) {
                for (const anchor of anchors) {
                    let position = anchor.position - (anchor.position > removedIndex ? 1 : 0);
                    if (position > insertionIndex || (insertBeforeEqual && position === insertionIndex)) position++;
                    anchor.group.position = Math.max(0, Math.min(this.layers.length, position));
                }
            },

            groupVisible(group) {
                return this.layers.some((layer) => layer.groupId === group.id && layer.visible);
            },

            groupPartiallyVisible(group) {
                const members = this.layers.filter((layer) => layer.groupId === group.id);
                return members.some((layer) => layer.visible) && members.some((layer) => !layer.visible);
            },

            groupLocked(group) {
                const members = this.layers.filter((layer) => layer.groupId === group.id);
                return members.length > 0 && members.every((layer) => layer.locked);
            },

            toggleGroupLock(group) {
                const members = this.layers.filter((layer) => layer.groupId === group.id);
                if (!members.length) return;
                this.pushHistory();
                const locked = !members.every((layer) => layer.locked);
                for (const layer of members) layer.locked = locked;
                if (locked && members.some((layer) => layer.id === this.activeLayerId)) this.clearSelection();
                this.render();
            },

            beginGroupNameEdit(group, input) {
                if (this.groupLocked(group)) return;
                this.editingGroupId = group.id;
                this.$nextTick(() => {
                    input.readOnly = false;
                    input.select();
                });
            },

            toggleGroupVisibility(group) {
                const members = this.layers.filter((layer) => layer.groupId === group.id);
                if (!members.length) return;
                this.pushHistory();
                const visible = !members.some((layer) => layer.visible);
                for (const layer of members) layer.visible = visible;
                this.render();
            },

            createLayer(name) {
                const id = `layer-${++nextLayerId}`;
                for (const orientation of ORIENTATIONS) canvases.set(viewKey(orientation.id, id), createLayerCanvas());
                const source = this.layers[0];
                const offset = source ? layerOffset(source) : 0;
                return { id, name: name || `Layer ${nextLayerId}`, visible: true, locked: false, depth: source ? clampLayerDepth(source, offset) : 1, offset, groupId: null };
            },

            addLayer(name, record = true) {
                if (record) this.pushHistory();
                const layer = this.createLayer(name);
                const group = this.groups.find((candidate) => candidate.id === this.activeGroupId);
                if (group) {
                    layer.groupId = group.id;
                    group.collapsed = false;
                }
                const groupIndex = group ? this.layers.findIndex((candidate) => candidate.groupId === group.id) : -1;
                if (groupIndex >= 0) this.layers.splice(groupIndex, 0, layer);
                else if (group) this.layers.splice(Math.max(0, Math.min(this.layers.length, group.position ?? 0)), 0, layer);
                else this.layers.unshift(layer);
                this.activeLayerId = layer.id;
                this.activeGroupId = null;
                this.selectedLayerIds = [layer.id];
                this.layerSelectionAnchorId = layer.id;
                this.render();
                this.refreshUI();
                return layer;
            },

            ensureActiveLayer() {
                return this.layers.find((layer) => layer.id === this.activeLayerId) ?? this.addLayer(undefined, false);
            },

            duplicateLayer() {
                const source = this.layers.find((layer) => layer.id === this.activeLayerId);
                if (!source) return;
                this.pushHistory();
                const copy = this.createLayer(`${source.name} copy`);
                copy.visible = source.visible;
                copy.locked = source.locked;
                copy.depth = layerDepth(source);
                copy.offset = source.offset;
                copy.groupId = source.groupId ?? null;
                for (const orientation of ORIENTATIONS) {
                    const sourceKey = viewKey(orientation.id, source.id);
                    const copyKey = viewKey(orientation.id, copy.id);
                    canvases.get(copyKey).getContext("2d").drawImage(canvases.get(sourceKey), 0, 0);
                    if (quantizedPalettes.has(sourceKey)) {
                        const sourcePalette = quantizedPalettes.get(sourceKey);
                        const palette = [...sourcePalette.palette];
                        quantizedPalettes.set(copyKey, { palette, colors: palette.map(hexColor), allowed: new Set(palette), confirmed: sourcePalette.confirmed, locked: sourcePalette.locked });
                    }
                    if (paletteOrders.has(sourceKey)) paletteOrders.set(copyKey, [...paletteOrders.get(sourceKey)]);
                    if (editedViews.has(sourceKey)) editedViews.add(copyKey);
                }
                const overrides = copyVoxelOverrides(source.id);
                if (overrides.size) voxelColorOverrides.set(copy.id, overrides);
                const index = this.layers.findIndex((layer) => layer.id === source.id);
                this.layers.splice(index, 0, copy);
                this.normalizeLayerOffsets();
                this.activeLayerId = copy.id;
                this.activeGroupId = null;
                this.selectedLayerIds = [copy.id];
                this.layerSelectionAnchorId = copy.id;
                this.render();
                this.refreshUI();
            },

            removeLayer() {
                if (!this.activeLayerId || this.layers.some((layer) => this.selectedLayerIds.includes(layer.id) && layer.locked)) return;
                this.pushHistory();
                const ids = new Set(this.selectedLayerIds.includes(this.activeLayerId) ? this.selectedLayerIds : [this.activeLayerId]);
                const removed = this.layers.map((layer, index) => ({ layer, index })).filter(({ layer }) => ids.has(layer.id));
                const index = Math.min(...removed.map((entry) => entry.index));
                for (const { layer } of removed) for (const orientation of ORIENTATIONS) {
                    const key = viewKey(orientation.id, layer.id);
                    canvases.delete(key);
                    quantizedPalettes.delete(key);
                    paletteOrders.delete(key);
                    deletePaletteSource(key);
                    editedViews.delete(key);
                }
                for (const { layer } of removed) voxelColorOverrides.delete(layer.id);
                this.layers = this.layers.filter((layer) => !ids.has(layer.id));
                for (const { layer, index: removedIndex } of removed) this.positionEmptyGroup(layer.groupId, removedIndex);
                this.normalizeLayerOffsets();
                this.activeLayerId = this.layers[Math.min(index, this.layers.length - 1)]?.id ?? null;
                this.activeGroupId = null;
                this.selectedLayerIds = this.activeLayerId ? [this.activeLayerId] : [];
                this.layerSelectionAnchorId = this.activeLayerId;
                if (!this.activeLayerId) this.clearSelection();
                this.render();
            },

            removeLayerOrGroup() {
                if (!this.activeGroupId) {
                    this.removeLayer();
                    return;
                }
                if (this.layers.some((layer) => layer.groupId === this.activeGroupId && layer.locked)) return;
                const index = this.groups.findIndex((group) => group.id === this.activeGroupId);
                if (index < 0) return;
                this.pushHistory();
                for (const layer of this.layers) if (layer.groupId === this.activeGroupId) layer.groupId = null;
                this.groups.splice(index, 1);
                this.activeGroupId = null;
                this.activeLayerId = this.layers[0]?.id ?? null;
                this.selectedLayerIds = this.activeLayerId ? [this.activeLayerId] : [];
                this.layerSelectionAnchorId = this.activeLayerId;
                this.render();
                this.refreshUI();
            },

            toggleLayer(layer) {
                this.pushHistory();
                layer.visible = !layer.visible;
                this.render();
            },

            setLayerDepth(layer, input) {
                if (layer.locked) return;
                if (input.value === "") return;
                const requested = Math.trunc(Number(input.value));
                const candidate = requested === 0 ? (layerDepth(layer) > 0 ? -1 : 1) : requested;
                const offset = layerOffset(layer);
                const depth = clampLayerDepth({ depth: candidate }, offset);
                input.value = depth;
                const limits = layerDepthLimits(offset);
                if (depth === limits.max) this.flashPreviewWall("back");
                else if (depth === limits.min) this.flashPreviewWall("front");
                if (layerDepth(layer) === depth) return;
                const previousRange = layerDepthRanges(this.layers).get(layer.id);
                this.recordLayerValueEdit(layer, "depth");
                layer.depth = depth;
                this.normalizeLayerOffsets();
                this.extendLayerDepthViews(layer.id, previousRange, layerDepthRanges(this.layers).get(layer.id));
                input.value = layer.depth;
                this.render();
            },

            extendLayerDepthViews(id, previousRange, nextRange) {
                const added = [];
                for (let z = nextRange.start; z < nextRange.end; z++) if (!containsDepthZ(previousRange, z)) added.push(z);
                if (!added.length) return;
                const front = this.canvasFor(id, "front").getContext("2d").getImageData(LAYER_PADDING, LAYER_PADDING, CANVAS_SIZE, CANVAS_SIZE);
                const views = Object.fromEntries(ORIENTATIONS.slice(2).map((orientation) => [orientation.id, this.canvasFor(id, orientation.id).getContext("2d").getImageData(LAYER_PADDING, LAYER_PADDING, CANVAS_SIZE, CANVAS_SIZE)]));
                const left = new Int32Array(CANVAS_SIZE).fill(-1);
                const right = new Int32Array(CANVAS_SIZE).fill(-1);
                const top = new Int32Array(CANVAS_SIZE).fill(-1);
                const bottom = new Int32Array(CANVAS_SIZE).fill(-1);
                for (let y = 0; y < CANVAS_SIZE; y++) for (let x = 0; x < CANVAS_SIZE; x++) {
                    const offset = (y * CANVAS_SIZE + x) * 4;
                    if (!front.data[offset + 3]) continue;
                    if (left[y] < 0) left[y] = offset;
                    right[y] = offset;
                    if (top[x] < 0) top[x] = offset;
                    bottom[x] = offset;
                }
                const copy = (sourceOffset, target, x, y) => {
                    if (sourceOffset < 0) return;
                    const targetOffset = (y * CANVAS_SIZE + x) * 4;
                    target.data.set(front.data.subarray(sourceOffset, sourceOffset + 4), targetOffset);
                };
                for (const z of added) {
                    for (let y = 0; y < CANVAS_SIZE; y++) {
                        copy(right[y], views.right, 31 - z, y);
                        copy(left[y], views.left, 32 + z, y);
                    }
                    for (let x = 0; x < CANVAS_SIZE; x++) {
                        copy(top[x], views.top, x, 32 + z);
                        copy(bottom[x], views.bottom, x, 31 - z);
                    }
                }
                for (const orientation of ORIENTATIONS.slice(2)) {
                    const key = viewKey(orientation.id, id);
                    this.canvasFor(id, orientation.id).getContext("2d").putImageData(views[orientation.id], LAYER_PADDING, LAYER_PADDING);
                    deletePaletteSource(key);
                }
            },

            normalizeLayerOffsets() {
                for (const layer of this.layers) {
                    layer.depth = layerDepth(layer);
                    layer.offset = clampLayerOffset(layer, layer.depth);
                    layer.depth = clampLayerDepth(layer, layer.offset);
                }
            },

            shiftEditedLayerViews(id, deltaZ) {
                if (!deltaZ) return;
                const shifts = {
                    right: [-deltaZ, 0],
                    left: [deltaZ, 0],
                    top: [0, deltaZ],
                    bottom: [0, -deltaZ],
                };
                for (const [orientation, [dx, dy]] of Object.entries(shifts)) {
                    const key = viewKey(orientation, id);
                    if (!editedViews.has(key)) continue;
                    const context = this.canvasFor(id, orientation).getContext("2d", CANVAS_CONTEXT_OPTIONS);
                    const image = context.getImageData(0, 0, LAYER_SIZE, LAYER_SIZE);
                    context.clearRect(0, 0, LAYER_SIZE, LAYER_SIZE);
                    context.putImageData(image, dx, dy);
                    const source = paletteSources.get(key);
                    if (source) {
                        const shifted = createLayerCanvas().getContext("2d", CANVAS_CONTEXT_OPTIONS);
                        shifted.putImageData(source, dx, dy);
                        paletteSources.set(key, shifted.getImageData(0, 0, LAYER_SIZE, LAYER_SIZE));
                    }
                    if (selectionMask && selectionViewKey === key) this.setSelectionMask(translateMask(selectionMask, dx, dy));
                }
            },

            shiftVoxelColorOverrides(id, deltaZ) {
                const overrides = voxelColorOverrides.get(id);
                if (!overrides || !deltaZ) return;
                const shifted = new Map();
                for (const [key, color] of overrides) {
                    const { x, y, z } = voxelCoordinates(key);
                    if (z + deltaZ >= -CANVAS_SIZE / 2 && z + deltaZ < CANVAS_SIZE / 2) shifted.set(voxelKey(x, y, z + deltaZ), color);
                }
                setVoxelOverrides(id, shifted);
            },

            setLayerOffset(layer, input) {
                if (layer.locked) return;
                if (input.value === "") return;
                const depth = layerDepth(layer);
                const offset = clampLayerOffset({ offset: input.value }, depth);
                input.value = offset;
                const limits = layerOffsetLimits(depth);
                if (offset === limits.max) this.flashPreviewWall("back");
                else if (offset === limits.min) this.flashPreviewWall("front");
                if (layerOffset(layer) === offset) return;
                this.syncPaletteSourceEdits();
                const previousRange = layerDepthRanges(this.layers).get(layer.id);
                this.recordLayerValueEdit(layer, "offset");
                layer.offset = offset;
                const nextRange = layerDepthRanges(this.layers).get(layer.id);
                this.shiftEditedLayerViews(layer.id, nextRange.start - previousRange.start);
                this.shiftVoxelColorOverrides(layer.id, nextRange.start - previousRange.start);
                this.render();
            },

            beginLayerValueEdit(layer, field) {
                if (layer.locked) return;
                this.activeLayerId = layer.id;
                this.activeGroupId = null;
                this.selectedLayerIds = [layer.id];
                this.layerSelectionAnchorId = layer.id;
                this.editingLayerId = layer.id;
                if (layerValueEdit?.id !== layer.id || layerValueEdit.field !== field) layerValueEdit = { id: layer.id, field, recorded: false };
            },

            recordLayerValueEdit(layer, field) {
                if (layerValueEdit?.id !== layer.id || layerValueEdit.field !== field) {
                    this.pushHistory();
                    return;
                }
                if (layerValueEdit.recorded) return;
                this.pushHistory();
                layerValueEdit.recorded = true;
            },

            endLayerValueEdit() {
                layerValueEdit = null;
                this.editingLayerId = null;
            },

            layerDepthMin(layer) {
                return layerDepthLimits(layerOffset(layer)).min;
            },

            layerDepthMax(layer) {
                return layerDepthLimits(layerOffset(layer)).max;
            },

            layerOffsetMin(layer) {
                return layerOffsetLimits(layerDepth(layer)).min;
            },

            layerOffsetMax(layer) {
                return layerOffsetLimits(layerDepth(layer)).max;
            },

            beginLayerDrag(id, event) {
                const draggedIds = this.isLayerSelected(id) ? this.selectedLayerIds : [id];
                if (this.editingLayerId === id || this.layers.some((layer) => draggedIds.includes(layer.id) && layer.locked)) {
                    event.preventDefault();
                    return;
                }
                if (!this.isLayerSelected(id)) {
                    this.selectedLayerIds = [id];
                    this.layerSelectionAnchorId = id;
                }
                this.activeLayerId = id;
                this.activeGroupId = null;
                const selected = new Set(this.selectedLayerIds);
                this.draggedLayerIds = this.layers.filter((layer) => selected.has(layer.id)).map((layer) => layer.id);
                this.draggedLayerId = id;
                this.draggedLayerOriginalGroupId = this.layers.find((layer) => layer.id === id)?.groupId ?? null;
                this.draggedLayerWasGrouped = this.layers.some((layer) => selected.has(layer.id) && layer.groupId);
                this.draggedGroupId = null;
                this.layerDragChanged = false;
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", id);
                event.dataTransfer.setDragImage(transparentDragImage, 0, 0);
            },

            beginGroupDrag(id, event) {
                if (this.editingGroupId === id || this.layers.some((layer) => layer.groupId === id && layer.locked)) {
                    event.preventDefault();
                    return;
                }
                this.draggedLayerId = null;
                this.draggedLayerIds = [];
                this.draggedLayerWasGrouped = false;
                this.draggedLayerOriginalGroupId = null;
                this.draggedGroupId = id;
                this.layerDragChanged = false;
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", id);
                event.dataTransfer.setDragImage(transparentDragImage, 0, 0);
            },

            setEntryGapDrop(type, targetId, event) {
                if (!this.draggedLayerId && !this.draggedGroupId) return;
                if (this.draggedGroupId === targetId) {
                    this.setLayerInterior(event);
                    return;
                }
                const bounds = event.currentTarget.getBoundingClientRect();
                const position = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
                if (type === "group") {
                    this.layerDropTarget = `group:${targetId}`;
                    this.layerDropPosition = position;
                    this.validateLayerDrop(event);
                    return;
                }
                const target = this.layers.find((layer) => layer.id === targetId);
                if (this.draggedLayerIds.includes(targetId)) {
                    this.setLayerInterior(event);
                    return;
                }
                if (this.draggedGroupId && target?.groupId === this.draggedGroupId) {
                    this.setLayerInterior(event);
                    return;
                }
                if (this.draggedGroupId && target?.groupId) {
                    const members = this.layers.filter((layer) => layer.groupId === target.groupId);
                    const groupBoundary = position === "before" ? target === members[0] : target === members.at(-1);
                    if (!groupBoundary) {
                        this.setLayerInterior(event);
                        return;
                    }
                    this.layerDropTarget = `group:${target.groupId}`;
                    this.layerDropPosition = position;
                    this.validateLayerDrop(event);
                    return;
                }
                const dragged = this.layers.find((layer) => layer.id === this.draggedLayerId);
                const members = target?.groupId ? this.layers.filter((layer) => layer.groupId === target.groupId) : [];
                const boundary = (position === "before" && target === members[0]) || (position === "after" && target === members.at(-1));
                const outdented = event.clientX < bounds.left + 34;
                const outside = !!(dragged && target?.groupId && boundary && (outdented || dragged.groupId !== target.groupId));
                this.layerDropTarget = outside ? `group:${target.groupId}` : `layer:${targetId}`;
                this.layerDropPosition = outside && dragged.groupId !== target.groupId ? "after" : position;
                this.validateLayerDrop(event);
            },

            setLayerInterior(event) {
                this.layerDropTarget = null;
                this.layerDropPosition = null;
                event.dataTransfer.dropEffect = "none";
            },

            setGroupDrop(targetId, event) {
                if ((!this.draggedLayerId && !this.draggedGroupId) || this.draggedGroupId === targetId) {
                    this.setLayerInterior(event);
                    return;
                }
                const bounds = event.currentTarget.getBoundingClientRect();
                const ratio = (event.clientY - bounds.top) / bounds.height;
                this.layerDropTarget = `group:${targetId}`;
                this.layerDropPosition = this.draggedLayerId && ratio >= 0.25 && ratio <= 0.75
                    ? "inside"
                    : ratio < 0.5 ? "before" : "after";
                this.validateLayerDrop(event);
            },

            setRootDrop(position, event) {
                if (!this.draggedLayerId || !this.draggedLayerWasGrouped) return;
                this.layerDropTarget = `root:${position}`;
                this.layerDropPosition = "outside";
                this.validateLayerDrop(event);
            },

            validateLayerDrop(event) {
                if (this.layerDropWouldChange()) {
                    event.dataTransfer.dropEffect = "move";
                    return;
                }
                this.setLayerInterior(event);
            },

            layerDropWouldChange() {
                const [targetType, targetId] = this.layerDropTarget?.split(":") ?? [];
                const position = this.layerDropPosition;
                if (!targetType || !position) return false;
                if (this.draggedLayerId) {
                    if (this.draggedLayerIds.length > 1) {
                        if (targetType === "layer" && this.draggedLayerIds.includes(targetId)) return false;
                        return targetType !== "root" || this.draggedLayerWasGrouped || targetId === "top" || targetId === "bottom";
                    }
                    const layer = this.layers.find((candidate) => candidate.id === this.draggedLayerId);
                    if (!layer) return false;
                    if (targetType === "root") {
                        const index = this.layers.indexOf(layer);
                        return !!layer.groupId || (targetId === "top" ? index !== 0 : index !== this.layers.length - 1);
                    }
                    if (targetType === "layer") {
                        const target = this.layers.find((candidate) => candidate.id === targetId);
                        if (!target || target === layer) return false;
                        const from = this.layers.indexOf(layer);
                        const targetIndex = this.layers.indexOf(target);
                        const adjacent = position === "after" ? from === targetIndex + 1 : from === targetIndex - 1;
                        return layer.groupId !== (target.groupId ?? null) || !adjacent;
                    }
                    if (targetType === "group") {
                        const group = this.groups.find((candidate) => candidate.id === targetId);
                        if (!group) return false;
                        const members = this.layers.filter((candidate) => candidate.groupId === targetId);
                        if (position === "inside") return layer.groupId !== targetId || layer !== members.at(-1) || group.collapsed;
                        const groupPosition = Math.max(0, Math.min(this.layers.length, group.position ?? 0));
                        const firstIndex = members.length ? this.layers.indexOf(members[0]) : groupPosition;
                        const lastIndex = members.length ? this.layers.indexOf(members.at(-1)) : groupPosition - 1;
                        const layerIndex = this.layers.indexOf(layer);
                        return !!layer.groupId || (position === "before" ? layerIndex !== firstIndex - 1 : layerIndex !== lastIndex + 1);
                    }
                    return false;
                }
                const groupId = this.draggedGroupId;
                if (!groupId || targetType === "root" || (targetType === "group" && groupId === targetId)) return false;
                const targetLayer = targetType === "layer" ? this.layers.find((layer) => layer.id === targetId) : null;
                if (targetType === "layer" && (!targetLayer || targetLayer.groupId === groupId)) return false;
                const members = this.layers.filter((layer) => layer.groupId === groupId);
                const firstMemberIndex = members.length ? this.layers.indexOf(members[0]) : -1;
                const lastMemberIndex = members.length ? this.layers.indexOf(members.at(-1)) : -1;
                const targetMembers = targetType === "group"
                    ? this.layers.filter((layer) => layer.groupId === targetId)
                    : targetLayer.groupId ? this.layers.filter((layer) => layer.groupId === targetLayer.groupId) : [targetLayer];
                const firstTargetIndex = targetMembers.length ? this.layers.indexOf(targetMembers[0]) : -1;
                const lastTargetIndex = targetMembers.length ? this.layers.indexOf(targetMembers.at(-1)) : -1;
                const targetGroup = targetType === "group" ? this.groups.find((group) => group.id === targetId) : null;
                const emptyPosition = firstTargetIndex >= 0
                    ? position === "before" ? firstTargetIndex : lastTargetIndex + 1
                    : Math.max(0, Math.min(this.layers.length, targetGroup?.position ?? 0));
                if (members.length && firstTargetIndex >= 0) {
                    return position === "before" ? lastMemberIndex + 1 !== firstTargetIndex : lastTargetIndex + 1 !== firstMemberIndex;
                }
                const group = this.groups.find((candidate) => candidate.id === groupId);
                if (members.length || group?.position !== emptyPosition) return true;
                if (targetType !== "group") return false;
                const from = this.groups.findIndex((candidate) => candidate.id === groupId);
                const to = this.groups.findIndex((candidate) => candidate.id === targetId);
                return position === "before" ? from !== to - 1 : from !== to + 1;
            },

            layerDropMarker() {
                if (!this.layerDropPosition || !["before", "after"].includes(this.layerDropPosition)) return null;
                let target = this.layerDropTarget;
                if (this.layerDropPosition === "after" && target?.startsWith("group:")) {
                    const groupId = target.slice(6);
                    const group = this.groups.find((candidate) => candidate.id === groupId);
                    const members = this.layers.filter((layer) => layer.groupId === groupId);
                    if (!group?.collapsed && members.length) target = `layer:${members.at(-1).id}`;
                }
                if (this.layerDropPosition === "after") {
                    const entries = this.layerEntries();
                    const index = entries.findIndex((entry) => entry.key === target);
                    if (index >= 0 && entries[index + 1]) return { key: entries[index + 1].key, position: "before" };
                }
                return { key: target, position: this.layerDropPosition };
            },

            isLayerDropMarker(entryKey, position) {
                const marker = this.layerDropMarker();
                return marker?.key === entryKey && marker.position === position;
            },

            isLayerDropMarkerGrouped(entryKey) {
                if (!this.draggedLayerId || !this.layerDropTarget?.startsWith("layer:")) return false;
                const target = this.layers.find((layer) => `layer:${layer.id}` === this.layerDropTarget);
                return !!target?.groupId && (this.isLayerDropMarker(entryKey, "before") || this.isLayerDropMarker(entryKey, "after"));
            },

            commitLayerDrop() {
                const [type, targetId] = this.layerDropTarget?.split(":") ?? [];
                if (type === "layer") this.dropOnLayer(targetId);
                else if (type === "group") this.dropOnGroup(targetId);
                else if (type === "root") this.moveDraggedLayerToRoot(targetId);
                else this.finishLayerDrag();
            },

            recordLayerDrag() {
                if (!this.layerDragChanged) {
                    this.pushHistory();
                    this.layerDragChanged = true;
                }
            },

            captureLayerPositions() {
                const positions = new Map();
                for (const entry of this.$root.querySelectorAll("[data-layer-entry]")) {
                    positions.set(entry.dataset.layerEntry, entry.getBoundingClientRect());
                    for (const animation of entry.getAnimations()) animation.cancel();
                }
                return positions;
            },

            animateLayerPositions(positions) {
                if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
                this.$nextTick(() => {
                    for (const entry of this.$root.querySelectorAll("[data-layer-entry]")) {
                        const previous = positions.get(entry.dataset.layerEntry);
                        if (!previous) continue;
                        const current = entry.getBoundingClientRect();
                        const x = previous.left - current.left;
                        const y = previous.top - current.top;
                        if (!x && !y) continue;
                        entry.animate([
                            { transform: `translate(${x}px, ${y}px)` },
                            { transform: "translate(0, 0)" },
                        ], { duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
                    }
                });
            },

            moveDraggedLayers(targetType, targetId, position, finish = true) {
                const ids = new Set(this.draggedLayerIds);
                const moving = this.layers.filter((layer) => ids.has(layer.id));
                const targetLayer = targetType === "layer" ? this.layers.find((layer) => layer.id === targetId) : null;
                const targetGroup = targetType === "group" ? this.groups.find((group) => group.id === targetId) : null;
                if (moving.length < 2 || (targetType === "layer" && (!targetLayer || ids.has(targetId))) || (targetType === "group" && !targetGroup)) {
                    if (finish) this.finishLayerDrag();
                    return;
                }
                this.recordLayerDrag();
                const positions = this.captureLayerPositions();
                const removed = moving.map((layer) => ({ layer, index: this.layers.indexOf(layer), groupId: layer.groupId }));
                const emptyAnchors = this.emptyGroupAnchors(targetType === "group" ? targetId : null);
                const adjustedPosition = (value) => value - removed.filter(({ index }) => index < value).length;
                this.layers = this.layers.filter((layer) => !ids.has(layer.id));
                let insertionIndex = 0;
                let groupId = null;
                if (targetType === "root") insertionIndex = targetId === "top" ? 0 : this.layers.length;
                else if (targetType === "layer") {
                    groupId = targetLayer.groupId ?? null;
                    insertionIndex = this.layers.indexOf(targetLayer) + (position?.startsWith("after") ? 1 : 0);
                } else {
                    const memberIndexes = this.layers.map((layer, index) => layer.groupId === targetId ? index : -1).filter((index) => index >= 0);
                    const emptyPosition = adjustedPosition(Math.max(0, Math.min(this.layers.length + moving.length, targetGroup.position ?? 0)));
                    if (position === "inside") {
                        groupId = targetId;
                        insertionIndex = memberIndexes.length ? memberIndexes.at(-1) + 1 : emptyPosition;
                        targetGroup.collapsed = false;
                    } else {
                        insertionIndex = memberIndexes.length
                            ? position === "before" ? memberIndexes[0] : memberIndexes.at(-1) + 1
                            : emptyPosition;
                        if (!memberIndexes.length) targetGroup.position = insertionIndex + (position === "before" ? moving.length : 0);
                    }
                }
                for (const layer of moving) layer.groupId = groupId;
                this.layers.splice(insertionIndex, 0, ...moving);
                for (const anchor of emptyAnchors) {
                    let anchorPosition = adjustedPosition(anchor.position);
                    if (anchorPosition > insertionIndex || (anchorPosition === insertionIndex && position !== "after" && targetId !== "bottom")) anchorPosition += moving.length;
                    anchor.group.position = Math.max(0, Math.min(this.layers.length, anchorPosition));
                }
                for (const { groupId: previousGroupId, index } of removed) if (previousGroupId !== groupId) this.positionEmptyGroup(previousGroupId, Math.min(index, this.layers.length));
                this.activeLayerId = this.draggedLayerId;
                this.activeGroupId = null;
                this.normalizeLayerOffsets();
                this.render();
                this.refreshUI();
                this.animateLayerPositions(positions);
                if (finish) this.finishLayerDrag();
            },

            dropOnLayer(targetId, finish = true) {
                if (this.draggedLayerIds.length > 1) {
                    this.moveDraggedLayers("layer", targetId, this.layerDropPosition, finish);
                    return;
                }
                const target = this.layers.find((layer) => layer.id === targetId);
                if (!target) {
                    if (finish) this.finishLayerDrag();
                    return;
                }
                if (this.draggedGroupId) {
                    this.moveDraggedGroup("layer", targetId, this.layerDropPosition);
                    if (finish) this.finishLayerDrag();
                    return;
                }
                const layer = this.layers.find((candidate) => candidate.id === this.draggedLayerId);
                if (!layer || layer === target) {
                    if (finish) this.finishLayerDrag();
                    return;
                }
                const outside = this.layerDropPosition?.endsWith("-group");
                const desiredGroupId = outside ? null : target.groupId ?? null;
                const from = this.layers.indexOf(layer);
                const targetIndex = this.layers.indexOf(target);
                const adjacent = this.layerDropPosition?.startsWith("after") ? from === targetIndex + 1 : from === targetIndex - 1;
                if (layer.groupId === desiredGroupId && adjacent) {
                    if (finish) this.finishLayerDrag();
                    return;
                }
                this.recordLayerDrag();
                const positions = this.captureLayerPositions();
                const previousGroupId = layer.groupId;
                const emptyGroupAnchors = this.emptyGroupAnchors();
                this.layers.splice(from, 1);
                const nextTargetIndex = this.layers.indexOf(target);
                const insertionIndex = nextTargetIndex + (this.layerDropPosition?.startsWith("after") ? 1 : 0);
                layer.groupId = desiredGroupId;
                this.layers.splice(insertionIndex, 0, layer);
                this.rebaseEmptyGroupAnchors(emptyGroupAnchors, from, insertionIndex, this.layerDropPosition?.startsWith("after"));
                this.positionEmptyGroup(previousGroupId, from + (insertionIndex < from ? 1 : 0));
                this.activeGroupId = null;
                this.normalizeLayerOffsets();
                this.render();
                this.refreshUI();
                this.animateLayerPositions(positions);
                if (finish) this.finishLayerDrag();
            },

            dropOnGroup(targetId, finish = true) {
                if (this.draggedLayerIds.length > 1) {
                    this.moveDraggedLayers("group", targetId, this.layerDropPosition, finish);
                    return;
                }
                if (this.draggedGroupId) {
                    this.moveDraggedGroup("group", targetId, this.layerDropPosition);
                    if (finish) this.finishLayerDrag();
                    return;
                }
                const layer = this.layers.find((candidate) => candidate.id === this.draggedLayerId);
                const group = this.groups.find((candidate) => candidate.id === targetId);
                if (!layer || !group) {
                    if (finish) this.finishLayerDrag();
                    return;
                }
                const currentMembers = this.layers.filter((candidate) => candidate.groupId === targetId);
                const layerIndex = this.layers.indexOf(layer);
                const groupPosition = Math.max(0, Math.min(this.layers.length, group.position ?? 0));
                const firstIndex = currentMembers.length ? this.layers.indexOf(currentMembers[0]) : groupPosition;
                const lastIndex = currentMembers.length ? this.layers.indexOf(currentMembers.at(-1)) : groupPosition - 1;
                const settled = this.layerDropPosition === "inside"
                    ? layer.groupId === targetId && layer === currentMembers.at(-1) && !group.collapsed
                    : !layer.groupId && (this.layerDropPosition === "before" ? layerIndex === firstIndex - 1 : layerIndex === lastIndex + 1);
                if (settled) {
                    if (finish) this.finishLayerDrag();
                    return;
                }
                this.recordLayerDrag();
                const positions = this.captureLayerPositions();
                const previousGroupId = layer.groupId;
                const previousIndex = this.layers.indexOf(layer);
                const emptyGroupAnchors = this.emptyGroupAnchors(targetId);
                this.layers.splice(this.layers.indexOf(layer), 1);
                const emptiedTarget = currentMembers.length === 1 && currentMembers[0] === layer;
                const emptyTargetPosition = emptiedTarget
                    ? Math.min(previousIndex, this.layers.length)
                    : Math.max(0, Math.min(this.layers.length, groupPosition - (!currentMembers.length && previousIndex < groupPosition ? 1 : 0)));
                const memberIndexes = this.layers
                    .map((candidate, index) => candidate.groupId === targetId ? index : -1)
                    .filter((index) => index >= 0);
                let insertionIndex;
                if (this.layerDropPosition === "inside") {
                    layer.groupId = targetId;
                    insertionIndex = memberIndexes.length ? memberIndexes.at(-1) + 1 : emptyTargetPosition;
                    this.layers.splice(insertionIndex, 0, layer);
                    group.collapsed = false;
                } else {
                    layer.groupId = null;
                    insertionIndex = memberIndexes.length
                        ? this.layerDropPosition === "before" ? memberIndexes[0] : memberIndexes.at(-1) + 1
                        : emptyTargetPosition;
                    this.layers.splice(insertionIndex, 0, layer);
                    if (!memberIndexes.length) group.position = insertionIndex + (this.layerDropPosition === "before" ? 1 : 0);
                }
                this.rebaseEmptyGroupAnchors(emptyGroupAnchors, previousIndex, insertionIndex, this.layerDropPosition !== "before");
                if (previousGroupId !== targetId) this.positionEmptyGroup(previousGroupId, previousIndex + (insertionIndex < previousIndex ? 1 : 0));
                this.activeGroupId = null;
                this.normalizeLayerOffsets();
                this.render();
                this.refreshUI();
                this.animateLayerPositions(positions);
                if (finish) this.finishLayerDrag();
            },

            moveDraggedGroup(targetType, targetId, position) {
                const groupId = this.draggedGroupId;
                if (!groupId || (targetType === "group" && groupId === targetId)) return;
                const targetLayer = targetType === "layer" ? this.layers.find((layer) => layer.id === targetId) : null;
                if (targetLayer?.groupId === groupId) return;
                const members = this.layers.filter((layer) => layer.groupId === groupId);
                const firstMemberIndex = members.length ? this.layers.indexOf(members[0]) : -1;
                const lastMemberIndex = members.length ? this.layers.indexOf(members.at(-1)) : -1;
                let firstTargetIndex = -1;
                let lastTargetIndex = -1;
                if (targetType === "group") {
                    const targetMembers = this.layers.filter((layer) => layer.groupId === targetId);
                    if (targetMembers.length) {
                        firstTargetIndex = this.layers.indexOf(targetMembers[0]);
                        lastTargetIndex = this.layers.indexOf(targetMembers.at(-1));
                    }
                } else if (targetLayer) {
                    const targetMembers = targetLayer.groupId ? this.layers.filter((layer) => layer.groupId === targetLayer.groupId) : [targetLayer];
                    firstTargetIndex = this.layers.indexOf(targetMembers[0]);
                    lastTargetIndex = this.layers.indexOf(targetMembers.at(-1));
                }
                const targetGroup = targetType === "group" ? this.groups.find((group) => group.id === targetId) : null;
                const emptyPosition = firstTargetIndex >= 0
                    ? position === "before" ? firstTargetIndex : lastTargetIndex + 1
                    : Math.max(0, Math.min(this.layers.length, targetGroup?.position ?? 0));
                if (members.length && firstTargetIndex >= 0) {
                    const settled = position === "before" ? lastMemberIndex + 1 === firstTargetIndex : lastTargetIndex + 1 === firstMemberIndex;
                    if (settled) return;
                } else if (!members.length && this.groups.find((group) => group.id === groupId)?.position === emptyPosition) {
                    if (targetType !== "group") return;
                    const from = this.groups.findIndex((group) => group.id === groupId);
                    const to = this.groups.findIndex((group) => group.id === targetId);
                    if (position === "before" ? from === to - 1 : from === to + 1) return;
                }
                this.recordLayerDrag();
                const positions = this.captureLayerPositions();
                this.layers = this.layers.filter((layer) => layer.groupId !== groupId);
                let targetIndexes = [];
                if (targetType === "group") {
                    targetIndexes = this.layers.map((layer, index) => layer.groupId === targetId ? index : -1).filter((index) => index >= 0);
                    const from = this.groups.findIndex((group) => group.id === groupId);
                    const to = this.groups.findIndex((group) => group.id === targetId);
                    if (from >= 0 && to >= 0) {
                        const [group] = this.groups.splice(from, 1);
                        const targetIndex = this.groups.findIndex((candidate) => candidate.id === targetId);
                        this.groups.splice(targetIndex + (position === "after" ? 1 : 0), 0, group);
                    }
                } else if (targetLayer) {
                    const targetGroupId = targetLayer.groupId;
                    targetIndexes = targetGroupId
                        ? this.layers.map((layer, index) => layer.groupId === targetGroupId ? index : -1).filter((index) => index >= 0)
                        : [this.layers.indexOf(targetLayer)];
                }
                const index = targetIndexes.length
                    ? position === "before" ? targetIndexes[0] : targetIndexes.at(-1) + 1
                    : emptyPosition;
                if (members.length) this.layers.splice(index, 0, ...members);
                else this.groups.find((group) => group.id === groupId).position = index;
                this.activeGroupId = groupId;
                this.activeLayerId = null;
                this.selectedLayerIds = [];
                this.layerSelectionAnchorId = null;
                this.normalizeLayerOffsets();
                this.render();
                this.refreshUI();
                this.animateLayerPositions(positions);
            },

            moveDraggedLayerToRoot(position, finish = true) {
                if (this.draggedLayerIds.length > 1) {
                    this.moveDraggedLayers("root", position, "outside", finish);
                    return;
                }
                const layer = this.layers.find((candidate) => candidate.id === this.draggedLayerId);
                if (!layer) {
                    if (finish) this.finishLayerDrag();
                    return;
                }
                const currentIndex = this.layers.indexOf(layer);
                if (!layer.groupId && (position === "top" ? currentIndex === 0 : currentIndex === this.layers.length - 1)) {
                    if (finish) this.finishLayerDrag();
                    return;
                }
                this.recordLayerDrag();
                const positions = this.captureLayerPositions();
                const previousGroupId = layer.groupId;
                const emptyGroupAnchors = this.emptyGroupAnchors();
                this.layers.splice(this.layers.indexOf(layer), 1);
                layer.groupId = null;
                const insertionIndex = position === "top" ? 0 : this.layers.length;
                this.layers.splice(insertionIndex, 0, layer);
                this.rebaseEmptyGroupAnchors(emptyGroupAnchors, currentIndex, insertionIndex, position === "top");
                this.positionEmptyGroup(previousGroupId, currentIndex + (insertionIndex < currentIndex ? 1 : 0));
                this.activeGroupId = null;
                this.activeLayerId = layer.id;
                if (!this.isLayerSelected(layer.id)) this.selectedLayerIds = [layer.id];
                this.layerSelectionAnchorId = layer.id;
                this.normalizeLayerOffsets();
                this.render();
                this.refreshUI();
                this.animateLayerPositions(positions);
                if (finish) this.finishLayerDrag();
            },

            finishLayerDrag() {
                this.draggedLayerId = null;
                this.draggedLayerIds = [];
                this.draggedLayerWasGrouped = false;
                this.draggedLayerOriginalGroupId = null;
                this.draggedGroupId = null;
                this.layerDragChanged = false;
                this.layerDropTarget = null;
                this.layerDropPosition = null;
            },

            orientationRotation(id = this.activeOrientation) {
                return ORIENTATIONS.find((orientation) => orientation.id === id) ?? ORIENTATIONS[0];
            },

            switchOrientation(id) {
                if (id === this.activeOrientation) return;
                this.confirmQuantization();
                this.activeOrientation = id;
                const target = this.orientationRotation();
                if (voxelViewRoot) voxelViewRoot.rotation.set(-target.x, -target.y, 0);
                if (perspectiveSelectionMasks) this.setSelectionMask(new Uint8Array(perspectiveSelectionMasks[id]), false);
                this.clearHover();
                this.render();
                this.refreshUI();
                this.snapVoxelRotation();
            },

            voxelPointFromEvent(event) {
                if (!voxelRaycaster || !voxelViewRoot) return null;
                const rect = this.$refs.voxelCanvas.getBoundingClientRect();
                const pointer = new THREE.Vector2(
                    (event.clientX - rect.left) / rect.width * 2 - 1,
                    -(event.clientY - rect.top) / rect.height * 2 + 1,
                );
                voxelViewRoot.updateMatrixWorld(true);
                voxelRaycaster.setFromCamera(pointer, voxelCamera);
                const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(voxelViewRoot.getWorldQuaternion(new THREE.Quaternion()));
                const planePoint = voxelViewRoot.localToWorld(new THREE.Vector3(0, 0, this.voxelLayerDepth() + 0.5));
                const hit = voxelRaycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, planePoint), new THREE.Vector3());
                if (!hit) return null;
                voxelViewRoot.worldToLocal(hit);
                return { x: hit.x + CANVAS_SIZE / 2, y: CANVAS_SIZE / 2 - hit.y };
            },

            pointFromEvent(event) {
                const voxelPoint = this.voxelPointFromEvent(event);
                if (voxelPoint) return {
                    x: Math.max(0, Math.min(CANVAS_SIZE - 1, Math.floor(voxelPoint.x))),
                    y: Math.max(0, Math.min(CANVAS_SIZE - 1, Math.floor(voxelPoint.y))),
                };
                const rect = this.$refs.canvas.getBoundingClientRect();
                return {
                    x: Math.max(0, Math.min(CANVAS_SIZE - 1, Math.floor((event.clientX - rect.left) * CANVAS_SIZE / rect.width))),
                    y: Math.max(0, Math.min(CANVAS_SIZE - 1, Math.floor((event.clientY - rect.top) * CANVAS_SIZE / rect.height))),
                };
            },

            worldPointFromEvent(event) {
                const voxelPoint = this.voxelPointFromEvent(event);
                if (voxelPoint) return { x: Math.floor(voxelPoint.x), y: Math.floor(voxelPoint.y) };
                const rect = this.$refs.canvas.getBoundingClientRect();
                return {
                    x: Math.floor((event.clientX - rect.left) * CANVAS_SIZE / rect.width),
                    y: Math.floor((event.clientY - rect.top) * CANVAS_SIZE / rect.height),
                };
            },

            setSelectionMask(mask, syncPerspectives = true) {
                if (!this.canvasFor()) return this.clearSelection();
                selectionMask = mask;
                this.selection = maskBounds(mask);
                this.selectionPath = this.selection ? maskPath(mask) : "";
                if (!this.selection) {
                    selectionMask = null;
                    selectionViewKey = null;
                    perspectiveSelectionMasks = null;
                } else {
                    selectionViewKey = this.layerViewKey();
                    if (syncPerspectives) perspectiveSelectionMasks = this.projectVoxelMask(selectionMask);
                }
                if (this.selection && (selectionAnchor || moveState)) this.updateSelectionGuides(this.selection, 0, 0);
                this.renderVoxelSelection();
            },

            mergeSelectionMask(mask, remove = false, baseMask = selectionMask) {
                const combined = baseMask ? new Uint8Array(baseMask) : new Uint8Array(LAYER_SIZE * LAYER_SIZE);
                for (let index = 0; index < mask.length; index++) if (mask[index]) combined[index] = remove ? 0 : 1;
                this.setSelectionMask(combined);
            },

            clearSelection() {
                selectionMask = null;
                selectionViewKey = null;
                perspectiveSelectionMasks = null;
                this.selection = null;
                this.selectionPath = "";
                this.clearCenterGuides();
                this.renderVoxelSelection();
            },

            clearCenterGuides() {
                this.centerGuideX = false;
                this.centerGuideY = false;
            },

            openCanvasMenu(event) {
                event.preventDefault();
                this.layerMenu = null;
                this.canvasMenu = {
                    x: Math.max(8, Math.min(event.clientX, window.innerWidth - 188)),
                    y: Math.max(8, Math.min(event.clientY, window.innerHeight - 80)),
                };
            },

            closeContextMenus(event) {
                if (event.button === 1) event.preventDefault();
                if (this.canvasMenu && !event.target.closest(".canvas-context-menu")) this.canvasMenu = null;
                if (this.layerMenu && !event.target.closest(".layer-context-menu")) this.layerMenu = null;
            },

            flipSelection(axis) {
                if (this.activeLayerLocked() || !selectionMask || !this.selection || !this.canvasFor()) return;
                const horizontal = axis === "horizontal";
                const vertical = axis === "vertical";
                if (!horizontal && !vertical) return;
                const worldAxis = horizontal
                    ? { front: "x", back: "x", right: "z", left: "z", top: "x", bottom: "x" }[this.activeOrientation]
                    : { front: "y", back: "y", right: "y", left: "y", top: "z", bottom: "z" }[this.activeOrientation];
                const screenStart = horizontal ? this.selection.x : this.selection.y;
                const screenEnd = screenStart + (horizontal ? this.selection.width : this.selection.height) - 1;
                const worldCoordinate = (value) => {
                    if (worldAxis === "x") return this.activeOrientation === "back" ? 63 - value : value;
                    if (worldAxis === "y") return value;
                    if (this.activeOrientation === "right") return 31 - value;
                    if (this.activeOrientation === "left" || this.activeOrientation === "top") return value - 32;
                    return 31 - value;
                };
                const axisSum = worldCoordinate(screenStart) + worldCoordinate(screenEnd);
                const masks = perspectiveSelectionMasks ?? this.projectVoxelMask(selectionMask);
                const facePoint = (orientation, x, y) => {
                    if (orientation === "front") return { x, y };
                    if (orientation === "back") return { x: 63 - x, y };
                    if (orientation === "right") return { z: 31 - x, y };
                    if (orientation === "left") return { z: x - 32, y };
                    if (orientation === "top") return { x, z: y - 32 };
                    return { x, z: 31 - y };
                };
                const projectPoint = (orientation, point) => {
                    if (orientation === "front") return [point.x, point.y];
                    if (orientation === "back") return [63 - point.x, point.y];
                    if (orientation === "right") return [31 - point.z, point.y];
                    if (orientation === "left") return [32 + point.z, point.y];
                    if (orientation === "top") return [point.x, 32 + point.z];
                    return [point.x, 31 - point.z];
                };
                const normalAxis = { front: "z", back: "z", right: "x", left: "x", top: "y", bottom: "y" };
                const opposite = { front: "back", back: "front", right: "left", left: "right", top: "bottom", bottom: "top" };
                const views = Object.fromEntries(ORIENTATIONS.map((orientation) => {
                    const context = this.canvasFor(this.activeLayerId, orientation.id).getContext("2d");
                    const source = context.getImageData(0, 0, LAYER_SIZE, LAYER_SIZE);
                    const result = new ImageData(new Uint8ClampedArray(source.data), LAYER_SIZE, LAYER_SIZE);
                    for (let index = 0; index < masks[orientation.id].length; index++) if (masks[orientation.id][index]) result.data.fill(0, index * 4, index * 4 + 4);
                    return [orientation.id, { context, source, result, mask: new Uint8Array(LAYER_SIZE * LAYER_SIZE) }];
                }));
                this.pushHistory();
                for (const orientation of ORIENTATIONS) {
                    const sourceView = views[orientation.id];
                    const targetOrientation = normalAxis[orientation.id] === worldAxis ? opposite[orientation.id] : orientation.id;
                    const targetView = views[targetOrientation];
                    for (let y = 0; y < CANVAS_SIZE; y++) for (let x = 0; x < CANVAS_SIZE; x++) {
                        const sourceIndex = maskIndex(x, y);
                        const sourceOffset = sourceIndex * 4;
                        if (!masks[orientation.id][sourceIndex] || !sourceView.source.data[sourceOffset + 3]) continue;
                        const point = facePoint(orientation.id, x, y);
                        if (point[worldAxis] !== undefined) point[worldAxis] = axisSum - point[worldAxis];
                        const [targetX, targetY] = projectPoint(targetOrientation, point);
                        if (targetX < 0 || targetX >= CANVAS_SIZE || targetY < 0 || targetY >= CANVAS_SIZE) continue;
                        const targetIndex = maskIndex(targetX, targetY);
                        targetView.result.data.set(sourceView.source.data.subarray(sourceOffset, sourceOffset + 4), targetIndex * 4);
                        targetView.mask[targetIndex] = 1;
                    }
                }
                for (const orientation of ORIENTATIONS) {
                    views[orientation.id].context.putImageData(views[orientation.id].result, 0, 0);
                    if (orientation.id !== "front") editedViews.add(this.layerViewKey(this.activeLayerId, orientation.id));
                    deletePaletteSource(this.layerViewKey(this.activeLayerId, orientation.id));
                }
                const overrides = new Map();
                for (const [key, color] of copyVoxelOverrides(this.activeLayerId)) {
                    const point = voxelCoordinates(key);
                    if (voxelSelected(masks, point.x, point.y, point.z)) point[worldAxis] = axisSum - point[worldAxis];
                    if (point.x >= 0 && point.x < CANVAS_SIZE && point.y >= 0 && point.y < CANVAS_SIZE && point.z >= -CANVAS_SIZE / 2 && point.z < CANVAS_SIZE / 2) {
                        overrides.set(voxelKey(point.x, point.y, point.z), color);
                    }
                }
                setVoxelOverrides(this.activeLayerId, overrides);
                perspectiveSelectionMasks = Object.fromEntries(ORIENTATIONS.map((orientation) => [orientation.id, views[orientation.id].mask]));
                this.setSelectionMask(new Uint8Array(perspectiveSelectionMasks[this.activeOrientation]), false);
                this.compactLayerDepth(this.activeLayerId, true);
                this.canvasMenu = null;
                this.render();
            },

            activeBrushSize() {
                return this.tool === "eraser" ? this.eraserSize : this.pencilSize;
            },

            updateCenterGuides(point) {
                this.centerGuideX = Math.abs(point.x - CANVAS_SIZE / 2) <= 1;
                this.centerGuideY = Math.abs(point.y - CANVAS_SIZE / 2) <= 1;
                return point;
            },

            updateSelectionGuides(selection, dx, dy) {
                const left = selection.x + dx;
                const top = selection.y + dy;
                const horizontalPoints = [left, left + selection.width / 2, left + selection.width];
                const verticalPoints = [top, top + selection.height / 2, top + selection.height];
                this.centerGuideX = horizontalPoints.some((point) => Math.abs(point - CANVAS_SIZE / 2) <= 1);
                this.centerGuideY = verticalPoints.some((point) => Math.abs(point - CANVAS_SIZE / 2) <= 1);
                return { dx, dy };
            },

            selectLayerPixels(id = this.activeLayerId) {
                const masks = {};
                for (const orientation of ORIENTATIONS) {
                    const canvas = this.canvasFor(id, orientation.id);
                    if (!canvas) return;
                    const pixels = canvas.getContext("2d").getImageData(0, 0, LAYER_SIZE, LAYER_SIZE).data;
                    const mask = new Uint8Array(LAYER_SIZE * LAYER_SIZE);
                    for (let index = 0; index < mask.length; index++) if (pixels[index * 4 + 3]) mask[index] = 1;
                    masks[orientation.id] = mask;
                }
                if (!maskBounds(masks[this.activeOrientation])) return;
                perspectiveSelectionMasks = masks;
                this.setSelectionMask(new Uint8Array(masks[this.activeOrientation]), false);
            },

            toggleLayerPixels(id) {
                if (this.selection && selectionViewKey === this.layerViewKey(id)) {
                    this.clearSelection();
                    return;
                }
                if (this.activeLayerId !== id) this.selectLayer(id);
                this.selectLayerPixels(id);
            },

            isLayerSelected(id) {
                return this.selectedLayerIds.includes(id);
            },

            activeLayerLocked() {
                return !!this.layers.find((layer) => layer.id === this.activeLayerId)?.locked;
            },

            toggleLayerLock(id = null) {
                const layers = this.layers.filter((layer) => id ? layer.id === id : this.selectedLayerIds.includes(layer.id));
                if (!layers.length) return;
                this.pushHistory();
                const locked = !layers.every((layer) => layer.locked);
                for (const layer of layers) layer.locked = locked;
                if (locked && layers.some((layer) => layer.id === this.activeLayerId)) this.clearSelection();
                this.render();
            },

            openLayerMenu(id, event) {
                if (this.activeGroupId || this.selectedLayerIds.length < 2 || !this.isLayerSelected(id)) return;
                event.preventDefault();
                event.stopPropagation();
                this.canvasMenu = null;
                this.layerMenu = {
                    x: Math.max(8, Math.min(event.clientX, window.innerWidth - 188)),
                    y: Math.max(8, Math.min(event.clientY, window.innerHeight - 48)),
                };
            },

            mergeSelectedLayers() {
                const ids = new Set(this.selectedLayerIds);
                const selected = this.layers.filter((layer) => ids.has(layer.id));
                if (selected.length < 2 || this.activeGroupId || selected.some((layer) => layer.locked)) return;
                this.confirmQuantization();
                this.syncPaletteSourceEdits();
                this.syncDerivedOrientations();
                this.pushHistory(false);
                const target = selected[0];
                const visible = selected.filter((layer) => layer.visible);
                const mergedCaches = selected.flatMap((layer) => ORIENTATIONS.map((orientation) => quantizedPalettes.get(viewKey(orientation.id, layer.id))).filter(Boolean));
                const mergedPalette = [...new Set(mergedCaches.flatMap((cached) => cached.palette))];
                const mergedConfirmed = mergedCaches.some((cached) => cached.confirmed);
                const composites = new Map();
                for (const orientation of ORIENTATIONS) {
                    const composite = createLayerCanvas();
                    const context = composite.getContext("2d", CANVAS_CONTEXT_OPTIONS);
                    for (const layer of [...visible].reverse()) context.drawImage(this.canvasFor(layer.id, orientation.id), 0, 0);
                    composites.set(orientation.id, composite);
                }
                const removed = selected.slice(1).map((layer) => ({ layer, index: this.layers.indexOf(layer) }));
                for (const layer of selected) for (const orientation of ORIENTATIONS) {
                    const key = viewKey(orientation.id, layer.id);
                    quantizedPalettes.delete(key);
                    paletteOrders.delete(key);
                    deletePaletteSource(key);
                    paletteSourceEdits.delete(key);
                    editedViews.delete(key);
                    if (layer !== target) canvases.delete(key);
                }
                for (const orientation of ORIENTATIONS) {
                    const key = viewKey(orientation.id, target.id);
                    const context = this.canvasFor(target.id, orientation.id).getContext("2d", CANVAS_CONTEXT_OPTIONS);
                    context.clearRect(0, 0, LAYER_SIZE, LAYER_SIZE);
                    context.drawImage(composites.get(orientation.id), 0, 0);
                    if (mergedPalette.length) {
                        quantizedPalettes.set(key, { palette: [...mergedPalette], colors: mergedPalette.map(hexColor), allowed: new Set(mergedPalette), confirmed: mergedConfirmed, locked: false });
                        paletteOrders.set(key, [...mergedPalette]);
                    }
                    if (orientation.id !== "front") editedViews.add(key);
                }
                this.layers = this.layers.filter((layer) => !ids.has(layer.id) || layer === target);
                target.visible = visible.length > 0;
                for (const { layer, index } of removed) this.positionEmptyGroup(layer.groupId, Math.min(index, this.layers.length));
                this.activeLayerId = target.id;
                this.activeGroupId = null;
                this.selectedLayerIds = [target.id];
                this.layerSelectionAnchorId = target.id;
                this.layerMenu = null;
                this.clearSelection();
                this.normalizeLayerOffsets();
                this.render();
                this.refreshUI();
            },

            selectLayer(id, event = {}) {
                this.confirmQuantization();
                const visible = this.layerEntries().filter((entry) => entry.type === "layer").map((entry) => entry.layer.id);
                const additive = !!(event.ctrlKey || event.metaKey);
                if (event.shiftKey) {
                    const anchor = visible.includes(this.layerSelectionAnchorId) ? this.layerSelectionAnchorId : this.activeLayerId;
                    const start = visible.indexOf(anchor);
                    const end = visible.indexOf(id);
                    const range = visible.slice(Math.min(start < 0 ? end : start, end), Math.max(start < 0 ? end : start, end) + 1);
                    this.selectedLayerIds = additive ? [...new Set([...this.selectedLayerIds, ...range])] : range;
                    this.activeLayerId = id;
                } else if (additive) {
                    if (this.isLayerSelected(id)) {
                        this.selectedLayerIds = this.selectedLayerIds.filter((selectedId) => selectedId !== id);
                        if (this.activeLayerId === id) this.activeLayerId = this.selectedLayerIds.at(-1) ?? null;
                    } else {
                        this.selectedLayerIds = [...this.selectedLayerIds, id];
                        this.activeLayerId = id;
                    }
                    this.layerSelectionAnchorId = id;
                } else {
                    this.selectedLayerIds = [id];
                    this.activeLayerId = id;
                    this.layerSelectionAnchorId = id;
                }
                this.activeGroupId = null;
                this.render();
            },

            activateLayer(id) {
                this.selectLayer(id);
            },

            selectionStyle() {
                if (!this.selection) return {};
                return {
                    left: `${this.selection.x / CANVAS_SIZE * 100}%`,
                    top: `${this.selection.y / CANVAS_SIZE * 100}%`,
                    width: `${this.selection.width / CANVAS_SIZE * 100}%`,
                    height: `${this.selection.height / CANVAS_SIZE * 100}%`,
                };
            },

            capturePointer(event) {
                pointerTarget = event.currentTarget;
                pointerTarget.setPointerCapture(event.pointerId);
            },

            blurActiveControl() {
                if (document.activeElement?.matches("input, textarea, select")) document.activeElement.blur();
            },

            hoverStyle() {
                if (!this.hoverPoint) return {};
                const size = this.tool === "pencil" || this.tool === "eraser"
                    ? Math.max(1, Math.min(16, Number(this.activeBrushSize()) || 1))
                    : 1;
                return {
                    left: `${this.hoverPoint.x / CANVAS_SIZE * 100}%`,
                    top: `${this.hoverPoint.y / CANVAS_SIZE * 100}%`,
                    width: `${size / CANVAS_SIZE * 100}%`,
                    height: `${size / CANVAS_SIZE * 100}%`,
                };
            },

            renderVoxelCursor() {
                if (!voxelCursor) return;
                const rulerCoordinate = this.hoverPoint
                    ? `${Math.floor(this.hoverPoint.x)}:${Math.floor(this.hoverPoint.y)}`
                    : null;
                if (rulerCoordinate !== voxelRulerCoordinate) {
                    voxelRulerCoordinate = rulerCoordinate;
                    voxelRulersDirty = true;
                }
                voxelCursor.visible = !!this.hoverPoint;
                voxelCrosshair.visible = !!this.hoverPoint;
                if (previewVoxelCursor) previewVoxelCursor.visible = false;
                for (const cursor of voxelMirrorCursors) cursor.visible = false;
                if (this.hoverPoint) {
                    const depth = this.voxelLayerDepth();
                    const size = this.tool === "pencil" || this.tool === "eraser"
                        ? Math.max(1, Math.min(16, Number(this.activeBrushSize()) || 1))
                        : 1;
                    const startX = Math.floor(this.hoverPoint.x) - Math.floor((size - 1) / 2);
                    const startY = Math.floor(this.hoverPoint.y) - Math.floor((size - 1) / 2);
                    const x = Math.max(0, Math.min(CANVAS_SIZE - 1, Math.floor(this.hoverPoint.x)));
                    const y = Math.max(0, Math.min(CANVAS_SIZE - 1, Math.floor(this.hoverPoint.y)));
                    const pixel = this.context.getImageData(x, y, 1, 1).data;
                    const luminance = pixel[3] ? (pixel[0] * 0.2126 + pixel[1] * 0.7152 + pixel[2] * 0.0722) / 255 : 1;
                    const cursorColor = luminance > 0.5 ? 0x111315 : 0xffffff;
                    voxelCursor.material.color.set(cursorColor);
                    voxelCrosshair.material.color.set(cursorColor);
                    const layer = this.layers.find((candidate) => candidate.visible
                        && this.canvasFor(candidate.id).getContext("2d").getImageData(x + LAYER_PADDING, y + LAYER_PADDING, 1, 1).data[3])
                        ?? this.layers.find((candidate) => candidate.id === this.activeLayerId);
                    if (previewVoxelCursor && layer) {
                        const range = layerDepthRanges(this.layers).get(layer.id);
                        const views = Object.fromEntries(ORIENTATIONS.map((orientation) => [
                            orientation.id,
                            this.canvasFor(layer.id, orientation.id).getContext("2d").getImageData(LAYER_PADDING, LAYER_PADDING, CANVAS_SIZE, CANVAS_SIZE).data,
                        ]));
                        const occupied = (worldX, worldY, worldZ) => containsDepthZ(range, worldZ) && voxelOccupied(views, worldX, worldY, worldZ);
                        let worldX = x;
                        let worldY = y;
                        let worldZ = range.end - 1;
                        if (this.activeOrientation === "back") [worldX, worldZ] = [63 - x, range.start];
                        if (this.activeOrientation === "right" || this.activeOrientation === "left") {
                            worldZ = this.activeOrientation === "right" ? 31 - x : x - 32;
                            worldX = this.activeOrientation === "right" ? 63 : 0;
                            const step = this.activeOrientation === "right" ? -1 : 1;
                            while (worldX >= 0 && worldX < CANVAS_SIZE && !occupied(worldX, worldY, worldZ)) worldX += step;
                            if (worldX < 0 || worldX >= CANVAS_SIZE) worldX = this.activeOrientation === "right" ? 63 : 0;
                        }
                        if (this.activeOrientation === "top" || this.activeOrientation === "bottom") {
                            worldZ = this.activeOrientation === "top" ? y - 32 : 31 - y;
                            worldY = this.activeOrientation === "top" ? 0 : 63;
                            const step = this.activeOrientation === "top" ? 1 : -1;
                            while (worldY >= 0 && worldY < CANVAS_SIZE && !occupied(worldX, worldY, worldZ)) worldY += step;
                            if (worldY < 0 || worldY >= CANVAS_SIZE) worldY = this.activeOrientation === "top" ? 0 : 63;
                        }
                        previewVoxelCursor.visible = true;
                        previewVoxelCursor.material.color.set(cursorColor);
                        const visibleLayers = this.layers.filter((candidate) => candidate.visible);
                        const visibleIndex = visibleLayers.findIndex((candidate) => candidate.id === layer.id);
                        const faceOffset = visibleIndex < 0 ? 0 : (visibleLayers.length - visibleIndex) * 0.001;
                        const facePosition = [worldX - 31.5, 31.5 - worldY, worldZ + 0.5];
                        previewVoxelCursor.rotation.set(0, 0, 0);
                        if (this.activeOrientation === "front") facePosition[2] += 0.502 + faceOffset;
                        if (this.activeOrientation === "back") {
                            facePosition[2] -= 0.502 + faceOffset;
                            previewVoxelCursor.rotation.y = Math.PI;
                        }
                        if (this.activeOrientation === "right") {
                            facePosition[0] += 0.502 + faceOffset;
                            previewVoxelCursor.rotation.y = Math.PI / 2;
                        }
                        if (this.activeOrientation === "left") {
                            facePosition[0] -= 0.502 + faceOffset;
                            previewVoxelCursor.rotation.y = -Math.PI / 2;
                        }
                        if (this.activeOrientation === "top") {
                            facePosition[1] += 0.502 + faceOffset;
                            previewVoxelCursor.rotation.x = -Math.PI / 2;
                        }
                        if (this.activeOrientation === "bottom") {
                            facePosition[1] -= 0.502 + faceOffset;
                            previewVoxelCursor.rotation.x = Math.PI / 2;
                        }
                        previewVoxelCursor.position.set(...facePosition);
                    }
                    voxelCursor.position.set(startX + (size - 1) / 2 - 31.5, 31.5 - startY - (size - 1) / 2, depth + 0.04);
                    voxelCursor.scale.set(size, size, 1);
                    voxelCrosshair.position.set(this.hoverPoint.x - 32, 32 - this.hoverPoint.y, depth + 0.56);
                    if (this.tool === "pencil" || this.tool === "eraser") {
                        const [verticalCursor, horizontalCursor, combinedCursor] = voxelMirrorCursors;
                        const position = voxelCursor.position;
                        if (this.verticalSymmetry) {
                            verticalCursor.visible = true;
                            verticalCursor.position.set(-position.x, position.y, position.z);
                            verticalCursor.scale.copy(voxelCursor.scale);
                        }
                        if (this.horizontalSymmetry) {
                            horizontalCursor.visible = true;
                            horizontalCursor.position.set(position.x, -position.y, position.z);
                            horizontalCursor.scale.copy(voxelCursor.scale);
                        }
                        if (this.verticalSymmetry && this.horizontalSymmetry) {
                            combinedCursor.visible = true;
                            combinedCursor.position.set(-position.x, -position.y, position.z);
                            combinedCursor.scale.copy(voxelCursor.scale);
                        }
                    }
                }
                this.renderVoxelScene();
                this.renderPreviewScene();
            },

            clearHover() {
                this.hoverPoint = null;
                this.clearCenterGuides();
                this.renderVoxelCursor();
            },

            updateHover(event) {
                if (event.pointerType === "touch") {
                    this.clearHover();
                    return;
                }
                const rect = this.$refs.canvas.getBoundingClientRect();
                const inside = event.clientX >= rect.left && event.clientX < rect.right
                    && event.clientY >= rect.top && event.clientY < rect.bottom;
                const showGuides = this.tool === "pencil" || this.tool === "eraser" || (this.tool === "selection" && !selectionAnchor);
                const voxelPoint = this.voxelPointFromEvent(event);
                if (voxelPoint) {
                    const inside = voxelPoint.x >= 0 && voxelPoint.x < CANVAS_SIZE && voxelPoint.y >= 0 && voxelPoint.y < CANVAS_SIZE;
                    this.hoverPoint = inside && showGuides ? this.updateCenterGuides(voxelPoint) : inside ? voxelPoint : null;
                    if (!this.hoverPoint || !showGuides) if (!selectionAnchor && !moveState) this.clearCenterGuides();
                    this.renderVoxelCursor();
                    return;
                }
                const hoverPoint = inside ? {
                    x: (event.clientX - rect.left) * CANVAS_SIZE / rect.width,
                    y: (event.clientY - rect.top) * CANVAS_SIZE / rect.height,
                } : null;
                this.hoverPoint = hoverPoint && showGuides ? this.updateCenterGuides(hoverPoint) : hoverPoint;
                if (!this.hoverPoint || !showGuides) if (!selectionAnchor && !moveState) this.clearCenterGuides();
                this.renderVoxelCursor();
            },

            containsPoint(point) {
                return selectionMask?.[maskIndex(point.x, point.y)] === 1;
            },

            startVoxelPan(event) {
                event.preventDefault();
                this.blurActiveControl();
                if (!voxelCamera || this.voxelZoom <= 1) return;
                const size = this.$refs.voxelCanvas.getBoundingClientRect();
                voxelPan = {
                    pointerId: event.pointerId,
                    clientX: event.clientX,
                    clientY: event.clientY,
                    cameraX: voxelCamera.position.x,
                    cameraY: voxelCamera.position.y,
                    scaleX: (voxelCamera.right - voxelCamera.left) / (size.width * voxelCamera.zoom),
                    scaleY: (voxelCamera.top - voxelCamera.bottom) / (size.height * voxelCamera.zoom),
                };
                this.capturePointer(event);
            },

            continueVoxelPan(event) {
                if (event.pointerId !== voxelPan?.pointerId || this.voxelZoom <= 1) return;
                voxelCamera.position.x = voxelPan.cameraX - (event.clientX - voxelPan.clientX) * voxelPan.scaleX;
                voxelCamera.position.y = voxelPan.cameraY + (event.clientY - voxelPan.clientY) * voxelPan.scaleY;
                this.clampVoxelCamera();
                voxelRulersDirty = true;
                this.renderVoxelScene();
            },

            endVoxelPan(event) {
                if (event.pointerId !== voxelPan?.pointerId) return;
                voxelPan = null;
            },

            snapVoxelRotation() {
                if (!voxelRoot) return;
                cancelAnimationFrame(voxelSnapFrame);
                const target = this.orientationRotation();
                const startRotation = voxelRoot.quaternion.clone();
                const targetRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(target.x, target.y, 0));
                const started = performance.now();
                voxelGrid.visible = false;
                const snap = (time) => {
                    const progress = Math.min(1, (time - started) / 260);
                    const eased = 1 - (1 - progress) ** 3;
                    voxelRoot.quaternion.slerpQuaternions(startRotation, targetRotation, eased);
                    if (progress < 1) voxelSnapFrame = requestAnimationFrame(snap);
                    else {
                        voxelSnapFrame = null;
                        voxelRoot.rotation.set(target.x, target.y, 0);
                        voxelGrid.visible = this.gridVisible;
                    }
                    this.renderVoxelScene();
                };
                voxelSnapFrame = requestAnimationFrame(snap);
            },

            startPointer(event) {
                if (event.button === 0) this.blurActiveControl();
                if (event.button === 1) {
                    this.startVoxelPan(event);
                    return;
                }
                if (event.button !== 0) return;
                this.updateHover(event);
                if (this.tool === "selection") this.startSelection(event);
                else if (this.tool === "wand") this.magicSelect(event);
                else if (this.tool === "bucket") this.bucketFill(event);
                else if (this.tool === "move") this.startMove(event);
                else if (this.tool === "eyedropper") this.startEyedropper(event);
                else this.startStroke(event);
            },

            continuePointer(event) {
                if (voxelPan) {
                    this.continueVoxelPan(event);
                    return;
                }
                this.updateHover(event);
                if (selectionAnchor) this.continueSelection(event);
                else if (moveState) this.continueMove(event);
                else if (this.sampling) this.sampleColor(event);
                else this.continueStroke(event);
            },

            endPointer(event) {
                if (voxelPan) this.endVoxelPan(event);
                else if (selectionAnchor) this.endSelection(event);
                else if (moveState) this.endMove(event);
                else if (this.sampling) this.endEyedropper(event);
                else this.endStroke(event);
                if (pointerTarget?.hasPointerCapture(event.pointerId)) pointerTarget.releasePointerCapture(event.pointerId);
                pointerTarget = null;
            },

            magicSelect(event) {
                const context = this.canvasFor()?.getContext("2d");
                if (!context) return;
                event.preventDefault();
                const point = this.pointFromEvent(event);
                const pixels = context.getImageData(LAYER_PADDING, LAYER_PADDING, CANVAS_SIZE, CANVAS_SIZE).data;
                const start = (point.y * CANVAS_SIZE + point.x) * 4;
                const cached = quantizedPalettes.get(this.layerViewKey());
                const target = hexColor(this.palettePixelColor(pixels, start, cached));
                target[3] = pixels[start + 3];
                const tolerance = Math.max(0, Math.min(255, Number(this.wandTolerance) || 0));
                const mask = new Uint8Array(LAYER_SIZE * LAYER_SIZE);
                const visited = new Uint8Array(CANVAS_SIZE * CANVAS_SIZE);
                const stack = [point.y * CANVAS_SIZE + point.x];
                while (stack.length) {
                    const index = stack.pop();
                    if (visited[index]) continue;
                    visited[index] = 1;
                    const offset = index * 4;
                    if (!this.matchesPalettePixel(pixels, offset, target, tolerance, cached)) continue;
                    const x = index % CANVAS_SIZE;
                    const y = Math.floor(index / CANVAS_SIZE);
                    mask[maskIndex(x, y)] = 1;
                    if (x > 0) stack.push(index - 1);
                    if (x < CANVAS_SIZE - 1) stack.push(index + 1);
                    if (y > 0) stack.push(index - CANVAS_SIZE);
                    if (y < CANVAS_SIZE - 1) stack.push(index + CANVAS_SIZE);
                }
                if ((event.shiftKey || event.altKey) && selectionMask) this.mergeSelectionMask(mask, event.altKey);
                else this.setSelectionMask(mask);
            },

            bucketFill(event) {
                if (this.activeLayerLocked()) return;
                event.preventDefault();
                const point = this.pointFromEvent(event);
                if (selectionMask && !this.containsPoint(point)) return;
                let activeLayer = this.layers.find((layer) => layer.id === this.activeLayerId);
                const hadLayer = !!activeLayer;
                if (!hadLayer) {
                    this.pushHistory();
                    activeLayer = this.ensureActiveLayer();
                }
                const context = this.activeContext();
                const image = context.getImageData(LAYER_PADDING, LAYER_PADDING, CANVAS_SIZE, CANVAS_SIZE);
                const pixels = image.data;
                const start = point.y * CANVAS_SIZE + point.x;
                const offset = start * 4;
                const cached = quantizedPalettes.get(this.layerViewKey());
                const target = hexColor(this.palettePixelColor(pixels, offset, cached));
                target[3] = pixels[offset + 3];
                this.allowPaletteColor();
                const fill = hexColor(this.color);
                if (target.every((channel, index) => channel === fill[index])) return;
                const tolerance = Math.max(0, Math.min(255, Number(this.wandTolerance) || 0));
                const visited = new Uint8Array(CANVAS_SIZE * CANVAS_SIZE);
                const stack = [start];
                if (hadLayer) this.pushHistory();
                this.markViewEdited();
                while (stack.length) {
                    const index = stack.pop();
                    const x = index % CANVAS_SIZE;
                    const y = Math.floor(index / CANVAS_SIZE);
                    if (visited[index] || (selectionMask && !selectionMask[maskIndex(x, y)])) continue;
                    visited[index] = 1;
                    const pixelOffset = index * 4;
                    if (!this.matchesPalettePixel(pixels, pixelOffset, target, tolerance, cached)) continue;
                    pixels[pixelOffset] = fill[0];
                    pixels[pixelOffset + 1] = fill[1];
                    pixels[pixelOffset + 2] = fill[2];
                    pixels[pixelOffset + 3] = fill[3];
                    if (x > 0) stack.push(index - 1);
                    if (x < CANVAS_SIZE - 1) stack.push(index + 1);
                    if (y > 0) stack.push(index - CANVAS_SIZE);
                    if (y < CANVAS_SIZE - 1) stack.push(index + CANVAS_SIZE);
                }
                activeLayer.visible = true;
                context.putImageData(image, LAYER_PADDING, LAYER_PADDING);
                this.render();
            },

            startEyedropper(event) {
                if (this.pointerId !== null) return;
                event.preventDefault();
                this.pointerId = event.pointerId;
                this.sampling = true;
                this.capturePointer(event);
                this.sampleColor(event);
            },

            sampleColor(event) {
                if (event.pointerId !== this.pointerId) return;
                const point = this.pointFromEvent(event);
                if (voxelRaycaster && voxelRoot) {
                    voxelRoot.updateMatrixWorld(true);
                    const hit = voxelRaycaster.intersectObjects([
                        ...voxelFaceMeshes.values(),
                        ...voxelLayerMeshes.values(),
                    ].filter((mesh) => mesh.visible), false)[0];
                    if (!hit || hit.instanceId == null) return;
                    const color = new THREE.Color();
                    hit.object.getColorAt(hit.instanceId, color);
                    this.color = `#${color.getHexString(THREE.SRGBColorSpace)}`;
                    return;
                }
                const pixel = this.context.getImageData(point.x, point.y, 1, 1).data;
                if (!pixel[3]) return;
                this.color = this.canonicalPixelColor(pixel, 0);
            },

            endEyedropper(event) {
                if (event.pointerId !== this.pointerId) return;
                this.sampling = false;
                this.pointerId = null;
            },

            startSelection(event) {
                if (this.pointerId !== null || !this.canvasFor()) return;
                event.preventDefault();
                this.pointerId = event.pointerId;
                this.capturePointer(event);
                const rawPoint = this.pointFromEvent(event);
                const mode = event.shiftKey ? "add" : this.containsPoint(rawPoint) ? "move" : "create";
                const point = mode === "move" ? rawPoint : this.updateCenterGuides(rawPoint);
                selectionAnchor = {
                    mode,
                    start: point,
                    selection: this.selection ? { ...this.selection } : null,
                    mask: selectionMask ? new Uint8Array(selectionMask) : null,
                    clientX: event.clientX,
                    clientY: event.clientY,
                    moved: false,
                    axisLock: null,
                };
            },

            continueSelection(event) {
                if (event.pointerId !== this.pointerId) return;
                if (!selectionAnchor.moved) {
                    selectionAnchor.moved = Math.hypot(event.clientX - selectionAnchor.clientX, event.clientY - selectionAnchor.clientY) >= 2;
                    if (!selectionAnchor.moved) return;
                }
                const point = selectionAnchor.mode === "move" ? this.worldPointFromEvent(event) : this.updateCenterGuides(this.pointFromEvent(event));
                if (selectionAnchor.mode === "move") {
                    const selection = selectionAnchor.selection;
                    let dx = Math.max(-LAYER_PADDING - selection.x, Math.min(CANVAS_SIZE + LAYER_PADDING - selection.x - selection.width, point.x - selectionAnchor.start.x));
                    let dy = Math.max(-LAYER_PADDING - selection.y, Math.min(CANVAS_SIZE + LAYER_PADDING - selection.y - selection.height, point.y - selectionAnchor.start.y));
                    if (event.shiftKey) {
                        selectionAnchor.axisLock ??= dx || dy ? Math.abs(dx) >= Math.abs(dy) ? "horizontal" : "vertical" : null;
                        selectionAnchor.axisLock === "horizontal" ? dy = 0 : selectionAnchor.axisLock === "vertical" && (dx = 0);
                    }
                    ({ dx, dy } = this.updateSelectionGuides(selection, dx, dy));
                    this.setSelectionMask(translateMask(selectionAnchor.mask, dx, dy));
                    return;
                }
                const start = selectionAnchor.start;
                const x = Math.min(start.x, point.x);
                const y = Math.min(start.y, point.y);
                const rectangle = rectangleMask(x, y, Math.abs(point.x - start.x) + 1, Math.abs(point.y - start.y) + 1);
                if (selectionAnchor.mode === "add") this.mergeSelectionMask(rectangle, false, selectionAnchor.mask);
                else this.setSelectionMask(rectangle);
            },

            endSelection(event) {
                if (event.pointerId !== this.pointerId) return;
                if (!selectionAnchor.moved && selectionAnchor.mode !== "add") this.clearSelection();
                selectionAnchor = null;
                this.pointerId = null;
            },

            startMove(event) {
                if (event.button !== 0) return;
                if (this.pointerId !== null) return;
                if (this.activeLayerLocked() || !this.canvasFor()) return;
                if (!this.selection) this.selectLayerPixels();
                if (!this.selection) return;
                const point = this.worldPointFromEvent(event);
                if (!this.containsPoint(point)) return;
                event.preventDefault();
                this.capturePointer(event);
                const selection = { ...this.selection };
                const mask = new Uint8Array(selectionMask);
                const masks = perspectiveSelectionMasks ?? this.projectVoxelMask(mask);
                const layer = this.layers.find((candidate) => candidate.id === this.activeLayerId);
                this.pointerId = event.pointerId;
                moveState = {
                    start: point,
                    selection,
                    mask,
                    views: ORIENTATIONS.map((orientation) => ({
                        orientation: orientation.id,
                        mask: new Uint8Array(masks[orientation.id]),
                        pixels: maskedLayerPixels(this.canvasFor(this.activeLayerId, orientation.id), masks[orientation.id]),
                        base: this.canvasFor(this.activeLayerId, orientation.id).getContext("2d").getImageData(0, 0, LAYER_SIZE, LAYER_SIZE),
                    })),
                    depth: layer.depth,
                    offset: layer.offset,
                    dx: 0,
                    dy: 0,
                    recorded: false,
                    axisLock: null,
                };
            },

            continueMove(event) {
                if (event.pointerId !== this.pointerId) return;
                const point = this.worldPointFromEvent(event);
                const selection = moveState.selection;
                let dx = Math.max(-LAYER_PADDING - selection.x, Math.min(CANVAS_SIZE + LAYER_PADDING - selection.x - selection.width, point.x - moveState.start.x));
                let dy = Math.max(-LAYER_PADDING - selection.y, Math.min(CANVAS_SIZE + LAYER_PADDING - selection.y - selection.height, point.y - moveState.start.y));
                if (event.shiftKey) {
                    moveState.axisLock ??= dx || dy ? Math.abs(dx) >= Math.abs(dy) ? "horizontal" : "vertical" : null;
                    moveState.axisLock === "horizontal" ? dy = 0 : moveState.axisLock === "vertical" && (dx = 0);
                }
                ({ dx, dy } = this.updateSelectionGuides(selection, dx, dy));
                if (dx === moveState.dx && dy === moveState.dy) return;
                if (!moveState.recorded) {
                    this.pushHistory();
                    this.markViewEdited();
                    for (const orientation of ORIENTATIONS.slice(1)) editedViews.add(this.layerViewKey(this.activeLayerId, orientation.id));
                    moveState.recorded = true;
                }
                moveState.dx = dx;
                moveState.dy = dy;
                const layer = this.layers.find((candidate) => candidate.id === this.activeLayerId);
                layer.depth = moveState.depth;
                layer.offset = moveState.offset;
                for (const view of moveState.views) {
                    const context = this.canvasFor(this.activeLayerId, view.orientation).getContext("2d");
                    context.putImageData(view.base, 0, 0);
                }
                this.clearProjectedPixels(Object.fromEntries(moveState.views.map((view) => [view.orientation, view.mask])), false);
                for (const view of moveState.views) {
                    const context = this.canvasFor(this.activeLayerId, view.orientation).getContext("2d");
                    const [moveX, moveY] = this.relativeTranslation(view.orientation, dx, dy);
                    context.drawImage(view.pixels, moveX, moveY);
                }
                perspectiveSelectionMasks = Object.fromEntries(moveState.views.map((view) => {
                    const [moveX, moveY] = this.relativeTranslation(view.orientation, dx, dy);
                    const mask = translateMask(view.mask, moveX, moveY);
                    const pixels = this.canvasFor(this.activeLayerId, view.orientation).getContext("2d").getImageData(0, 0, LAYER_SIZE, LAYER_SIZE).data;
                    for (let index = 0; index < mask.length; index++) if (mask[index] && !pixels[index * 4 + 3]) mask[index] = 0;
                    return [view.orientation, mask];
                }));
                this.setSelectionMask(new Uint8Array(perspectiveSelectionMasks[this.activeOrientation]), false);
                this.compactLayerDepth(this.activeLayerId, true);
                this.render();
            },

            endMove(event) {
                if (event.pointerId !== this.pointerId) return;
                moveState = null;
                this.pointerId = null;
                this.clearCenterGuides();
            },

            activeContext() {
                return this.canvasFor().getContext("2d", CANVAS_CONTEXT_OPTIONS);
            },

            paint(x, y) {
                const eraseMask = this.tool === "eraser" ? new Uint8Array(LAYER_SIZE * LAYER_SIZE) : null;
                const activePixels = !eraseMask ? this.activeContext().getImageData(0, 0, LAYER_SIZE, LAYER_SIZE).data : null;
                const paintPoints = [];
                const size = Math.max(1, Math.min(16, Number(this.activeBrushSize()) || 1));
                const startX = x - Math.floor((size - 1) / 2);
                const startY = y - Math.floor((size - 1) / 2);
                for (let py = startY; py < startY + size; py++) for (let px = startX; px < startX + size; px++) {
                    const points = [[px, py]];
                    if (this.verticalSymmetry) points.push([CANVAS_SIZE - 1 - px, py]);
                    if (this.horizontalSymmetry) points.push([px, CANVAS_SIZE - 1 - py]);
                    if (this.verticalSymmetry && this.horizontalSymmetry) points.push([CANVAS_SIZE - 1 - px, CANVAS_SIZE - 1 - py]);
                    for (const [paintX, paintY] of points) {
                        if (paintX < 0 || paintX >= CANVAS_SIZE || paintY < 0 || paintY >= CANVAS_SIZE) continue;
                        if (selectionMask && !selectionMask[maskIndex(paintX, paintY)]) continue;
                        if (eraseMask) eraseMask[maskIndex(paintX, paintY)] = 1;
                        else {
                            const newPixel = !activePixels[maskIndex(paintX, paintY) * 4 + 3];
                            if (this.activeOrientation === "front" || !newPixel) paintPoints.push([paintX, paintY, newPixel]);
                        }
                    }
                }
                if (eraseMask || paintPoints.length) this.markViewEdited();
                if (eraseMask) this.clearProjectedPixels(this.projectVoxelMask(eraseMask, this.activeOrientation), false);
                else {
                    if (this.activeOrientation === "right" || this.activeOrientation === "left") this.expandLayerDepthForPaint(...paintPoints.map(([paintX]) => this.activeOrientation === "right" ? 31 - paintX : paintX - 32));
                    else if (this.activeOrientation === "top" || this.activeOrientation === "bottom") this.expandLayerDepthForPaint(...paintPoints.map(([, paintY]) => this.activeOrientation === "top" ? paintY - 32 : 31 - paintY));
                    for (const [paintX, paintY, newPixel] of paintPoints) this.paintPerspectivePixel(paintX, paintY, newPixel);
                }
            },

            expandLayerDepthForPaint(...depths) {
                if (!depths.length) return;
                const layer = this.layers.find((candidate) => candidate.id === this.activeLayerId);
                const previousRange = layerDepthRanges(this.layers).get(layer.id);
                const start = Math.max(-32, Math.min(previousRange.start, ...depths));
                const end = Math.min(32, Math.max(previousRange.end, ...depths.map((depth) => depth + 1)));
                if (start === previousRange.start && end === previousRange.end) return;
                const positive = layerDepth(layer) > 0;
                layer.depth = (positive ? 1 : -1) * (end - start);
                layer.offset = positive ? 1 - end : -1 - start;
                this.normalizeLayerOffsets();
            },

            paintPerspectivePixel(x, y, newPixel) {
                if (x < 0 || x >= CANVAS_SIZE || y < 0 || y >= CANVAS_SIZE) return;
                const opposite = { front: ["back", 63 - x, y], back: ["front", 63 - x, y], right: ["left", 63 - x, y], left: ["right", 63 - x, y], top: ["bottom", x, 63 - y], bottom: ["top", x, 63 - y] }[this.activeOrientation];
                const fill = (orientation, fillX, fillY, behind = false) => {
                    const context = this.canvasFor(this.activeLayerId, orientation).getContext("2d");
                    context.save();
                    if (behind) context.globalCompositeOperation = "destination-over";
                    context.fillStyle = this.color;
                    context.fillRect(fillX + LAYER_PADDING, fillY + LAYER_PADDING, 1, 1);
                    context.restore();
                    const key = this.layerViewKey(this.activeLayerId, orientation);
                    if (this.appliedPaletteId === "default") deletePaletteSource(key);
                    else paletteSourceEdits.add(key);
                };
                fill(this.activeOrientation, x, y);
                if (!newPixel) return;
                fill(...opposite, true);
                if (opposite[0] !== "front" && opposite[0] !== "back") editedViews.add(this.layerViewKey(this.activeLayerId, opposite[0]));
                const front = this.canvasFor(this.activeLayerId, "front").getContext("2d").getImageData(LAYER_PADDING, LAYER_PADDING, CANVAS_SIZE, CANVAS_SIZE).data;
                const back = this.canvasFor(this.activeLayerId, "back").getContext("2d").getImageData(LAYER_PADDING, LAYER_PADDING, CANVAS_SIZE, CANVAS_SIZE).data;
                const footprint = (frontX, frontY) => front[(frontY * CANVAS_SIZE + frontX) * 4 + 3] || back[(frontY * CANVAS_SIZE + 63 - frontX) * 4 + 3];
                if (this.activeOrientation === "right" || this.activeOrientation === "left") {
                    const z = this.activeOrientation === "right" ? 31 - x : x - 32;
                    let start = CANVAS_SIZE;
                    let end = -1;
                    for (let frontX = 0; frontX < CANVAS_SIZE; frontX++) if (footprint(frontX, y)) { start = Math.min(start, frontX); end = frontX; }
                    if (end < 0) for (let frontY = 0; frontY < CANVAS_SIZE; frontY++) for (let frontX = 0; frontX < CANVAS_SIZE; frontX++) if (footprint(frontX, frontY)) { start = Math.min(start, frontX); end = Math.max(end, frontX); }
                    if (end < 0) start = end = CANVAS_SIZE / 2;
                    for (let frontX = start; frontX <= end; frontX++) {
                        fill("front", frontX, y, true);
                        fill("back", 63 - frontX, y, true);
                        fill("top", frontX, 32 + z, true);
                        fill("bottom", frontX, 31 - z, true);
                    }
                    return;
                }
                if (this.activeOrientation === "top" || this.activeOrientation === "bottom") {
                    const z = this.activeOrientation === "top" ? y - 32 : 31 - y;
                    let start = CANVAS_SIZE;
                    let end = -1;
                    for (let frontY = 0; frontY < CANVAS_SIZE; frontY++) if (footprint(x, frontY)) { start = Math.min(start, frontY); end = frontY; }
                    if (end < 0) for (let frontY = 0; frontY < CANVAS_SIZE; frontY++) for (let frontX = 0; frontX < CANVAS_SIZE; frontX++) if (footprint(frontX, frontY)) { start = Math.min(start, frontY); end = Math.max(end, frontY); }
                    if (end < 0) start = end = CANVAS_SIZE / 2;
                    for (let frontY = start; frontY <= end; frontY++) {
                        fill("front", x, frontY, true);
                        fill("back", 63 - x, frontY, true);
                        fill("right", 31 - z, frontY, true);
                        fill("left", 32 + z, frontY, true);
                    }
                    return;
                }
                const frontX = this.activeOrientation === "front" ? x : 63 - x;
                const range = layerDepthRanges(this.layers).get(this.activeLayerId);
                for (let z = range.start; z < range.end; z++) {
                    fill("right", 31 - z, y, true);
                    fill("left", 32 + z, y, true);
                    fill("top", frontX, 32 + z, true);
                    fill("bottom", frontX, 31 - z, true);
                }
            },

            drawLine(from, to) {
                let x = from.x;
                let y = from.y;
                const dx = Math.abs(to.x - x);
                const dy = Math.abs(to.y - y);
                const sx = x < to.x ? 1 : -1;
                const sy = y < to.y ? 1 : -1;
                let error = dx - dy;
                while (true) {
                    this.paint(x, y);
                    if (x === to.x && y === to.y) break;
                    const doubled = error * 2;
                    if (doubled > -dy) {
                        error -= dy;
                        x += sx;
                    }
                    if (doubled < dx) {
                        error += dx;
                        y += sy;
                    }
                }
            },

            startStroke(event) {
                if (this.activeLayerLocked() || this.drawing || (this.tool === "eraser" && !this.canvasFor())) return;
                event.preventDefault();
                const startPoint = this.pointFromEvent(event);
                this.pushHistory();
                const activeLayer = this.ensureActiveLayer();
                if (this.tool === "pencil") this.allowPaletteColor();
                activeLayer.visible = true;
                this.drawing = true;
                this.pointerId = event.pointerId;
                this.capturePointer(event);
                this.lastPoint = startPoint;
                straightStroke = event.shiftKey && (this.tool === "pencil" || this.tool === "eraser") ? {
                    start: this.lastPoint,
                    pixels: this.activeContext().getImageData(0, 0, LAYER_SIZE, LAYER_SIZE),
                    views: Object.fromEntries(ORIENTATIONS.map((orientation) => [orientation.id, this.canvasFor(this.activeLayerId, orientation.id).getContext("2d").getImageData(0, 0, LAYER_SIZE, LAYER_SIZE)])),
                    overrides: copyVoxelOverrides(this.activeLayerId),
                    depth: layerDepth(activeLayer),
                    offset: layerOffset(activeLayer),
                    axis: null,
                } : null;
                this.paint(this.lastPoint.x, this.lastPoint.y);
                this.render();
            },

            continueStroke(event) {
                if (!this.drawing || event.pointerId !== this.pointerId) return;
                const point = this.pointFromEvent(event);
                if (!straightStroke && event.shiftKey && (this.tool === "pencil" || this.tool === "eraser")) straightStroke = {
                    start: this.lastPoint,
                    pixels: this.activeContext().getImageData(0, 0, LAYER_SIZE, LAYER_SIZE),
                    views: Object.fromEntries(ORIENTATIONS.map((orientation) => [orientation.id, this.canvasFor(this.activeLayerId, orientation.id).getContext("2d").getImageData(0, 0, LAYER_SIZE, LAYER_SIZE)])),
                    overrides: copyVoxelOverrides(this.activeLayerId),
                    depth: layerDepth(this.layers.find((layer) => layer.id === this.activeLayerId)),
                    offset: layerOffset(this.layers.find((layer) => layer.id === this.activeLayerId)),
                    axis: null,
                };
                if (straightStroke && event.shiftKey) {
                    const dx = Math.abs(point.x - straightStroke.start.x);
                    const dy = Math.abs(point.y - straightStroke.start.y);
                    if (!straightStroke.axis && (dx || dy)) straightStroke.axis = dx >= dy ? "x" : "y";
                    const lockedPoint = straightStroke.axis === "y"
                        ? { x: straightStroke.start.x, y: point.y }
                        : { x: point.x, y: straightStroke.start.y };
                    for (const orientation of ORIENTATIONS) this.canvasFor(this.activeLayerId, orientation.id).getContext("2d").putImageData(straightStroke.views[orientation.id], 0, 0);
                    setVoxelOverrides(this.activeLayerId, new Map(straightStroke.overrides));
                    const layer = this.layers.find((candidate) => candidate.id === this.activeLayerId);
                    layer.depth = straightStroke.depth;
                    layer.offset = straightStroke.offset;
                    this.drawLine(straightStroke.start, lockedPoint);
                    this.lastPoint = lockedPoint;
                    this.queueRender();
                    return;
                }
                straightStroke = null;
                this.drawLine(this.lastPoint, point);
                this.lastPoint = point;
                this.queueRender();
            },

            endStroke(event) {
                if (event.pointerId !== this.pointerId) return;
                if (this.tool === "eraser" && this.compactLayerDepth()) this.render();
                this.drawing = false;
                this.pointerId = null;
                this.lastPoint = null;
                straightStroke = null;
            },

            snapshot() {
                return Alpine.raw({
                    layers: this.layers.map(({ id, name, visible, locked, depth, offset, groupId }) => ({ id, name, visible, locked, depth, offset, groupId })),
                    groups: this.groups.map((group) => ({ ...group })),
                    activeLayerId: this.activeLayerId,
                    activeGroupId: this.activeGroupId,
                    selectedLayerIds: [...this.selectedLayerIds],
                    layerSelectionAnchorId: this.layerSelectionAnchorId,
                    editedViews: [...editedViews],
                    quantizedPalettes: [...quantizedPalettes].map(([key, value]) => ({ key, palette: [...value.palette], confirmed: !!value.confirmed, locked: !!value.locked })),
                    paletteOrders: [...paletteOrders].map(([key, palette]) => ({ key, palette: [...palette] })),
                    voxelColorOverrides: [...voxelColorOverrides].map(([layerId, overrides]) => ({ layerId, entries: [...overrides] })),
                    selectionMask: selectionMask ? new Uint8Array(selectionMask) : null,
                    selectionViewKey,
                    perspectiveSelectionMasks: perspectiveSelectionMasks ? Object.fromEntries(ORIENTATIONS.map((orientation) => [orientation.id, new Uint8Array(perspectiveSelectionMasks[orientation.id])])) : null,
                    pixels: ORIENTATIONS.flatMap((orientation) => this.layers.map(({ id }) => ({
                        key: viewKey(orientation.id, id),
                        data: this.canvasFor(id, orientation.id).getContext("2d").getImageData(0, 0, LAYER_SIZE, LAYER_SIZE),
                    }))),
                });
            },

            restore(snapshot) {
                snapshot = Alpine.raw(snapshot);
                canvases.clear();
                paletteSources.clear();
                paletteSourcePalettes.clear();
                paletteSourceEdits.clear();
                quantizedPalettes.clear();
                paletteOrders.clear();
                for (const pixels of snapshot.pixels) {
                    const canvas = createLayerCanvas();
                    canvas.getContext("2d").putImageData(pixels.data, 0, 0);
                    canvases.set(pixels.key, canvas);
                }
                this.layers = snapshot.layers.map((layer) => ({ ...layer, depth: layerDepth(layer), offset: layerOffset(layer) }));
                for (const entry of snapshot.quantizedPalettes ?? []) if (canvases.has(entry.key) && Array.isArray(entry.palette) && entry.palette.length) {
                    const palette = [...entry.palette];
                    quantizedPalettes.set(entry.key, { palette, colors: palette.map(hexColor), allowed: new Set(palette), confirmed: !!entry.confirmed, locked: !!entry.locked });
                }
                for (const entry of snapshot.paletteOrders ?? []) if (canvases.has(entry.key) && Array.isArray(entry.palette)) paletteOrders.set(entry.key, [...entry.palette]);
                voxelColorOverrides.clear();
                const layerIds = new Set(this.layers.map((layer) => layer.id));
                for (const entry of Array.isArray(snapshot.voxelColorOverrides) ? snapshot.voxelColorOverrides : []) {
                    if (!entry || !layerIds.has(entry.layerId) || !Array.isArray(entry.entries)) continue;
                    const overrides = new Map(entry.entries.filter((item) => Array.isArray(item) && validVoxelKey(item[0]) && validVoxelColor(item[1])));
                    if (overrides.size) voxelColorOverrides.set(entry.layerId, overrides);
                }
                this.groups = (snapshot.groups ?? []).map((group) => ({ ...group }));
                this.normalizeLayerOffsets();
                this.activeLayerId = snapshot.activeLayerId;
                this.activeGroupId = this.groups.some((group) => group.id === snapshot.activeGroupId) ? snapshot.activeGroupId : null;
                this.selectedLayerIds = (snapshot.selectedLayerIds ?? [this.activeLayerId]).filter((id) => layerIds.has(id));
                this.layerSelectionAnchorId = layerIds.has(snapshot.layerSelectionAnchorId) ? snapshot.layerSelectionAnchorId : this.activeLayerId;
                editedViews.clear();
                for (const key of snapshot.editedViews ?? []) editedViews.add(key);
                if (snapshot.selectionMask && snapshot.selectionViewKey === this.layerViewKey()) {
                    perspectiveSelectionMasks = snapshot.perspectiveSelectionMasks
                        ? Object.fromEntries(ORIENTATIONS.map((orientation) => [orientation.id, new Uint8Array(snapshot.perspectiveSelectionMasks[orientation.id])]))
                        : this.projectVoxelMask(snapshot.selectionMask);
                    this.setSelectionMask(new Uint8Array(snapshot.selectionMask), false);
                }
                else this.clearSelection();
                selectionAnchor = null;
                moveState = null;
                quantizationSource = null;
                this.quantizationPending = false;
                this.pointerId = null;
                this.render();
                this.refreshUI();
            },

            pushHistory(commitQuantization = true) {
                if (commitQuantization) this.confirmQuantization();
                this.history.push(this.snapshot());
                if (this.history.length > 30) this.history.shift();
                this.future = [];
            },

            undo() {
                if (!this.history.length) return;
                this.future.push(this.snapshot());
                this.restore(this.history.pop());
            },

            redo() {
                if (!this.future.length) return;
                this.history.push(this.snapshot());
                this.restore(this.future.pop());
            },

            async saveProject() {
                this.confirmQuantization();
                this.syncPaletteSourceEdits();
                this.syncDerivedOrientations();
                const textureImages = ORIENTATIONS.flatMap((orientation) => this.layers.map(({ id }) => ({
                    key: viewKey(orientation.id, id),
                    image: this.canvasFor(id, orientation.id).getContext("2d", CANVAS_CONTEXT_OPTIONS).getImageData(0, 0, LAYER_SIZE, LAYER_SIZE),
                })));
                const sourceImages = [...paletteSources].map(([key, image]) => ({ key, image }));
                const project = {
                    format: "grindland-model",
                    version: 2,
                    layers: this.layers.map(({ id, name, visible, locked, depth, offset, groupId }) => ({ id, name, visible, locked, depth, offset, groupId })),
                    groups: this.groups.map((group) => ({ ...group })),
                    assets: [],
                    textures: [],
                    paletteSources: [],
                    paletteSourcePalettes: [...paletteSourcePalettes].map(([key, value]) => ({ key, palette: [...value.palette], confirmed: !!value.confirmed })),
                    quantizedPalettes: [...quantizedPalettes].map(([key, value]) => ({ key, palette: [...value.palette], confirmed: !!value.confirmed || key.startsWith("front:"), locked: !!value.locked })),
                    paletteOrders: [...paletteOrders].map(([key, palette]) => ({ key, palette: [...palette] })),
                    importedPalettes: this.importedPalettes.map((entry) => ({ ...entry, colors: [...entry.colors] })),
                    editedViews: [...editedViews],
                    voxelColorOverrides: [...voxelColorOverrides].map(([layerId, overrides]) => ({ layerId, entries: [...overrides] })),
                    activeLayerId: this.activeLayerId,
                    activeGroupId: this.activeGroupId,
                    selectedLayerIds: [...this.selectedLayerIds],
                    layerSelectionAnchorId: this.layerSelectionAnchorId,
                    activeOrientation: "front",
                    activePaletteId: this.activePaletteId,
                    appliedPaletteId: this.appliedPaletteId,
                    color: this.color,
                    pencilSize: this.pencilSize,
                    eraserSize: this.eraserSize,
                    gridVisible: this.gridVisible,
                    verticalSymmetry: this.verticalSymmetry,
                    horizontalSymmetry: this.horizontalSymmetry,
                    counters: { layer: nextLayerId, group: nextGroupId, palette: nextPaletteId },
                };
                const assets = new Map();
                const addAsset = async (image) => {
                    const fingerprint = encodeImageData(image);
                    if (assets.has(fingerprint)) return assets.get(fingerprint);
                    const id = project.assets.length.toString(36);
                    project.assets.push({ id, data: await encodeLosslessTexture(image) });
                    assets.set(fingerprint, id);
                    return id;
                };
                for (const { key, image } of textureImages) project.textures.push({ key, asset: await addAsset(image) });
                for (const { key, image } of sourceImages) project.paletteSources.push({ key, asset: await addAsset(image) });
                const url = URL.createObjectURL(new Blob([JSON.stringify(project)], { type: "application/json" }));
                const link = document.createElement("a");
                const name = this.projectName.trim() || "New File";
                link.download = /\.grindland$/i.test(name) ? name : `${name}.grindland`;
                link.href = url;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 0);
            },

            async loadProject(file) {
                if (!file) return;
                try {
                    const project = JSON.parse(await file.text());
                    if (project.format !== "grindland-model" || ![1, 2].includes(project.version) || !Array.isArray(project.layers) || !Array.isArray(project.textures)) return;
                    this.projectName = file.name.replace(/\.grindland$/i, "") || "New File";
                    const layerIds = new Set(project.layers.map((layer) => layer.id));
                    const assets = project.version === 2
                        ? new Map(await Promise.all((project.assets ?? []).map(async (entry) => [entry.id, await decodeTexture(entry.data)])))
                        : null;
                    const savedImage = (entry) => project.version === 2 ? assets.get(entry.asset) : decodeImageData(entry.data);
                    const textures = new Map(project.textures.map((entry) => [entry.key, savedImage(entry)]));
                    canvases.clear();
                    paletteSources.clear();
                    paletteSourcePalettes.clear();
                    paletteSourceEdits.clear();
                    quantizedPalettes.clear();
                    paletteOrders.clear();
                    editedViews.clear();
                    for (const layer of project.layers) for (const orientation of ORIENTATIONS) {
                        const key = viewKey(orientation.id, layer.id);
                        const canvas = createLayerCanvas();
                        const image = textures.get(key);
                        if (image) canvas.getContext("2d", CANVAS_CONTEXT_OPTIONS).putImageData(image, 0, 0);
                        canvases.set(key, canvas);
                    }
                    this.layers = project.layers.map((layer) => ({ ...layer, locked: !!layer.locked, depth: layerDepth(layer), offset: layerOffset(layer), groupId: layer.groupId ?? null }));
                    voxelColorOverrides.clear();
                    for (const entry of Array.isArray(project.voxelColorOverrides) ? project.voxelColorOverrides : []) {
                        if (!entry || !layerIds.has(entry.layerId) || !Array.isArray(entry.entries)) continue;
                        const overrides = new Map(entry.entries.filter((item) => Array.isArray(item) && validVoxelKey(item[0]) && validVoxelColor(item[1])));
                        if (overrides.size) voxelColorOverrides.set(entry.layerId, overrides);
                    }
                    this.groups = Array.isArray(project.groups) ? project.groups.map((group) => ({ ...group })) : [];
                    for (const entry of project.paletteSources ?? []) if (canvases.has(entry.key)) paletteSources.set(entry.key, savedImage(entry));
                    for (const entry of project.quantizedPalettes ?? []) if (canvases.has(entry.key) && Array.isArray(entry.palette) && entry.palette.length) {
                        const palette = [...entry.palette];
                        quantizedPalettes.set(entry.key, { palette, colors: palette.map(hexColor), allowed: new Set(palette), confirmed: !!entry.confirmed || entry.key.startsWith("front:"), locked: false });
                    }
                    for (const entry of project.paletteSourcePalettes ?? []) if (canvases.has(entry.key) && Array.isArray(entry.palette) && entry.palette.length) {
                        paletteSourcePalettes.set(entry.key, { palette: [...entry.palette], confirmed: !!entry.confirmed, locked: false });
                    }
                    for (const entry of project.paletteOrders ?? []) if (canvases.has(entry.key) && Array.isArray(entry.palette)) paletteOrders.set(entry.key, [...entry.palette]);
                    for (const key of project.editedViews ?? []) if (canvases.has(key)) editedViews.add(key);
                    this.importedPalettes = Array.isArray(project.importedPalettes) ? project.importedPalettes.map((entry) => ({ ...entry, colors: [...entry.colors] })) : [];
                    this.activeLayerId = layerIds.has(project.activeLayerId) ? project.activeLayerId : this.layers[0]?.id ?? null;
                    this.activeGroupId = this.groups.some((group) => group.id === project.activeGroupId) ? project.activeGroupId : null;
                    this.selectedLayerIds = (project.selectedLayerIds ?? [this.activeLayerId]).filter((id) => layerIds.has(id));
                    this.layerSelectionAnchorId = layerIds.has(project.layerSelectionAnchorId) ? project.layerSelectionAnchorId : this.activeLayerId;
                    this.activeOrientation = "front";
                    const orientation = this.orientationRotation();
                    if (voxelViewRoot) voxelViewRoot.rotation.set(-orientation.x, -orientation.y, 0);
                    this.activePaletteId = project.activePaletteId === "default" || this.importedPalettes.some((entry) => entry.id === project.activePaletteId) ? project.activePaletteId : "default";
                    this.appliedPaletteId = "default";
                    this.color = /^#[0-9a-f]{6}$/i.test(project.color) ? project.color : "#000000";
                    this.pencilSize = Math.max(1, Math.min(16, Number(project.pencilSize) || 1));
                    this.eraserSize = Math.max(1, Math.min(16, Number(project.eraserSize) || 1));
                    this.gridVisible = !!project.gridVisible;
                    this.verticalSymmetry = !!project.verticalSymmetry;
                    this.horizontalSymmetry = !!project.horizontalSymmetry;
                    nextLayerId = Math.max(Number(project.counters?.layer) || 0, ...this.layers.map((layer) => Number(layer.id.match(/\d+$/)?.[0]) || 0));
                    nextGroupId = Math.max(Number(project.counters?.group) || 0, ...this.groups.map((group) => Number(group.id.match(/\d+$/)?.[0]) || 0));
                    nextPaletteId = Math.max(Number(project.counters?.palette) || 0, ...this.importedPalettes.map((entry) => Number(entry.id.match(/\d+$/)?.[0]) || 0));
                    this.clearSelection();
                    this.history = [];
                    this.future = [];
                    selectionAnchor = null;
                    moveState = null;
                    quantizationSource = null;
                    this.quantizationPending = false;
                    this.drawing = false;
                    this.sampling = false;
                    this.pointerId = null;
                    this.normalizeLayerOffsets();
                    this.render();
                    this.refreshUI();
                } catch (error) {
                    console.error(error);
                }
            },

            clearCanvas() {
                if (this.activeLayerLocked() || !this.canvasFor()) return;
                this.pushHistory();
                const mask = selectionMask ?? rectangleMask(0, 0, CANVAS_SIZE, CANVAS_SIZE);
                this.clearProjectedPixels(this.projectVoxelMask(mask), false);
                this.render();
            },

            clearProjectedPixels(masks, compact = true) {
                if (this.activeLayerLocked()) return;
                const layer = this.layers.find((candidate) => candidate.id === this.activeLayerId);
                const retained = Object.fromEntries(ORIENTATIONS.map((orientation) => [orientation.id, new Uint8Array(LAYER_SIZE * LAYER_SIZE)]));
                if (layer) {
                    const views = Object.fromEntries(ORIENTATIONS.map((orientation) => [orientation.id, this.canvasFor(layer.id, orientation.id).getContext("2d").getImageData(LAYER_PADDING, LAYER_PADDING, CANVAS_SIZE, CANVAS_SIZE).data]));
                    const range = layerDepthRanges(this.layers).get(layer.id);
                    for (let z = range.start; z < range.end; z++) for (let y = 0; y < CANVAS_SIZE; y++) for (let x = 0; x < CANVAS_SIZE; x++) {
                        const projections = { front: [x, y], back: [63 - x, y], right: [31 - z, y], left: [32 + z, y], top: [x, 32 + z], bottom: [x, 31 - z] };
                        const occupied = voxelOccupied(views, x, y, z);
                        const selected = voxelSelected(masks, x, y, z);
                        if (!occupied || selected) continue;
                        for (const orientation of ORIENTATIONS) {
                            const [viewX, viewY] = projections[orientation.id];
                            retained[orientation.id][maskIndex(viewX, viewY)] = 1;
                        }
                    }
                }
                for (const orientation of ORIENTATIONS) {
                    const key = this.layerViewKey(this.activeLayerId, orientation.id);
                    const deletionMask = new Uint8Array(masks[orientation.id]);
                    for (let index = 0; index < deletionMask.length; index++) if (retained[orientation.id][index]) deletionMask[index] = 0;
                    clearMaskedPixels(this.canvasFor(this.activeLayerId, orientation.id).getContext("2d"), deletionMask);
                    if (orientation.id !== "front" && maskBounds(deletionMask)) editedViews.add(key);
                    if (this.appliedPaletteId === "default") deletePaletteSource(key);
                    else paletteSourceEdits.add(key);
                }
                if (compact) this.compactLayerDepth();
            },

            compactLayerDepth(id = this.activeLayerId, includeOutside = false) {
                const layer = this.layers.find((candidate) => candidate.id === id);
                if (!layer || layer.locked) return false;
                const currentRange = layerDepthRanges(this.layers).get(id);
                const range = includeOutside ? { start: -CANVAS_SIZE / 2, end: CANVAS_SIZE / 2 } : currentRange;
                const views = Object.fromEntries(ORIENTATIONS.map((orientation) => [orientation.id, this.canvasFor(id, orientation.id).getContext("2d").getImageData(LAYER_PADDING, LAYER_PADDING, CANVAS_SIZE, CANVAS_SIZE).data]));
                const occupied = (x, y, z) => voxelOccupied(views, x, y, z);
                let start = null;
                let end = null;
                for (let z = range.start; z < range.end; z++) {
                    let sliceOccupied = false;
                    for (let y = 0; y < CANVAS_SIZE && !sliceOccupied; y++) for (let x = 0; x < CANVAS_SIZE; x++) if (occupied(x, y, z)) {
                        sliceOccupied = true;
                        break;
                    }
                    if (!sliceOccupied) continue;
                    start ??= z;
                    end = z + 1;
                }
                if (start === null || start === currentRange.start && end === currentRange.end) return false;
                const positive = layerDepth(layer) > 0;
                layer.depth = (positive ? 1 : -1) * (end - start);
                layer.offset = positive ? 1 - end : -1 - start;
                this.normalizeLayerOffsets();
                return true;
            },

            relativeTranslation(orientation, dx, dy) {
                const [worldX, worldY, worldZ] = this.activeOrientation === "front" ? [dx, dy, 0]
                    : this.activeOrientation === "back" ? [-dx, dy, 0]
                        : this.activeOrientation === "right" ? [0, dy, -dx]
                            : this.activeOrientation === "left" ? [0, dy, dx]
                                : this.activeOrientation === "top" ? [dx, 0, dy]
                                    : [dx, 0, -dy];
                if (orientation === "front") return [worldX, worldY];
                if (orientation === "back") return [-worldX, worldY];
                if (orientation === "right") return [-worldZ, worldY];
                if (orientation === "left") return [worldZ, worldY];
                if (orientation === "top") return [worldX, worldZ];
                return [worldX, -worldZ];
            },

            translateSelectionViews(mask, dx, dy) {
                const masks = perspectiveSelectionMasks ?? this.projectVoxelMask(mask);
                const views = ORIENTATIONS.map((orientation) => ({
                    orientation: orientation.id,
                    pixels: maskedLayerPixels(this.canvasFor(this.activeLayerId, orientation.id), masks[orientation.id]),
                }));
                this.clearProjectedPixels(masks, false);
                const translated = {};
                for (const view of views) {
                    const [moveX, moveY] = this.relativeTranslation(view.orientation, dx, dy);
                    this.canvasFor(this.activeLayerId, view.orientation).getContext("2d").drawImage(view.pixels, moveX, moveY);
                    translated[view.orientation] = translateMask(masks[view.orientation], moveX, moveY);
                }
                return translated;
            },

            translateSelection(dx, dy) {
                if (this.activeLayerLocked() || !this.selection || !this.canvasFor()) return;
                const selection = { ...this.selection };
                dx = Math.max(-LAYER_PADDING - selection.x, Math.min(CANVAS_SIZE + LAYER_PADDING - selection.x - selection.width, dx));
                dy = Math.max(-LAYER_PADDING - selection.y, Math.min(CANVAS_SIZE + LAYER_PADDING - selection.y - selection.height, dy));
                if (!dx && !dy) return;
                this.pushHistory();
                this.markViewEdited();
                const mask = new Uint8Array(selectionMask);
                perspectiveSelectionMasks = this.translateSelectionViews(mask, dx, dy);
                this.setSelectionMask(new Uint8Array(perspectiveSelectionMasks[this.activeOrientation]), false);
                this.compactLayerDepth(this.activeLayerId, true);
                this.render();
            },

            copySelection(cut = false) {
                if ((cut && this.activeLayerLocked()) || !selectionMask || !this.selection || !this.canvasFor()) return;
                const layer = this.layers.find((candidate) => candidate.id === this.activeLayerId);
                const mask = new Uint8Array(selectionMask);
                const bounds = { ...this.selection };
                const pixels = selectionPixels(this.canvasFor(), mask, bounds);
                const selectionMasks = perspectiveSelectionMasks ?? this.projectVoxelMask(mask);
                internalClipboard = {
                    pixels,
                    mask,
                    bounds,
                    depth: layerDepth(layer),
                    offset: layerOffset(layer),
                    selectionMasks: Object.fromEntries(ORIENTATIONS.map((orientation) => [orientation.id, new Uint8Array(selectionMasks[orientation.id])])),
                    views: Object.fromEntries(ORIENTATIONS.map((orientation) => [orientation.id, maskedLayerPixels(this.canvasFor(layer.id, orientation.id), selectionMasks[orientation.id])])),
                    palettes: Object.fromEntries(ORIENTATIONS.map((orientation) => [orientation.id, quantizedPalettes.get(this.layerViewKey(layer.id, orientation.id))])),
                };
                if (navigator.clipboard?.write && window.ClipboardItem) {
                    pixels.toBlob((blob) => {
                        if (blob) navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).catch(() => {});
                    }, "image/png");
                }
                if (!cut) return;
                this.pushHistory();
                this.clearProjectedPixels(selectionMasks);
                this.render();
            },

            voxelProjectionMasks(sourceMasks, id = this.activeLayerId) {
                const masks = Object.fromEntries(ORIENTATIONS.map((orientation) => [orientation.id, new Uint8Array(LAYER_SIZE * LAYER_SIZE)]));
                const range = layerDepthRanges(this.layers).get(id);
                const views = Object.fromEntries(ORIENTATIONS.map((orientation) => [orientation.id, this.canvasFor(id, orientation.id).getContext("2d").getImageData(LAYER_PADDING, LAYER_PADDING, CANVAS_SIZE, CANVAS_SIZE).data]));
                const occupied = (x, y, z) => voxelOccupied(views, x, y, z);
                const selected = (x, y, z) => sourceMasks.front[maskIndex(x, y)]
                    || sourceMasks.back[maskIndex(63 - x, y)]
                    || sourceMasks.right[maskIndex(31 - z, y)]
                    || sourceMasks.left[maskIndex(32 + z, y)]
                    || sourceMasks.top[maskIndex(x, 32 + z)]
                    || sourceMasks.bottom[maskIndex(x, 31 - z)];
                for (let z = range.start; z < range.end; z++) for (let y = 0; y < CANVAS_SIZE; y++) for (let x = 0; x < CANVAS_SIZE; x++) {
                    if (!occupied(x, y, z) || !selected(x, y, z)) continue;
                    masks.front[maskIndex(x, y)] = 1;
                    masks.back[maskIndex(63 - x, y)] = 1;
                    masks.right[maskIndex(31 - z, y)] = 1;
                    masks.left[maskIndex(32 + z, y)] = 1;
                    masks.top[maskIndex(x, 32 + z)] = 1;
                    masks.bottom[maskIndex(x, 31 - z)] = 1;
                }
                return masks;
            },

            projectVoxelMask(mask, sourceOrientation = this.activeOrientation) {
                const masks = Object.fromEntries(ORIENTATIONS.map((orientation) => [orientation.id, new Uint8Array(LAYER_SIZE * LAYER_SIZE)]));
                masks[sourceOrientation] = new Uint8Array(mask);
                const linked = this.voxelProjectionMasks(masks);
                linked[sourceOrientation] = new Uint8Array(mask);
                return linked;
            },

            pasteSelection() {
                if (!internalClipboard) return;
                this.pushHistory();
                const layer = this.addLayer("Pasted Selection", false);
                layer.depth = internalClipboard.depth;
                layer.offset = internalClipboard.offset;
                this.normalizeLayerOffsets();
                for (const orientation of ORIENTATIONS) {
                    const view = internalClipboard.views?.[orientation.id];
                    if (view) this.canvasFor(layer.id, orientation.id).getContext("2d").drawImage(view, 0, 0);
                    else if (orientation.id === this.activeOrientation) this.canvasFor(layer.id, orientation.id).getContext("2d").drawImage(internalClipboard.pixels, internalClipboard.bounds.x, internalClipboard.bounds.y);
                    if (orientation.id !== "front" && view) editedViews.add(this.layerViewKey(layer.id, orientation.id));
                    const sourcePalette = internalClipboard.palettes?.[orientation.id];
                    if (!sourcePalette) continue;
                    const palette = [...sourcePalette.palette];
                    quantizedPalettes.set(this.layerViewKey(layer.id, orientation.id), { palette, colors: palette.map(hexColor), allowed: new Set(palette), confirmed: sourcePalette.confirmed, locked: sourcePalette.locked });
                }
                perspectiveSelectionMasks = internalClipboard.selectionMasks
                    ? Object.fromEntries(ORIENTATIONS.map((orientation) => [orientation.id, new Uint8Array(internalClipboard.selectionMasks[orientation.id])]))
                    : null;
                this.setSelectionMask(new Uint8Array(perspectiveSelectionMasks?.[this.activeOrientation] ?? internalClipboard.mask), false);
                this.compactLayerDepth(layer.id);
                this.render();
            },

            handleKeydown(event) {
                if (event.isComposing) return;
                if (event.key === "Enter" && event.target.matches?.("input:not([type]), input[type='text'], input[type='number']")) {
                    event.preventDefault();
                    event.target.blur();
                    return;
                }
                const command = event.ctrlKey || event.metaKey;
                const key = event.key.toLowerCase();
                if (command && key === "v") pasteAuthorizedUntil = performance.now() + 1000;
                if (command && ["a", "c", "d", "v", "x"].includes(key) && event.target.closest?.(".layer-name")) return;
                const run = (action) => {
                    event.preventDefault();
                    this.blurActiveControl();
                    action();
                };
                if (command && key === "z") {
                    run(() => event.shiftKey ? this.redo() : this.undo());
                    return;
                }
                if (command && key === "y") {
                    run(() => this.redo());
                    return;
                }
                if (command && (key === "c" || key === "x")) {
                    run(() => this.copySelection(key === "x"));
                    return;
                }
                if (command && key === "v" && internalClipboard) {
                    pasteAuthorizedUntil = 0;
                    run(() => this.pasteSelection());
                    return;
                }
                if (command && key === "a") {
                    run(() => this.setSelectionMask(rectangleMask(0, 0, CANVAS_SIZE, CANVAS_SIZE)));
                    return;
                }
                if (command && key === "d") {
                    run(() => this.duplicateLayer());
                    return;
                }
                if (!command && !event.altKey && event.target.closest?.("input, textarea, select, [contenteditable]")) return;
                if (event.key === "Escape") {
                    run(() => this.clearSelection());
                    return;
                }
                if (event.key === "Delete") {
                    run(() => this.clearCanvas());
                    return;
                }
                const directions = {
                    ArrowLeft: [-1, 0],
                    ArrowRight: [1, 0],
                    ArrowUp: [0, -1],
                    ArrowDown: [0, 1],
                };
                if (this.selection && directions[event.key]) {
                    const distance = event.shiftKey ? 8 : 1;
                    run(() => this.translateSelection(directions[event.key][0] * distance, directions[event.key][1] * distance));
                    return;
                }
                if (command || event.altKey) return;
                const tools = { b: "pencil", g: "bucket", i: "eyedropper", t: "selection", m: "move", w: "wand", e: "eraser" };
                const tool = tools[key];
                if (tool) run(() => { this.tool = tool; });
            },

            async importFiles(fileList, pasted = false) {
                const files = [...fileList].filter((file) => file.type.startsWith("image/"));
                if (!files.length) return;
                this.pushHistory();
                for (const [index, file] of files.entries()) {
                    try {
                        const image = await decodeImage(file);
                        const fallback = pasted ? `Pasted Image ${index + 1}` : `Imported Image ${index + 1}`;
                        const name = pasted ? fallback : file.name.replace(/\.[^.]+$/, "") || fallback;
                        const layer = this.addLayer(name, false);
                        this.markViewEdited(layer.id);
                        const context = this.canvasFor(layer.id).getContext("2d");
                        const scale = Math.min(1, CANVAS_SIZE / image.width, CANVAS_SIZE / image.height);
                        const width = Math.max(1, Math.round(image.width * scale));
                        const height = Math.max(1, Math.round(image.height * scale));
                        context.imageSmoothingEnabled = false;
                        context.drawImage(
                            image,
                            LAYER_PADDING + Math.floor((CANVAS_SIZE - width) / 2),
                            LAYER_PADDING + Math.floor((CANVAS_SIZE - height) / 2),
                            width,
                            height,
                        );
                        image.close?.();
                    } catch (error) {
                        console.error(error);
                    }
                }
                this.render();
            },

            handlePaste(event) {
                if (performance.now() >= pasteAuthorizedUntil) {
                    event.preventDefault();
                    return;
                }
                pasteAuthorizedUntil = 0;
                if (event.target.closest?.(".layer-name")) return;
                if (previewDrag?.mode === "rotate" || voxelPan) {
                    event.preventDefault();
                    return;
                }
                if (internalClipboard) {
                    event.preventDefault();
                    this.pasteSelection();
                    return;
                }
                const files = [...event.clipboardData.items]
                    .filter((item) => item.type.startsWith("image/"))
                    .map((item) => item.getAsFile())
                    .filter(Boolean);
                if (!files.length) return;
                event.preventDefault();
                this.importFiles(files, true);
            },

            handleDrop(event) {
                this.dropActive = false;
                this.importFiles(event.dataTransfer.files);
            },

            download() {
                this.render();
                const link = document.createElement("a");
                link.download = "model.png";
                link.href = this.$refs.canvas.toDataURL("image/png");
                link.click();
            },
        };
    });
});
