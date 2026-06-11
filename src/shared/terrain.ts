import {
  MAX_DRIVABLE_SLOPE,
  MAX_TANK_TILT,
  WORLD_HEIGHT,
  WORLD_WIDTH
} from "./constants.js";
import type { TerrainCrater } from "./types.js";

type TerrainIsland = {
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
};

type TerrainStep = {
  start: number;
  width: number;
  height: number;
};

type TerrainRavine = {
  center: number;
  radius: number;
  depth: number;
};

type TerrainLayout = {
  phaseA: number;
  phaseB: number;
  phaseC: number;
  groundBias: number;
  islands: TerrainIsland[];
  steps: TerrainStep[];
  ravines: TerrainRavine[];
};

const terrainLayoutCache = new Map<number, TerrainLayout>();

export function getGroundSurfaceY(x: number, terrainSeed: number) {
  const layout = getTerrainLayout(terrainSeed);
  let y =
    layout.groundBias +
    Math.sin((x + layout.phaseA) * 0.009) * 26 +
    Math.sin((x + layout.phaseB) * 0.021) * 12 +
    Math.cos((x + layout.phaseC) * 0.0045) * 22;

  layout.steps.forEach((step) => {
    const start = smoothstep(step.start - 36, step.start + 18, x);
    const end = smoothstep(step.start + step.width - 20, step.start + step.width + 44, x);
    y += step.height * (start - end);
  });

  layout.ravines.forEach((ravine) => {
    const dx = Math.abs(x - ravine.center);
    if (dx >= ravine.radius) return;
    const t = 1 - dx / ravine.radius;
    y += ravine.depth * t * t;
  });

  return clamp(y, 168, WORLD_HEIGHT + 70);
}

export function getTerrainIslands(terrainSeed: number) {
  return getTerrainLayout(terrainSeed).islands;
}

export function isSolidTerrainAt(x: number, y: number, holes: TerrainCrater[], terrainSeed: number) {
  if (x < 0 || x >= WORLD_WIDTH || y < 0 || y >= WORLD_HEIGHT) return false;

  const groundY = getGroundSurfaceY(x, terrainSeed);
  const insideGround = groundY < WORLD_HEIGHT && y >= groundY;
  const insideIsland = getTerrainIslands(terrainSeed).some((island) => {
    const nx = (x - island.x) / island.radiusX;
    const ny = (y - island.y) / island.radiusY;
    return nx * nx + ny * ny <= 1;
  });

  if (!insideGround && !insideIsland) return false;

  return !holes.some((hole) => {
    const dx = x - hole.x;
    const dy = y - hole.y;
    return dx * dx + dy * dy <= hole.radius * hole.radius;
  });
}

export function findGroundY(x: number, holes: TerrainCrater[], terrainSeed: number) {
  const clampedX = clamp(x, 0, WORLD_WIDTH - 1);
  for (let y = 0; y < WORLD_HEIGHT; y += 1) {
    if (isSolidTerrainAt(clampedX, y, holes, terrainSeed)) return y;
  }
  return WORLD_HEIGHT + 30;
}

export function findGroundSlope(x: number, holes: TerrainCrater[], terrainSeed: number) {
  const samples = [-18, -9, 0, 9, 18]
    .map((offset) => {
      const sampleX = clamp(x + offset, 0, WORLD_WIDTH - 1);
      const sampleY = findGroundY(sampleX, holes, terrainSeed);
      return sampleY > WORLD_HEIGHT ? undefined : { x: sampleX, y: sampleY };
    })
    .filter((sample): sample is { x: number; y: number } => Boolean(sample));

  if (samples.length < 2) return 0;

  const first = samples[0];
  const last = samples[samples.length - 1];
  const rawSlope = Math.atan2(last.y - first.y, last.x - first.x);

  return clamp(rawSlope, -Math.min(MAX_DRIVABLE_SLOPE, MAX_TANK_TILT), Math.min(MAX_DRIVABLE_SLOPE, MAX_TANK_TILT));
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getTerrainLayout(terrainSeed: number) {
  const cached = terrainLayoutCache.get(terrainSeed);
  if (cached) return cached;

  const random = createSeededRandom(terrainSeed);
  const islands: TerrainIsland[] = [];
  const islandCount = 1 + Math.floor(random() * 3);

  for (let index = 0; index < islandCount; index += 1) {
    islands.push({
      x: 210 + random() * (WORLD_WIDTH - 420),
      y: 148 + random() * 130,
      radiusX: 52 + random() * 70,
      radiusY: 16 + random() * 26
    });
  }

  const steps: TerrainStep[] = [];
  const stepCount = 2 + Math.floor(random() * 3);
  for (let index = 0; index < stepCount; index += 1) {
    steps.push({
      start: 120 + random() * (WORLD_WIDTH - 280),
      width: 110 + random() * 200,
      height: -44 + random() * 88
    });
  }

  const ravines: TerrainRavine[] = [];
  const ravineCount = 1 + Math.floor(random() * 2);
  for (let index = 0; index < ravineCount; index += 1) {
    ravines.push({
      center: 220 + random() * (WORLD_WIDTH - 440),
      radius: 70 + random() * 70,
      depth: 170 + random() * 140
    });
  }

  const layout: TerrainLayout = {
    phaseA: random() * 600,
    phaseB: random() * 600,
    phaseC: random() * 600,
    groundBias: 338 + random() * 30,
    islands,
    steps,
    ravines
  };
  terrainLayoutCache.set(terrainSeed, layout);
  return layout;
}

function createSeededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
