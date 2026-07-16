import {
  MAX_DRIVABLE_SLOPE,
  MAX_TANK_TILT,
  WORLD_HEIGHT,
  WORLD_WIDTH
} from "./constants.js";
import {
  DEFAULT_MAP_MASK_HEIGHT,
  DEFAULT_MAP_MASK_WIDTH,
  DEFAULT_MAP_SOLID_SPANS
} from "./defaultMapMask.js";
import type { TerrainCrater } from "./types.js";

export function getGroundSurfaceY(x: number, _terrainSeed: number) {
  const spans = getColumnSpans(x);
  return spans.length > 0 ? spans[0] : WORLD_HEIGHT + 30;
}

export function isSolidTerrainAt(x: number, y: number, holes: TerrainCrater[], _terrainSeed: number) {
  if (!isBaseTerrainSolid(x, y)) return false;

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
  const maxSlope = Math.min(MAX_DRIVABLE_SLOPE, MAX_TANK_TILT);
  return clamp(rawSlope, -maxSlope, maxSlope);
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function isBaseTerrainSolid(x: number, y: number) {
  if (x < 0 || x >= WORLD_WIDTH || y < 0 || y >= WORLD_HEIGHT) return false;
  const spans = getColumnSpans(x);
  const pixelY = Math.floor((y / WORLD_HEIGHT) * DEFAULT_MAP_MASK_HEIGHT);

  for (let index = 0; index < spans.length; index += 2) {
    if (pixelY >= spans[index] && pixelY <= spans[index + 1]) return true;
  }
  return false;
}

function getColumnSpans(x: number) {
  const pixelX = clamp(Math.floor((x / WORLD_WIDTH) * DEFAULT_MAP_MASK_WIDTH), 0, DEFAULT_MAP_MASK_WIDTH - 1);
  return DEFAULT_MAP_SOLID_SPANS[pixelX] ?? [];
}
