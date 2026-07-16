import {
  EXPLOSION_RADIUS,
  MAX_HP,
  MAX_MOVE,
  SHOT_BASE_SPEED,
  SHOT_POWER_SCALE
} from "./constants.js";
import type { ItemDefinition, ItemId, TankDefinition, TankId, WeaponDefinition, WeaponId } from "./types.js";

export const DEFAULT_WEAPON_ID = "basic-shell";
export const DEFAULT_TANK_ID = "tank2";
export const EMPTY_ITEM_ID = "empty-slot";
export const PLAYABLE_TANK_IDS = ["tank1", "tank2", "tank3", "tank4", "tank5", "tank6", "tank8"] as const;
const TANK_DEFAULT_WEAPON_IDS = {
  tank1: "ladybug-bomb",
  tank2: "bubble-torpedo",
  tank3: "seed-pod",
  tank4: "drill-rocket",
  tank5: "plasma-pearl",
  tank6: "rescue-capsule",
  tank8: "ice-crystal"
} as const satisfies Record<(typeof PLAYABLE_TANK_IDS)[number], WeaponId>;
const PROJECTILE_ASSET_VERSION = "saved-align-v1";

const TANK_SOURCE_FACING = {
  tank1: "right",
  tank2: "left",
  tank3: "right",
  tank4: "right",
  tank5: "left",
  tank6: "left",
  tank8: "left"
} as const satisfies Record<(typeof PLAYABLE_TANK_IDS)[number], "left" | "right">;

function createProjectileWeapon(
  id: WeaponId,
  name: string,
  description: string,
  spriteName: string,
  frameWidth: number,
  frameHeight: number,
  originX: number
): WeaponDefinition {
  return {
    id,
    name,
    description,
    shotBaseSpeed: SHOT_BASE_SPEED,
    shotPowerScale: SHOT_POWER_SCALE,
    windInfluence: 18,
    craterRadius: EXPLOSION_RADIUS,
    damageRadius: EXPLOSION_RADIUS * 2.25,
    maxDamage: 44,
    minDamage: 8,
    projectile: {
      radius: 3,
      fillColor: 0xf8f3d2,
      strokeColor: 0x332819,
      spriteSheetPath: `/assets/projectiles/${spriteName}_flight_sheet.png?v=${PROJECTILE_ASSET_VERSION}`,
      frameWidth,
      frameHeight,
      frameCount: 5,
      frameRate: 12,
      scale: 0.084,
      originX,
      originY: 0.5
    }
  };
}

export const WEAPON_DEFINITIONS = [
  {
    id: DEFAULT_WEAPON_ID,
    name: "기본 포탄",
    description: "모든 탱크가 사용할 수 있는 표준 단발 포탄입니다.",
    shotBaseSpeed: SHOT_BASE_SPEED,
    shotPowerScale: SHOT_POWER_SCALE,
    windInfluence: 18,
    craterRadius: EXPLOSION_RADIUS,
    damageRadius: EXPLOSION_RADIUS * 2.25,
    maxDamage: 44,
    minDamage: 8,
    projectile: {
      radius: 3,
      fillColor: 0xf8f3d2,
      strokeColor: 0x332819
    }
  },
  createProjectileWeapon("ladybug-bomb", "레이디버그 밤", "무당벌레 탱크의 날개형 폭발 미사일입니다.", "ladybug_bomb", 937, 500, 0.5),
  createProjectileWeapon("bubble-torpedo", "버블 토피도", "잠수함 탱크의 물방울 어뢰 미사일입니다.", "torpedo", 888, 472, 0.5),
  createProjectileWeapon("seed-pod", "씨앗 포드", "식물 탱크의 잎사귀 씨앗 미사일입니다.", "seed_pod", 882, 480, 0.5),
  createProjectileWeapon("drill-rocket", "드릴 로켓", "공병 탱크의 회전 드릴 미사일입니다.", "drill_rocket", 931, 492, 0.5),
  createProjectileWeapon("plasma-pearl", "플라즈마 펄", "게형 탱크의 보라색 플라즈마 미사일입니다.", "plasma_pearl", 940, 580, 0.5),
  createProjectileWeapon("rescue-capsule", "레스큐 캡슐", "구급 탱크의 구조 캡슐 미사일입니다.", "rescue_capsule", 882, 538, 0.5),
  createProjectileWeapon("ice-crystal", "아이스 크리스탈", "얼음 탱크의 서리 결정 미사일입니다.", "ice_crystal", 898, 458, 0.5)
] satisfies WeaponDefinition[];

export const ITEM_DEFINITIONS = [
  {
    id: EMPTY_ITEM_ID,
    name: "빈 슬롯",
    description: "아이템이 장착되지 않은 슬롯입니다.",
    effect: "none",
    maxStack: 0
  }
] satisfies ItemDefinition[];

export const TANK_DEFINITIONS = PLAYABLE_TANK_IDS.map((id) => {
  const tankNumber = id.replace("tank", "");
  const defaultWeaponId = TANK_DEFAULT_WEAPON_IDS[id];
  return {
    id,
    name: `탱크 ${tankNumber}`,
    description: "기본 체력, 이동력, 전용 미사일을 사용하는 플레이어블 탱크입니다.",
    maxHp: MAX_HP,
    maxMove: MAX_MOVE,
    itemSlots: 4,
    defaultWeaponId,
    weaponIds: [defaultWeaponId],
    asset: {
      thumbnailPath: `/assets/tanks/${id}_simple.png`,
      idleSheetPath: `/assets/tanks/${id}_idle_sheet.png`,
      sourceFacing: TANK_SOURCE_FACING[id]
    }
  };
}) satisfies TankDefinition[];

const weapons = new Map<WeaponId, WeaponDefinition>(WEAPON_DEFINITIONS.map((weapon) => [weapon.id, weapon]));
const tanks = new Map<TankId, TankDefinition>(TANK_DEFINITIONS.map((tank) => [tank.id, tank]));
const items = new Map<ItemId, ItemDefinition>(ITEM_DEFINITIONS.map((item) => [item.id, item]));

export function getWeaponDefinition(id: WeaponId | undefined) {
  return weapons.get(id ?? DEFAULT_WEAPON_ID) ?? weapons.get(DEFAULT_WEAPON_ID)!;
}

export function getTankDefinition(id: TankId | undefined) {
  return tanks.get(id ?? DEFAULT_TANK_ID) ?? tanks.get(DEFAULT_TANK_ID)!;
}

export function getItemDefinition(id: ItemId | undefined) {
  return items.get(id ?? EMPTY_ITEM_ID) ?? items.get(EMPTY_ITEM_ID)!;
}

export function getDefaultInventory(tankId: TankId | undefined) {
  const tank = getTankDefinition(tankId);
  return Array.from({ length: tank.itemSlots }, () => ({
    itemId: EMPTY_ITEM_ID,
    quantity: 0
  }));
}
