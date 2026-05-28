export type PlayerId = 0 | 1;
export type GamePhase = "waiting" | "aim" | "flying" | "gameover";

export type PlayerState = {
  id: PlayerId;
  name: string;
  color: number;
  socketId?: string;
  connected: boolean;
  x: number;
  y: number;
  slope: number;
  angle: number;
  power: number;
  move: number;
  hp: number;
};

export type TerrainCrater = {
  x: number;
  y: number;
  radius: number;
};

export type ProjectileState = {
  x: number;
  y: number;
};

export type GameState = {
  roomId: string;
  phase: GamePhase;
  activePlayerId: PlayerId;
  wind: number;
  players: [PlayerState, PlayerState];
  terrainHoles: TerrainCrater[];
  projectile?: ProjectileState;
  winnerId?: PlayerId;
  lastShotPower?: number;
  message: string;
};

export type ClientToServerEvents = {
  createRoom: (callback: (payload: JoinPayload) => void) => void;
  joinRoom: (roomId: string, callback: (payload: JoinPayload) => void) => void;
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
