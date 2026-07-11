import { AIR, DIRT, GRASS, LOG, LEAVES } from "../constants.js";

export function buildSkyblockWithTree(world) {
    const baseY = 16,
        baseX = 0,
        baseZ = 0;
    const rectA = { w: 6, d: 3 },
        rectB = { w: 3, d: 3 };
    const layers = [DIRT, DIRT, GRASS];
    for (let dz = 0; dz < rectA.d; dz++)
        for (let dx = 0; dx < rectA.w; dx++)
            for (let ly = 0; ly < 3; ly++)
                world.add(
                    baseX + dx,
                    baseY + ly,
                    baseZ + dz,
                    layers[ly],
                );
    for (let dz = rectA.d; dz < rectA.d + rectB.d; dz++)
        for (let dx = 0; dx < rectB.w; dx++)
            for (let ly = 0; ly < 3; ly++)
                world.add(
                    baseX + dx,
                    baseY + ly,
                    baseZ + dz,
                    layers[ly],
                );
    const tx = baseX + 4,
        tz = baseZ + 1,
        trunkBaseY = baseY + 3,
        trunkTopY = trunkBaseY + 4;
    for (let y = trunkBaseY; y <= trunkTopY; y++)
        world.add(tx, y, tz, LOG);
    const leaf = (x, y, z) => {
        if (world.get(x, y, z) === AIR) world.add(x, y, z, LEAVES);
    };
    for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++)
            leaf(tx + dx, trunkTopY, tz + dz);
    for (const [dx, dz] of [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
    ]) {
        leaf(tx + dx, trunkTopY + 1, tz + dz);
        leaf(tx + dx, trunkTopY - 1, tz + dz);
    }
    world.rebuild();
    return { x: baseX + 2.5, y: baseY + 3.01, z: baseZ + 1.5 };
}
