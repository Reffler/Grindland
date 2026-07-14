const CANVAS_SIZE = 64;
const LAYER_PADDING = 64;
const LAYER_SIZE = CANVAS_SIZE + LAYER_PADDING * 2;

const maskIndex = (x, y) => (y + LAYER_PADDING) * LAYER_SIZE + x + LAYER_PADDING;

function createLayerCanvas() {
    const canvas = document.createElement("canvas");
    canvas.width = LAYER_SIZE;
    canvas.height = LAYER_SIZE;
    canvas.getContext("2d", { willReadFrequently: true }).imageSmoothingEnabled = false;
    return canvas;
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
    const context = canvas.getContext("2d");
    const pixels = source.getContext("2d").getImageData(bounds.x + LAYER_PADDING, bounds.y + LAYER_PADDING, bounds.width, bounds.height);
    for (let y = 0; y < bounds.height; y++) for (let x = 0; x < bounds.width; x++) {
        if (mask[maskIndex(bounds.x + x, bounds.y + y)]) continue;
        const offset = (y * bounds.width + x) * 4;
        pixels.data[offset] = pixels.data[offset + 1] = pixels.data[offset + 2] = pixels.data[offset + 3] = 0;
    }
    context.putImageData(pixels, 0, 0);
    return canvas;
}

