export type PlayerId = number;
export type TeamId = "A" | "B" | "C" | "D";
export type PlayerKind = "human" | "computer";
export type AIDifficulty = "easy" | "normal" | "hard";
export type GamePhase = "waiting" | "aim" | "flying" | "gameover";

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
  socketId?: string;
  connected: boolean;
  x: number;
  y: number;
  slope: number;
  angle: number;
  power: number;
  move: number;
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
};

export type GameState = {
  roomId: string;
  hostSocketId?: string;
  phase: GamePhase;
  activePlayerId: PlayerId;
  wind: number;
  terrainSeed: number;
  players: PlayerState[];
  terrainHoles: TerrainCrater[];
  projectile?: ProjectileState;
  winnerId?: PlayerId;
  winnerTeamId?: TeamId;
  lastShotPower?: number;
  message: string;
};

export type ClientToServerEvents = {
  createRoom: (callback: (payload: JoinPayload) => void) => void;
  joinRoom: (roomId: string, callback: (payload: JoinPayload) => void) => void;
  setPlayerName: (name: string) => void;
  addComputerPlayer: (difficulty?: AIDifficulty) => void;
  removeComputerPlayer: (playerId: PlayerId) => void;
  setTeam: (playerId: PlayerId, teamId: TeamId) => void;
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
