export type PlayerId = number;
export type TeamId = "A" | "B" | "C" | "D";
export type PlayerKind = "human" | "computer";
export type AIDifficulty = "easy" | "normal" | "hard";
export type GamePhase = "waiting" | "aim" | "flying" | "gameover";
export type TankId = string;
export type WeaponId = string;
export type ItemId = string;
export type ItemEffect = "none" | "repair" | "shield" | "powerBoost" | "extraShot";

export type ProjectileVisual = {
  radius: number;
  fillColor: number;
  strokeColor?: number;
  spriteSheetPath?: string;
  frameWidth?: number;
  frameHeight?: number;
  frameCount?: number;
  frameRate?: number;
  scale?: number;
  originX?: number;
  originY?: number;
};

export type WeaponDefinition = {
  id: WeaponId;
  name: string;
  description: string;
  shotBaseSpeed: number;
  shotPowerScale: number;
  windInfluence: number;
  craterRadius: number;
  damageRadius: number;
  maxDamage: number;
  minDamage: number;
  projectile: ProjectileVisual;
};

export type TankDefinition = {
  id: TankId;
  name: string;
  description: string;
  maxHp: number;
  maxMove: number;
  itemSlots: number;
  defaultWeaponId: WeaponId;
  weaponIds: WeaponId[];
  asset: {
    thumbnailPath?: string;
    imagePath?: string;
    idleSheetPath?: string;
    sourceFacing: "left" | "right";
  };
};

export type ItemDefinition = {
  id: ItemId;
  name: string;
  description: string;
  effect: ItemEffect;
  maxStack: number;
};

export type ItemStack = {
  itemId: ItemId;
  quantity: number;
};

export type ShotMemory = {
  targetId: PlayerId;
  angle: number;
  power: number;
  impactX: number;
  impactY: number;
  targetX: number;
  targetY: number;
  missDistance: number;
};

export type ComputerPlayerState = {
  difficulty: AIDifficulty;
  memory: ShotMemory[];
};

export type PlayerState = {
  id: PlayerId;
  slotIndex: number;
  kind: PlayerKind;
  teamId: TeamId;
  name: string;
  color: number;
  tankId: TankId;
  selectedWeaponId: WeaponId;
  inventory: ItemStack[];
  socketId?: string;
  connected: boolean;
  x: number;
  y: number;
  slope: number;
  facing: -1 | 1;
  angle: number;
  power: number;
  maxMove: number;
  move: number;
  maxHp: number;
  hp: number;
  ai?: ComputerPlayerState;
};

export type TerrainCrater = {
  x: number;
  y: number;
  radius: number;
};

export type ProjectileState = {
  x: number;
  y: number;
  weaponId: WeaponId;
};

export type GameState = {
  roomId: string;
  hostSocketId?: string;
  phase: GamePhase;
  activePlayerId: PlayerId;
  wind: number;
  terrainSeed: number;
  turnEndsAt?: number;
  turnRemainingMs?: number;
  players: PlayerState[];
  terrainHoles: TerrainCrater[];
  projectile?: ProjectileState;
  winnerId?: PlayerId;
  winnerTeamId?: TeamId;
  lastShotPower?: number;
  lastShotWeaponId?: WeaponId;
  message: string;
};

export type ClientToServerEvents = {
  createRoom: (callback: (payload: JoinPayload) => void) => void;
  joinRoom: (roomId: string, callback: (payload: JoinPayload) => void) => void;
  setPlayerName: (name: string) => void;
  addComputerPlayer: (difficulty?: AIDifficulty) => void;
  removeComputerPlayer: (playerId: PlayerId) => void;
  setTeam: (playerId: PlayerId, teamId: TeamId) => void;
  setTank: (playerId: PlayerId, tankId: TankId) => void;
  randomizeComputerTanks: (callback: (payload: { ok: boolean; message?: string }) => void) => void;
  startMatch: () => void;
  playerMove: (direction: -1 | 1) => void;
  setAngle: (direction: -1 | 1) => void;
  releaseShot: (power: number) => void;
  restartGame: () => void;
};

export type ServerToClientEvents = {
  stateSync: (state: GameState) => void;
  joinedRoom: (payload: JoinPayload) => void;
  errorMessage: (message: string) => void;
};

export type JoinPayload = {
  ok: boolean;
  roomId?: string;
  playerId?: PlayerId;
  message?: string;
  state?: GameState;
};