function matchesColor(pixels, offset, target, tolerance) {
    if (target[3] === 0) return pixels[offset + 3] <= tolerance;
    const red = pixels[offset] - target[0];
    const green = pixels[offset + 1] - target[1];
    const blue = pixels[offset + 2] - target[2];
    const colorDistance = Math.sqrt((red * red + green * green + blue * blue) / 3);
    return colorDistance <= tolerance && Math.abs(pixels[offset + 3] - target[3]) <= tolerance;
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

document.addEventListener("alpine:init", () => {
    Alpine.data("pixelEditor", () => {
        const canvases = new Map();
        let nextLayerId = 0;
        let selectionAnchor = null;
        let selectionMask = null;
        let moveState = null;
        let internalClipboard = null;
        let pointerTarget = null;
        let quantizationSource = null;
        let paletteHighlightTimer = null;
        let THREE = null;
        let voxelRenderer = null;
        let voxelScene = null;
        let voxelCamera = null;
        let voxelRoot = null;
        let voxelBackdrop = null;
        let voxelGeometry = null;
        let voxelMaterial = null;
        let voxelHighlightMesh = null;
        let voxelHighlightFrame = null;
        let voxelCursor = null;
        let voxelGrid = null;
        let voxelRotation = null;
        let voxelSnapFrame = null;
        let voxelResizeObserver = null;
        let voxelRaycaster = null;
        const voxelLayerMeshes = new Map();
        const quantizedPalettes = new Map();

        return {
            tool: "pencil",
            brushSize: 1,
            quantization: 64,
            quantizationMax: 64,
            quantizationPending: false,
            wandTolerance: 32,
            color: "#202426",
            palette: [],
            gridVisible: true,
            voxelReady: false,
            layers: [],
            activeLayerId: null,
            draggedLayerId: null,
            editingLayerId: null,
            layerDragChanged: false,
            dropActive: false,
            selection: null,
            selectionPath: "",
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
                this.context = this.$refs.canvas.getContext("2d", { willReadFrequently: true });
                this.context.imageSmoothingEnabled = false;
                this.$watch("tool", () => this.confirmQuantization());
                this.$watch("gridVisible", (visible) => {
                    if (voxelGrid) voxelGrid.visible = visible && !voxelRotation && !voxelSnapFrame;
                    this.renderVoxelScene();
                });
                window.addEventListener("blur", () => { internalClipboard = null; });
                this.addLayer("Layer 1", false);
                this.refreshUI();
                import("https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js")
                    .then((module) => { THREE = module; this.initVoxelScene(); })
                    .catch(console.error);
            },

            initVoxelScene() {
                const canvas = this.$refs.voxelCanvas;
                voxelRenderer = new THREE.WebGLRenderer({ canvas, antialias: true });
                voxelRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
                voxelRenderer.outputColorSpace = THREE.SRGBColorSpace;
                voxelScene = new THREE.Scene();
                voxelScene.background = new THREE.Color(0x15181a);
                voxelCamera = new THREE.PerspectiveCamera(35, 1, 0.1, 400);
                voxelCamera.position.z = 120;
                voxelRoot = new THREE.Group();
                voxelScene.add(voxelRoot);

                const checker = document.createElement("canvas");
                checker.width = checker.height = 16;
                const checkerContext = checker.getContext("2d");
                checkerContext.fillStyle = "#e6e8e8";
                checkerContext.fillRect(0, 0, 16, 16);
                checkerContext.fillStyle = "#c7cbcc";
                checkerContext.fillRect(0, 0, 8, 8);
                checkerContext.fillRect(8, 8, 8, 8);
                const checkerTexture = new THREE.CanvasTexture(checker);
                checkerTexture.wrapS = checkerTexture.wrapT = THREE.RepeatWrapping;
                checkerTexture.repeat.set(8, 8);
                checkerTexture.colorSpace = THREE.SRGBColorSpace;
                voxelBackdrop = new THREE.Mesh(
                    new THREE.PlaneGeometry(CANVAS_SIZE, CANVAS_SIZE),
                    new THREE.MeshBasicMaterial({ map: checkerTexture }),
                );
                voxelRoot.add(voxelBackdrop);

                voxelGrid = new THREE.GridHelper(CANVAS_SIZE, CANVAS_SIZE, 0x747b7f, 0x747b7f);
                voxelGrid.rotation.x = Math.PI / 2;
                voxelGrid.position.z = 0.02;
                voxelGrid.material.transparent = true;
                voxelGrid.material.opacity = 0.28;
                voxelGrid.visible = this.gridVisible;
                voxelRoot.add(voxelGrid);

                voxelGeometry = new THREE.BoxGeometry(1.001, 1.001, 1);
                voxelMaterial = new THREE.MeshBasicMaterial({ toneMapped: false });
                voxelHighlightMesh = new THREE.InstancedMesh(
                    new THREE.BoxGeometry(1.02, 1.02, 1.06),
                    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }),
                    CANVAS_SIZE * CANVAS_SIZE,
                );
                voxelHighlightMesh.count = 0;
                voxelHighlightMesh.renderOrder = 10;
                voxelRoot.add(voxelHighlightMesh);
                voxelCursor = new THREE.LineSegments(
                    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1.08)),
                    new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }),
                );
                voxelCursor.visible = false;
                voxelCursor.renderOrder = 11;
                voxelRoot.add(voxelCursor);
                voxelScene.add(new THREE.HemisphereLight(0xffffff, 0x667078, 2.2));
                const light = new THREE.DirectionalLight(0xffffff, 2.8);
                light.position.set(-35, 45, 80);
                voxelScene.add(light);
                voxelRaycaster = new THREE.Raycaster();

                const resize = () => {
                    const size = canvas.getBoundingClientRect();
                    voxelRenderer.setSize(size.width, size.height, false);
                    voxelCamera.aspect = size.width / size.height;
                    voxelCamera.updateProjectionMatrix();
                    this.renderVoxelScene();
                };
                voxelResizeObserver = new ResizeObserver(resize);
                voxelResizeObserver.observe(canvas);
                this.voxelReady = true;
                resize();
                this.renderVoxels();
            },

            renderVoxelScene() {
                if (voxelRenderer) voxelRenderer.render(voxelScene, voxelCamera);
            },

            renderVoxels() {
                if (!voxelGeometry) return;
                const matrix = new THREE.Matrix4();
                const color = new THREE.Color();
                const visibleLayers = this.layers.filter((layer) => layer.visible);
                const visibleIds = new Set(visibleLayers.map((layer) => layer.id));
                voxelGrid.position.z = visibleLayers.length + 0.01;
                for (const [index, layer] of visibleLayers.entries()) {
                    let mesh = voxelLayerMeshes.get(layer.id);
                    if (!mesh) {
                        mesh = new THREE.InstancedMesh(voxelGeometry, voxelMaterial, CANVAS_SIZE * CANVAS_SIZE);
                        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
                        voxelLayerMeshes.set(layer.id, mesh);
                        voxelRoot.add(mesh);
                    }
                    const pixels = canvases.get(layer.id).getContext("2d").getImageData(LAYER_PADDING, LAYER_PADDING, CANVAS_SIZE, CANVAS_SIZE).data;
                    const depth = visibleLayers.length - index - 0.5;
                    let count = 0;
                    for (let y = 0; y < CANVAS_SIZE; y++) for (let x = 0; x < CANVAS_SIZE; x++) {
                        const offset = (y * CANVAS_SIZE + x) * 4;
                        if (!pixels[offset + 3]) continue;
                        matrix.makeTranslation(x - 31.5, 31.5 - y, depth);
                        mesh.setMatrixAt(count, matrix);
                        color.setStyle(`rgb(${pixels[offset]}, ${pixels[offset + 1]}, ${pixels[offset + 2]})`);
                        mesh.setColorAt(count, color);
                        count++;
                    }
                    mesh.visible = true;
                    mesh.count = count;
                    mesh.instanceMatrix.needsUpdate = true;
                    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
                    mesh.computeBoundingSphere();
                }
                for (const [id, mesh] of voxelLayerMeshes) if (!visibleIds.has(id)) mesh.visible = false;
                this.renderVoxelScene();
            },

            voxelLayerDepth(id = this.activeLayerId) {
                const visibleLayers = this.layers.filter((layer) => layer.visible);
                const index = visibleLayers.findIndex((layer) => layer.id === id);
                return index < 0 ? 0.5 : visibleLayers.length - index - 0.5;
            },

            refreshUI() {
                this.$nextTick(() => {
                    this.renderThumbnails();
                    lucide.createIcons();
                });
            },

            render() {
                this.context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
                for (const layer of [...this.layers].reverse()) {
                    if (layer.visible) this.context.drawImage(
                        canvases.get(layer.id),
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
                const colorCount = this.updatePalette(this.quantizationPending ? this.quantization : 64, quantizationSource?.result);
                if (!this.quantizationPending && !quantizationSource) this.syncQuantizationLimit(colorCount);
                this.renderVoxels();
            },

            updatePalette(maxColors = 64, image = null) {
                const canvas = canvases.get(this.activeLayerId);
                if (!canvas) return 0;
                const source = image ?? canvas.getContext("2d").getImageData(LAYER_PADDING, LAYER_PADDING, CANVAS_SIZE, CANVAS_SIZE);
                const pixels = source.data;
                const cached = image ? null : quantizedPalettes.get(this.activeLayerId);
                const colors = new Map();
                const start = image ? LAYER_PADDING : 0;
                const end = start + CANVAS_SIZE;
                for (let y = start; y < end; y++) for (let x = start; x < end; x++) {
                    const offset = (y * source.width + x) * 4;
                    if (!pixels[offset + 3]) continue;
                    const color = this.palettePixelColor(pixels, offset, cached);
                    colors.set(color, (colors.get(color) ?? 0) + 1);
                }
                const palette = [...colors]
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, maxColors)
                    .map(([color]) => color);
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

            highlightPaletteColor(color) {
                const pixels = this.activeContext().getImageData(LAYER_PADDING, LAYER_PADDING, CANVAS_SIZE, CANVAS_SIZE).data;
                const cached = quantizedPalettes.get(this.activeLayerId);
                const canvas = this.$refs.paletteHighlight;
                const context = canvas.getContext("2d");
                const highlight = context.createImageData(CANVAS_SIZE, CANVAS_SIZE);
                for (let offset = 0; offset < pixels.length; offset += 4) {
                    if (!pixels[offset + 3] || this.palettePixelColor(pixels, offset, cached) !== color) continue;
                    highlight.data[offset] = highlight.data[offset + 1] = highlight.data[offset + 2] = highlight.data[offset + 3] = 255;
                }
                if (this.pulseVoxelHighlight(highlight.data)) return;
                clearTimeout(paletteHighlightTimer);
                canvas.classList.remove("pulse");
                context.putImageData(highlight, 0, 0);
                void canvas.offsetWidth;
                canvas.classList.add("pulse");
                paletteHighlightTimer = setTimeout(() => canvas.classList.remove("pulse"), 1000);
            },

            pulseVoxelHighlight(mask) {
                if (!voxelHighlightMesh) return false;
                const matrix = new THREE.Matrix4();
                const depth = this.voxelLayerDepth() + 0.03;
                let count = 0;
                for (let index = 0; index < CANVAS_SIZE * CANVAS_SIZE; index++) {
                    if (!mask[index * 4 + 3]) continue;
                    matrix.makeTranslation(index % CANVAS_SIZE - 31.5, 31.5 - Math.floor(index / CANVAS_SIZE), depth);
                    voxelHighlightMesh.setMatrixAt(count++, matrix);
                }
                voxelHighlightMesh.count = count;
                voxelHighlightMesh.instanceMatrix.needsUpdate = true;
                cancelAnimationFrame(voxelHighlightFrame);
                const started = performance.now();
                const pulse = (time) => {
                    const progress = Math.min(1, (time - started) / 1000);
                    voxelHighlightMesh.material.opacity = Math.sin(progress * Math.PI) * 0.9;
                    this.renderVoxelScene();
                    if (progress < 1) voxelHighlightFrame = requestAnimationFrame(pulse);
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
                const cached = quantizedPalettes.get(this.activeLayerId);
                if (!cached || cached.allowed.has(color)) return;
                cached.palette.push(color);
                cached.colors.push(hexColor(color));
                cached.allowed.add(color);
            },

            beginQuantization() {
                if (quantizationSource?.id === this.activeLayerId) return;
                quantizationSource = {
                    id: this.activeLayerId,
                    pixels: this.activeContext().getImageData(0, 0, LAYER_SIZE, LAYER_SIZE),
                    recorded: false,
                };
            },

            quantizeActiveLayer(value) {
                this.quantization = Math.max(1, Math.min(64, Number(value) || 1));
                if (!quantizationSource || quantizationSource.id !== this.activeLayerId) this.beginQuantization();
                if (!quantizationSource.recorded) {
                    this.pushHistory(false);
                    quantizationSource.recorded = true;
                }
                quantizationSource.result = quantizeImage(quantizationSource.pixels, this.quantization);
                this.activeContext().putImageData(quantizationSource.result, 0, 0);
                this.quantizationPending = true;
                this.render();
            },

            confirmQuantization() {
                const confirmedLimit = this.quantizationPending ? this.quantization : 64;
                const result = quantizationSource?.result;
                const layerId = quantizationSource?.id;
                quantizationSource = null;
                this.quantizationPending = false;
                this.syncQuantizationLimit(Math.min(confirmedLimit, this.updatePalette(confirmedLimit, result)));
                if (result && layerId) {
                    const palette = [...this.palette];
                    quantizedPalettes.set(layerId, { palette, colors: palette.map(hexColor), allowed: new Set(palette) });
                    this.history = [];
                    this.future = [];
                }
            },

            renderThumbnails() {
                for (const thumbnail of this.$root.querySelectorAll("[data-layer-thumbnail]")) {
                    const source = canvases.get(thumbnail.dataset.layerThumbnail);
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

            createLayer(name) {
                const id = `layer-${++nextLayerId}`;
                canvases.set(id, createLayerCanvas());
                return { id, name: name || `Layer ${nextLayerId}`, visible: true };
            },

            addLayer(name, record = true) {
                if (record) this.pushHistory();
                const layer = this.createLayer(name);
                this.layers.unshift(layer);
                this.activeLayerId = layer.id;
                this.render();
                this.refreshUI();
                return layer;
            },

            duplicateLayer() {
                const source = this.layers.find((layer) => layer.id === this.activeLayerId);
                if (!source) return;
                this.pushHistory();
                const copy = this.createLayer(`${source.name} copy`);
                copy.visible = source.visible;
                canvases.get(copy.id).getContext("2d").drawImage(canvases.get(source.id), 0, 0);
                if (quantizedPalettes.has(source.id)) {
                    const palette = [...quantizedPalettes.get(source.id).palette];
                    quantizedPalettes.set(copy.id, { palette, colors: palette.map(hexColor), allowed: new Set(palette) });
                }
                const index = this.layers.findIndex((layer) => layer.id === source.id);
                this.layers.splice(index, 0, copy);
                this.activeLayerId = copy.id;
                this.render();
                this.refreshUI();
            },

            removeLayer() {
                if (this.layers.length === 1) return;
                this.pushHistory();
                const index = this.layers.findIndex((layer) => layer.id === this.activeLayerId);
                canvases.delete(this.activeLayerId);
                this.layers.splice(index, 1);
                this.activeLayerId = this.layers[Math.min(index, this.layers.length - 1)].id;
                this.render();
            },

            toggleLayer(layer) {
                this.pushHistory();
                layer.visible = !layer.visible;
                this.render();
            },

            beginLayerDrag(id, event) {
                if (this.editingLayerId === id) {
                    event.preventDefault();
                    return;
                }
                this.draggedLayerId = id;
                this.layerDragChanged = false;
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", id);
            },

            reorderLayer(targetId, event) {
                if (!this.draggedLayerId || this.draggedLayerId === targetId) return;
                const from = this.layers.findIndex((layer) => layer.id === this.draggedLayerId);
                const target = this.layers.findIndex((layer) => layer.id === targetId);
                const bounds = event.currentTarget.getBoundingClientRect();
                let to = target + (event.clientY > bounds.top + bounds.height * 0.5 ? 1 : 0);
                if (from < to) to--;
                if (from === to) return;
                if (!this.layerDragChanged) {
                    this.pushHistory();
                    this.layerDragChanged = true;
                }
                const [layer] = this.layers.splice(from, 1);
                this.layers.splice(to, 0, layer);
                this.render();
            },

            finishLayerDrag() {
                this.draggedLayerId = null;
                this.layerDragChanged = false;
            },

            voxelPointFromEvent(event) {
                if (!voxelRaycaster || !voxelRoot) return null;
                const rect = this.$refs.voxelCanvas.getBoundingClientRect();
                const pointer = new THREE.Vector2(
                    (event.clientX - rect.left) / rect.width * 2 - 1,
                    -(event.clientY - rect.top) / rect.height * 2 + 1,
                );
                voxelRoot.updateMatrixWorld(true);
                voxelRaycaster.setFromCamera(pointer, voxelCamera);
                const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(voxelRoot.getWorldQuaternion(new THREE.Quaternion()));
                const planePoint = voxelRoot.localToWorld(new THREE.Vector3(0, 0, this.voxelLayerDepth() + 0.5));
                const hit = voxelRaycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, planePoint), new THREE.Vector3());
                if (!hit) return null;
                voxelRoot.worldToLocal(hit);
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

            setSelectionMask(mask) {
                selectionMask = mask;
                this.selection = maskBounds(mask);
                this.selectionPath = this.selection ? maskPath(mask) : "";
                if (!this.selection) selectionMask = null;
            },

            clearSelection() {
                selectionMask = null;
                this.selection = null;
                this.selectionPath = "";
            },

            selectLayerPixels(id = this.activeLayerId) {
                const canvas = canvases.get(id);
                if (!canvas) return;
                const pixels = canvas.getContext("2d").getImageData(0, 0, LAYER_SIZE, LAYER_SIZE).data;
                let minX = LAYER_SIZE;
                let minY = LAYER_SIZE;
                let maxX = -1;
                let maxY = -1;
                for (let index = 0; index < LAYER_SIZE * LAYER_SIZE; index++) {
                    if (!pixels[index * 4 + 3]) continue;
                    const x = index % LAYER_SIZE;
                    const y = Math.floor(index / LAYER_SIZE);
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x);
                    maxY = Math.max(maxY, y);
                }
                if (maxX < 0) return;
                this.setSelectionMask(rectangleMask(
                    minX - LAYER_PADDING,
                    minY - LAYER_PADDING,
                    maxX - minX + 1,
                    maxY - minY + 1,
                ));
            },

            activateLayer(id) {
                this.confirmQuantization();
                this.activeLayerId = id;
                this.render();
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

            hoverStyle() {
                if (!this.hoverPoint) return {};
                const size = this.tool === "pencil" || this.tool === "eraser"
                    ? Math.max(1, Math.min(16, Number(this.brushSize) || 1))
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
                voxelCursor.visible = !!this.hoverPoint;
                if (this.hoverPoint) {
                    const size = this.tool === "pencil" || this.tool === "eraser"
                        ? Math.max(1, Math.min(16, Number(this.brushSize) || 1))
                        : 1;
                    const startX = Math.floor(this.hoverPoint.x) - Math.floor((size - 1) / 2);
                    const startY = Math.floor(this.hoverPoint.y) - Math.floor((size - 1) / 2);
                    voxelCursor.position.set(startX + (size - 1) / 2 - 31.5, 31.5 - startY - (size - 1) / 2, this.voxelLayerDepth() + 0.04);
                    voxelCursor.scale.set(size, size, 1);
                }
                this.renderVoxelScene();
            },

            clearHover() {
                this.hoverPoint = null;
                this.renderVoxelCursor();
            },

            updateHover(event) {
                if (event.pointerType === "touch") {
                    this.clearHover();
                    return;
                }
                const voxelPoint = this.voxelPointFromEvent(event);
                if (voxelPoint) {
                    this.hoverPoint = voxelPoint.x >= 0 && voxelPoint.x < CANVAS_SIZE && voxelPoint.y >= 0 && voxelPoint.y < CANVAS_SIZE ? voxelPoint : null;
                    this.renderVoxelCursor();
                    return;
                }
                const rect = this.$refs.canvas.getBoundingClientRect();
                const inside = event.clientX >= rect.left && event.clientX < rect.right
                    && event.clientY >= rect.top && event.clientY < rect.bottom;
                this.hoverPoint = inside ? {
                    x: (event.clientX - rect.left) * CANVAS_SIZE / rect.width,
                    y: (event.clientY - rect.top) * CANVAS_SIZE / rect.height,
                } : null;
                this.renderVoxelCursor();
            },

            containsPoint(point) {
                return selectionMask?.[maskIndex(point.x, point.y)] === 1;
            },

            startVoxelRotation(event) {
                if (!voxelRoot) return;
                event.preventDefault();
                cancelAnimationFrame(voxelSnapFrame);
                voxelSnapFrame = null;
                voxelRotation = {
                    pointerId: event.pointerId,
                    clientX: event.clientX,
                    clientY: event.clientY,
                    rotationX: voxelRoot.rotation.x,
                    rotationY: voxelRoot.rotation.y,
                };
                voxelBackdrop.visible = false;
                voxelGrid.visible = false;
                this.capturePointer(event);
                this.clearHover();
            },

            continueVoxelRotation(event) {
                if (event.pointerId !== voxelRotation?.pointerId) return;
                voxelRoot.rotation.x = Math.max(-1.35, Math.min(1.35, voxelRotation.rotationX + (event.clientY - voxelRotation.clientY) * 0.01));
                voxelRoot.rotation.y = voxelRotation.rotationY + (event.clientX - voxelRotation.clientX) * 0.01;
                this.renderVoxelScene();
            },

            endVoxelRotation(event) {
                if (event.pointerId !== voxelRotation?.pointerId) return;
                voxelRotation = null;
                const rotationX = voxelRoot.rotation.x;
                const rotationY = ((voxelRoot.rotation.y + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
                voxelRoot.rotation.y = rotationY;
                const started = performance.now();
                const snap = (time) => {
                    const progress = Math.min(1, (time - started) / 260);
                    const eased = 1 - (1 - progress) ** 3;
                    voxelRoot.rotation.set(rotationX * (1 - eased), rotationY * (1 - eased), 0);
                    if (progress < 1) voxelSnapFrame = requestAnimationFrame(snap);
                    else {
                        voxelSnapFrame = null;
                        voxelBackdrop.visible = true;
                        voxelGrid.visible = this.gridVisible;
                    }
                    this.renderVoxelScene();
                };
                voxelSnapFrame = requestAnimationFrame(snap);
            },

            startPointer(event) {
                if (event.button === 1) {
                    this.startVoxelRotation(event);
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
                if (voxelRotation) {
                    this.continueVoxelRotation(event);
                    return;
                }
                this.updateHover(event);
                if (selectionAnchor) this.continueSelection(event);
                else if (moveState) this.continueMove(event);
                else if (this.sampling) this.sampleColor(event);
                else this.continueStroke(event);
            },

            endPointer(event) {
                if (voxelRotation) this.endVoxelRotation(event);
                else if (selectionAnchor) this.endSelection(event);
                else if (moveState) this.endMove(event);
                else if (this.sampling) this.endEyedropper(event);
                else this.endStroke(event);
                if (pointerTarget?.hasPointerCapture(event.pointerId)) pointerTarget.releasePointerCapture(event.pointerId);
                pointerTarget = null;
            },

            magicSelect(event) {
                event.preventDefault();
                const point = this.pointFromEvent(event);
                const pixels = this.activeContext().getImageData(LAYER_PADDING, LAYER_PADDING, CANVAS_SIZE, CANVAS_SIZE).data;
                const start = (point.y * CANVAS_SIZE + point.x) * 4;
                const target = [pixels[start], pixels[start + 1], pixels[start + 2], pixels[start + 3]];
                const tolerance = Math.max(0, Math.min(255, Number(this.wandTolerance) || 0));
                const mask = new Uint8Array(LAYER_SIZE * LAYER_SIZE);
                const visited = new Uint8Array(CANVAS_SIZE * CANVAS_SIZE);
                const stack = [point.y * CANVAS_SIZE + point.x];
                while (stack.length) {
                    const index = stack.pop();
                    if (visited[index]) continue;
                    visited[index] = 1;
                    const offset = index * 4;
                    if (!matchesColor(pixels, offset, target, tolerance)) continue;
                    const x = index % CANVAS_SIZE;
                    const y = Math.floor(index / CANVAS_SIZE);
                    mask[maskIndex(x, y)] = 1;
                    if (x > 0) stack.push(index - 1);
                    if (x < CANVAS_SIZE - 1) stack.push(index + 1);
                    if (y > 0) stack.push(index - CANVAS_SIZE);
                    if (y < CANVAS_SIZE - 1) stack.push(index + CANVAS_SIZE);
                }
                if ((event.shiftKey || event.altKey) && selectionMask) {
                    const combined = new Uint8Array(selectionMask);
                    for (let index = 0; index < mask.length; index++) {
                        if (event.shiftKey && mask[index]) combined[index] = 1;
                        if (event.altKey && mask[index]) combined[index] = 0;
                    }
                    this.setSelectionMask(combined);
                } else this.setSelectionMask(mask);
            },

            bucketFill(event) {
                event.preventDefault();
                const point = this.pointFromEvent(event);
                if (selectionMask && !this.containsPoint(point)) return;
                const context = this.activeContext();
                const image = context.getImageData(LAYER_PADDING, LAYER_PADDING, CANVAS_SIZE, CANVAS_SIZE);
                const pixels = image.data;
                const start = point.y * CANVAS_SIZE + point.x;
                const offset = start * 4;
                const target = [pixels[offset], pixels[offset + 1], pixels[offset + 2], pixels[offset + 3]];
                const fill = hexColor(this.color);
                if (target.every((channel, index) => channel === fill[index])) return;
                const tolerance = Math.max(0, Math.min(255, Number(this.wandTolerance) || 0));
                const visited = new Uint8Array(CANVAS_SIZE * CANVAS_SIZE);
                const stack = [start];
                this.pushHistory();
                this.allowPaletteColor();
                while (stack.length) {
                    const index = stack.pop();
                    const x = index % CANVAS_SIZE;
                    const y = Math.floor(index / CANVAS_SIZE);
                    if (visited[index] || (selectionMask && !selectionMask[maskIndex(x, y)])) continue;
                    visited[index] = 1;
                    const pixelOffset = index * 4;
                    if (!matchesColor(pixels, pixelOffset, target, tolerance)) continue;
                    pixels[pixelOffset] = fill[0];
                    pixels[pixelOffset + 1] = fill[1];
                    pixels[pixelOffset + 2] = fill[2];
                    pixels[pixelOffset + 3] = fill[3];
                    if (x > 0) stack.push(index - 1);
                    if (x < CANVAS_SIZE - 1) stack.push(index + 1);
                    if (y > 0) stack.push(index - CANVAS_SIZE);
                    if (y < CANVAS_SIZE - 1) stack.push(index + CANVAS_SIZE);
                }
                const activeLayer = this.layers.find((layer) => layer.id === this.activeLayerId);
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
                const pixel = this.context.getImageData(point.x, point.y, 1, 1).data;
                if (!pixel[3]) return;
                this.color = `#${pixel[0].toString(16).padStart(2, "0")}${pixel[1].toString(16).padStart(2, "0")}${pixel[2].toString(16).padStart(2, "0")}`;
            },

            endEyedropper(event) {
                if (event.pointerId !== this.pointerId) return;
                this.sampling = false;
                this.pointerId = null;
            },

            startSelection(event) {
                if (this.pointerId !== null) return;
                event.preventDefault();
                this.pointerId = event.pointerId;
                this.capturePointer(event);
                const point = this.pointFromEvent(event);
                selectionAnchor = {
                    mode: this.containsPoint(point) ? "move" : "create",
                    start: point,
                    selection: this.selection ? { ...this.selection } : null,
                    mask: selectionMask ? new Uint8Array(selectionMask) : null,
                    clientX: event.clientX,
                    clientY: event.clientY,
                    moved: false,
                };
            },

            continueSelection(event) {
                if (event.pointerId !== this.pointerId) return;
                if (!selectionAnchor.moved) {
                    selectionAnchor.moved = Math.hypot(event.clientX - selectionAnchor.clientX, event.clientY - selectionAnchor.clientY) >= 2;
                    if (!selectionAnchor.moved) return;
                }
                const point = selectionAnchor.mode === "move" ? this.worldPointFromEvent(event) : this.pointFromEvent(event);
                if (selectionAnchor.mode === "move") {
                    const selection = selectionAnchor.selection;
                    const dx = Math.max(-LAYER_PADDING - selection.x, Math.min(CANVAS_SIZE + LAYER_PADDING - selection.x - selection.width, point.x - selectionAnchor.start.x));
                    const dy = Math.max(-LAYER_PADDING - selection.y, Math.min(CANVAS_SIZE + LAYER_PADDING - selection.y - selection.height, point.y - selectionAnchor.start.y));
                    this.setSelectionMask(translateMask(selectionAnchor.mask, dx, dy));
                    return;
                }
                const start = selectionAnchor.start;
                const x = Math.min(start.x, point.x);
                const y = Math.min(start.y, point.y);
                this.setSelectionMask(rectangleMask(x, y, Math.abs(point.x - start.x) + 1, Math.abs(point.y - start.y) + 1));
            },

            endSelection(event) {
                if (event.pointerId !== this.pointerId) return;
                if (!selectionAnchor.moved) this.clearSelection();
                selectionAnchor = null;
                this.pointerId = null;
            },

            startMove(event) {
                if (this.pointerId !== null) return;
                if (!this.selection) this.selectLayerPixels();
                if (!this.selection) return;
                const point = this.worldPointFromEvent(event);
                if (!this.containsPoint(point)) return;
                event.preventDefault();
                this.capturePointer(event);
                const selection = { ...this.selection };
                const mask = new Uint8Array(selectionMask);
                const pixels = selectionPixels(canvases.get(this.activeLayerId), mask, selection);
                this.pointerId = event.pointerId;
                moveState = {
                    start: point,
                    selection,
                    mask,
                    pixels,
                    base: this.activeContext().getImageData(0, 0, LAYER_SIZE, LAYER_SIZE),
                    dx: 0,
                    dy: 0,
                    recorded: false,
                };
            },

            continueMove(event) {
                if (event.pointerId !== this.pointerId) return;
                const point = this.worldPointFromEvent(event);
                const selection = moveState.selection;
                const dx = Math.max(-LAYER_PADDING - selection.x, Math.min(CANVAS_SIZE + LAYER_PADDING - selection.x - selection.width, point.x - moveState.start.x));
                const dy = Math.max(-LAYER_PADDING - selection.y, Math.min(CANVAS_SIZE + LAYER_PADDING - selection.y - selection.height, point.y - moveState.start.y));
                if (dx === moveState.dx && dy === moveState.dy) return;
                if (!moveState.recorded) {
                    this.pushHistory();
                    moveState.recorded = true;
                }
                moveState.dx = dx;
                moveState.dy = dy;
                const context = this.activeContext();
                context.putImageData(moveState.base, 0, 0);
                clearMaskedPixels(context, moveState.mask);
                context.drawImage(moveState.pixels, selection.x + dx + LAYER_PADDING, selection.y + dy + LAYER_PADDING);
                this.setSelectionMask(translateMask(moveState.mask, dx, dy));
                this.render();
            },

            endMove(event) {
                if (event.pointerId !== this.pointerId) return;
                moveState = null;
                this.pointerId = null;
            },

            activeContext() {
                return canvases.get(this.activeLayerId).getContext("2d", { willReadFrequently: true });
            },

            paint(x, y) {
                const context = this.activeContext();
                const size = Math.max(1, Math.min(16, Number(this.brushSize) || 1));
                const startX = x - Math.floor((size - 1) / 2);
                const startY = y - Math.floor((size - 1) / 2);
                context.fillStyle = this.color;
                for (let py = startY; py < startY + size; py++) for (let px = startX; px < startX + size; px++) {
                    if (selectionMask && !selectionMask[maskIndex(px, py)]) continue;
                    if (this.tool === "eraser") context.clearRect(px + LAYER_PADDING, py + LAYER_PADDING, 1, 1);
                    else context.fillRect(px + LAYER_PADDING, py + LAYER_PADDING, 1, 1);
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
                if (this.drawing) return;
                event.preventDefault();
                this.pushHistory();
                if (this.tool === "pencil") this.allowPaletteColor();
                const activeLayer = this.layers.find((layer) => layer.id === this.activeLayerId);
                activeLayer.visible = true;
                this.drawing = true;
                this.pointerId = event.pointerId;
                this.capturePointer(event);
                this.lastPoint = this.pointFromEvent(event);
                this.paint(this.lastPoint.x, this.lastPoint.y);
                this.render();
            },

            continueStroke(event) {
                if (!this.drawing || event.pointerId !== this.pointerId) return;
                const point = this.pointFromEvent(event);
                this.drawLine(this.lastPoint, point);
                this.lastPoint = point;
                this.render();
            },

            endStroke(event) {
                if (event.pointerId !== this.pointerId) return;
                this.drawing = false;
                this.pointerId = null;
                this.lastPoint = null;
            },

            snapshot() {
                return Alpine.raw({
                    layers: this.layers.map(({ id, name, visible }) => ({ id, name, visible })),
                    activeLayerId: this.activeLayerId,
                    selectionMask: selectionMask ? new Uint8Array(selectionMask) : null,
                    pixels: this.layers.map(({ id }) => ({
                        id,
                        data: canvases.get(id).getContext("2d").getImageData(0, 0, LAYER_SIZE, LAYER_SIZE),
                    })),
                });
            },

            restore(snapshot) {
                snapshot = Alpine.raw(snapshot);
                canvases.clear();
                for (const pixels of snapshot.pixels) {
                    const canvas = createLayerCanvas();
                    canvas.getContext("2d").putImageData(pixels.data, 0, 0);
                    canvases.set(pixels.id, canvas);
                }
                this.layers = snapshot.layers.map((layer) => ({ ...layer }));
                this.activeLayerId = snapshot.activeLayerId;
                if (snapshot.selectionMask) this.setSelectionMask(new Uint8Array(snapshot.selectionMask));
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

            clearCanvas() {
                this.pushHistory();
                if (selectionMask) clearMaskedPixels(this.activeContext(), selectionMask);
                else this.activeContext().clearRect(0, 0, LAYER_SIZE, LAYER_SIZE);
                this.render();
            },

            translateSelection(dx, dy) {
                if (!this.selection) return;
                const selection = { ...this.selection };
                dx = Math.max(-LAYER_PADDING - selection.x, Math.min(CANVAS_SIZE + LAYER_PADDING - selection.x - selection.width, dx));
                dy = Math.max(-LAYER_PADDING - selection.y, Math.min(CANVAS_SIZE + LAYER_PADDING - selection.y - selection.height, dy));
                if (!dx && !dy) return;
                this.pushHistory();
                const source = canvases.get(this.activeLayerId);
                const mask = new Uint8Array(selectionMask);
                const pixels = selectionPixels(source, mask, selection);
                const context = this.activeContext();
                clearMaskedPixels(context, mask);
                context.drawImage(pixels, selection.x + dx + LAYER_PADDING, selection.y + dy + LAYER_PADDING);
                this.setSelectionMask(translateMask(mask, dx, dy));
                this.render();
            },

            copySelection(cut = false) {
                if (!selectionMask || !this.selection) return;
                const mask = new Uint8Array(selectionMask);
                const bounds = { ...this.selection };
                const pixels = selectionPixels(canvases.get(this.activeLayerId), mask, bounds);
                internalClipboard = { pixels, mask, bounds, quantizedPalette: quantizedPalettes.get(this.activeLayerId) };
                if (navigator.clipboard?.write && window.ClipboardItem) {
                    pixels.toBlob((blob) => {
                        if (blob) navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).catch(() => {});
                    }, "image/png");
                }
                if (!cut) return;
                this.pushHistory();
                clearMaskedPixels(this.activeContext(), mask);
                this.render();
            },

            pasteSelection() {
                if (!internalClipboard) return;
                this.pushHistory();
                const layer = this.addLayer("Pasted Selection", false);
                const { pixels, mask, bounds, quantizedPalette } = internalClipboard;
                canvases.get(layer.id).getContext("2d").drawImage(pixels, bounds.x + LAYER_PADDING, bounds.y + LAYER_PADDING);
                if (quantizedPalette) {
                    const palette = [...quantizedPalette.palette];
                    quantizedPalettes.set(layer.id, { palette, colors: palette.map(hexColor), allowed: new Set(palette) });
                }
                this.setSelectionMask(new Uint8Array(mask));
                this.render();
            },

            handleKeydown(event) {
                if (event.target.matches("input, textarea")) {
                    if (event.key === "Escape") event.target.blur();
                    return;
                }
                const command = event.ctrlKey || event.metaKey;
                const key = event.key.toLowerCase();
                if (command && key === "z") {
                    event.preventDefault();
                    if (event.shiftKey) this.redo();
                    else this.undo();
                    return;
                }
                if (command && key === "y") {
                    event.preventDefault();
                    this.redo();
                    return;
                }
                if (command && (key === "c" || key === "x")) {
                    event.preventDefault();
                    this.copySelection(key === "x");
                    return;
                }
                if (command && key === "v" && internalClipboard) {
                    event.preventDefault();
                    this.pasteSelection();
                    return;
                }
                if (command && key === "a") {
                    event.preventDefault();
                    this.setSelectionMask(rectangleMask(0, 0, CANVAS_SIZE, CANVAS_SIZE));
                    return;
                }
                if (command && key === "d") {
                    event.preventDefault();
                    this.clearSelection();
                    return;
                }
                if (event.key === "Escape") {
                    this.clearSelection();
                    return;
                }
                if (event.key === "Delete" || event.key === "Backspace") {
                    event.preventDefault();
                    this.clearCanvas();
                    return;
                }
                const directions = {
                    ArrowLeft: [-1, 0],
                    ArrowRight: [1, 0],
                    ArrowUp: [0, -1],
                    ArrowDown: [0, 1],
                };
                if (this.selection && directions[event.key]) {
                    event.preventDefault();
                    const distance = event.shiftKey ? 8 : 1;
                    this.translateSelection(directions[event.key][0] * distance, directions[event.key][1] * distance);
                    return;
                }
                if (command || event.altKey) return;
                const tools = { b: "pencil", g: "bucket", i: "eyedropper", t: "selection", m: "move", w: "wand", e: "eraser" };
                const tool = tools[key];
                if (tool) this.tool = tool;
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
                        const context = canvases.get(layer.id).getContext("2d");
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
