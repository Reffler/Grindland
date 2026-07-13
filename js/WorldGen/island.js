import { AIR, DIRT, GRASS, LOG, LEAVES, PLANKS } from "../constants.js";

export function buildSkyblockWithTree(world) {
    const baseY = 16,
        baseX = 0,
        baseZ = 0;
    const patches = [[0, 0], [3, 0], [0, 3, PLANKS], [-3, 0], [0, -3]];
    const layers = [DIRT, DIRT, GRASS];
    for (const [patchX, patchZ, material] of patches)
        for (let dz = 0; dz < 3; dz++)
            for (let dx = 0; dx < 3; dx++)
                for (let ly = 0; ly < 3; ly++)
                    if (!material || ly === 2)
                        world.add(
                            baseX + patchX + dx,
                            baseY + ly,
                            baseZ + patchZ + dz,
                            material ?? layers[ly],
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
    return {
        x: baseX + 2.5,
        y: baseY + 3.01,
        z: baseZ + 1.5,
        oakCenter: { x: baseX + 1, y: baseY + 3, z: baseZ + 4 },
    };
}
