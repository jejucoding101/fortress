import {
  MAX_DRIVABLE_SLOPE,
  WORLD_HEIGHT,
  WORLD_WIDTH
} from "./constants.js";
import type { TerrainCrater } from "./types.js";

export function baseTerrainY(x: number) {
  return (
    354 +
    Math.sin(x * 0.012) * 30 +
    Math.sin(x * 0.031 + 1.7) * 16 +
    Math.cos(x * 0.006) * 26
  );
}

export function isSolidTerrainAt(x: number, y: number, holes: TerrainCrater[]) {
  if (x < 0 || x >= WORLD_WIDTH || y < 0 || y >= WORLD_HEIGHT) return false;
  if (y < baseTerrainY(x)) return false;
  return !holes.some((hole) => {
    const dx = x - hole.x;
    const dy = y - hole.y;
    return dx * dx + dy * dy <= hole.radius * hole.radius;
  });
}

export function findGroundY(x: number, holes: TerrainCrater[]) {
  const clampedX = clamp(x, 0, WORLD_WIDTH - 1);
  for (let y = 0; y < WORLD_HEIGHT; y += 1) {
    if (isSolidTerrainAt(clampedX, y, holes)) return y;
  }
  return WORLD_HEIGHT + 30;
}

export function findGroundSlope(x: number, holes: TerrainCrater[]) {
  const sampleDistance = 24;
  const leftY = findGroundY(clamp(x - sampleDistance, 0, WORLD_WIDTH - 1), holes);
  const rightY = findGroundY(clamp(x + sampleDistance, 0, WORLD_WIDTH - 1), holes);
  if (leftY > WORLD_HEIGHT || rightY > WORLD_HEIGHT) return 0;
  return clamp(
    Math.atan2(rightY - leftY, sampleDistance * 2),
    -MAX_DRIVABLE_SLOPE,
    MAX_DRIVABLE_SLOPE
  );
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
