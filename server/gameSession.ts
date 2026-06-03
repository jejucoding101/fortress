import {
  EXPLOSION_RADIUS,
  GRAVITY,
  MAX_CLIMB_STEP,
  MAX_HP,
  MAX_MOVE,
  MAX_PLAYERS,
  MAX_POWER,
  MIN_POWER,
  SHOT_STEP_MS,
  TEAM_IDS,
  WORLD_HEIGHT,
  WORLD_WIDTH
} from "../src/shared/constants.js";
import { clamp, findGroundSlope, findGroundY, isSolidTerrainAt } from "../src/shared/terrain.js";
import type {
  AIDifficulty,
  GameState,
  PlayerId,
  PlayerState,
  TeamId,
  TerrainCrater
} from "../src/shared/types.js";

type Broadcast = (state: GameState) => void;
type SimulatedShot = {
  angle: number;
  power: number;
  impactX: number;
  impactY: number;
  score: number;
};

const SPAWN_X = [120, 840, 245, 715, 365, 590, 480];
const LEFT_SPAWN_X = [120, 215, 310, 405, 500, 595, 690];
const RIGHT_SPAWN_X = [840, 745, 650, 555, 460, 365, 270];
const PLAYER_COLORS = [0x45c7ff, 0xff9152, 0x9cff5a, 0xf36bff, 0xffdb4f, 0x6affd3, 0xd7d7e8];

export class GameSession {
  readonly roomId: string;
  private broadcast: Broadcast;
  private interval?: NodeJS.Timeout;
  private aiTimeout?: NodeJS.Timeout;
  private nextPlayerId = 0;
  state: GameState;

  constructor(roomId: string, hostSocketId: string, broadcast: Broadcast) {
    this.roomId = roomId;
    this.broadcast = broadcast;
    this.state = this.createInitialState(hostSocketId);
  }

  addPlayer(socketId: string) {
    const existing = this.getPlayerBySocket(socketId);
    if (existing) {
      existing.connected = true;
      this.sync();
      return existing.id;
    }

    if (this.state.players.length >= MAX_PLAYERS || this.state.phase !== "waiting") return undefined;
    const player = this.createPlayer("human", socketId);
    this.state.players.push(player);
    this.state.message = `${player.name} 입장`;
    this.sync();
    return player.id;
  }

  addComputer(socketId: string, difficulty: AIDifficulty = "normal") {
    if (!this.isHost(socketId)) return;
    if (this.state.players.length >= MAX_PLAYERS || this.state.phase !== "waiting") return;
    const player = this.createPlayer("computer", undefined, difficulty);
    this.state.players.push(player);
    this.state.message = `${player.name} 추가됨`;
    this.sync();
  }

  setPlayerName(socketId: string, name: string) {
    const player = this.getPlayerBySocket(socketId);
    if (!player || player.kind !== "human") return;
    const trimmed = name.trim().slice(0, 12);
    if (!trimmed) return;
    player.name = trimmed;
    this.state.message = `${player.name} 이름 변경`;
    this.sync();
  }

  removeComputer(socketId: string, playerId: PlayerId) {
    if (!this.isHost(socketId) || this.state.phase !== "waiting") return;
    this.state.players = this.state.players.filter(
      (player) => !(player.id === playerId && player.kind === "computer")
    );
    this.reindexSlots();
    this.state.message = "컴퓨터 플레이어 제거됨";
    this.sync();
  }

  setTeam(socketId: string, playerId: PlayerId, teamId: TeamId) {
    if (!TEAM_IDS.includes(teamId)) return;
    const player = this.state.players.find((item) => item.id === playerId);
    if (!player || this.state.phase !== "waiting") return;

    const ownsHumanSlot = player.kind === "human" && player.socketId === socketId;
    if (!ownsHumanSlot && !this.isHost(socketId)) return;
    if (player.kind === "computer" && !this.isHost(socketId)) return;

    player.teamId = teamId;
    this.state.message = `${player.name} ${teamId === "A" ? "왼쪽 편" : "오른쪽 편"}으로 이동`;
    this.sync();
  }

  startMatch(socketId: string) {
    if (!this.isHost(socketId) || this.state.phase !== "waiting") return;
    if (!this.canStartMatch()) {
      this.state.message = "게임을 시작하려면 두 편이 필요합니다.";
      this.sync();
      return;
    }
    this.resetCombatState();
    this.state.phase = "aim";
    this.state.activePlayerId = this.state.players.find((player) => player.hp > 0)!.id;
    this.state.message = `${this.currentPlayer.name} 턴`;
    this.sync();
  }

  removePlayer(socketId: string) {
    const player = this.getPlayerBySocket(socketId);
    if (!player) return;

    if (this.state.phase === "waiting") {
      this.state.players = this.state.players.filter((item) => item.id !== player.id);
      this.reindexSlots();
      if (this.state.hostSocketId === socketId) {
        this.state.hostSocketId = this.state.players.find((item) => item.kind === "human")?.socketId;
      }
    } else {
      player.connected = false;
      this.state.message = `${player.name} 연결 끊김`;
      if (this.currentPlayer.id === player.id) this.advanceTurn();
    }
    this.sync();
  }

  restart(socketId: string) {
    if (!this.isHost(socketId) && !this.getPlayerBySocket(socketId)) return;
    this.stopShot();
    this.clearAI();
    if (!this.canStartMatch()) {
      this.state.phase = "waiting";
      this.state.message = "게임을 시작하려면 두 편이 필요합니다.";
      this.sync();
      return;
    }
    this.resetCombatState();
    this.state.phase = "aim";
    this.state.activePlayerId = this.state.players.find((player) => player.hp > 0)!.id;
    this.state.message = `${this.currentPlayer.name} 턴`;
    this.sync();
  }

  move(socketId: string, direction: -1 | 1) {
    if (!this.canAct(socketId)) return;
    this.tryMovePlayer(this.currentPlayer, direction * Math.min(3.2, this.currentPlayer.move));
    this.sync();
  }

  setAngle(socketId: string, direction: -1 | 1) {
    if (!this.canAct(socketId)) return;
    const player = this.currentPlayer;
    const angleDirection = player.x <= WORLD_WIDTH / 2 ? 1 : -1;
    player.angle += direction * angleDirection * 2.2;
    this.clampPlayerAngle(player);
    this.sync();
  }

  releaseShot(socketId: string, power: number) {
    if (!this.canAct(socketId)) return;
    this.fireCurrentPlayer(power);
  }

  private fireCurrentPlayer(power: number) {
    const player = this.currentPlayer;
    const shotPower = clamp(power, MIN_POWER, MAX_POWER);
    const radians = (player.angle / 180) * Math.PI;
    const speed = 130 + shotPower * 4.9;
    const projectile = {
      x: player.x + Math.cos(radians) * 34,
      y: player.y - 16 - Math.sin(radians) * 34,
      vx: Math.cos(radians) * speed,
      vy: -Math.sin(radians) * speed,
      life: 0
    };

    player.power = shotPower;
    this.state.lastShotPower = shotPower;
    this.state.phase = "flying";
    this.state.message = `${player.name} 발사`;
    this.state.projectile = { x: projectile.x, y: projectile.y };
    this.sync();

    this.stopShot();
    this.interval = setInterval(() => {
      const delta = SHOT_STEP_MS / 1000;
      projectile.life += delta;
      projectile.vx += this.state.wind * 18 * delta;
      projectile.vy += GRAVITY * delta;
      projectile.x += projectile.vx * delta;
      projectile.y += projectile.vy * delta;
      this.state.projectile = { x: projectile.x, y: projectile.y };

      const out =
        projectile.x < -40 ||
        projectile.x > WORLD_WIDTH + 40 ||
        projectile.y > WORLD_HEIGHT + 40 ||
        projectile.life > 8;

      if (out) {
        this.finishShot(projectile.x, projectile.y);
        return;
      }

      if (projectile.y > 0 && isSolidTerrainAt(projectile.x, projectile.y, this.state.terrainHoles)) {
        this.explodeAt(projectile.x, projectile.y);
        return;
      }

      this.sync();
    }, SHOT_STEP_MS);
  }

  private runComputerTurn() {
    if (this.state.phase !== "aim" || this.currentPlayer.kind !== "computer") return;
    const player = this.currentPlayer;
    const target = this.chooseTarget(player);
    if (!target) return;

    this.state.message = `${player.name} 생각 중`;
    this.sync(false);

    const initialShot = this.findBestShot(player, target);
    if (initialShot.score > 115 && player.move > 20) {
      this.tryRepositionComputer(player, target);
    }

    const shot = this.findBestShot(player, target);
    const noisyShot = this.addAimingNoise(player, shot);
    player.angle = noisyShot.angle;
    player.power = MIN_POWER;
    this.state.message = `${player.name} 조준 중`;
    this.sync(false);

    this.aiTimeout = setTimeout(() => {
      player.power = noisyShot.power;
      this.sync(false);
      this.aiTimeout = setTimeout(() => this.fireCurrentPlayer(noisyShot.power), 520);
    }, 650);
  }

  private tryRepositionComputer(player: PlayerState, target: PlayerState) {
    const directions: Array<-1 | 1> = target.x > player.x ? [-1, 1] : [1, -1];
    let bestScore = this.findBestShot(player, target).score;
    let bestDirection: -1 | 1 | undefined;

    for (const direction of directions) {
      const clone = { ...player };
      const moved = this.tryMovePlayer(clone, direction * 28, false);
      if (!moved) continue;
      const score = this.findBestShot(clone, target).score;
      if (score < bestScore) {
        bestScore = score;
        bestDirection = direction;
      }
    }

    if (bestDirection) {
      this.tryMovePlayer(player, bestDirection * Math.min(28, player.move));
    }
  }

  private findBestShot(player: PlayerState, target: PlayerState): SimulatedShot {
    const memory = [...(player.ai?.memory ?? [])].reverse().find((shot) => shot.targetId === target.id);
    const targetRight = target.x > player.x;
    const angleStart = targetRight ? 15 : 100;
    const angleEnd = targetRight ? 85 : 165;
    const angleStep = player.ai?.difficulty === "hard" ? 3 : 5;
    const powerStep = player.ai?.difficulty === "easy" ? 8 : 5;
    let best: SimulatedShot = {
      angle: targetRight ? 45 : 135,
      power: 55,
      impactX: player.x,
      impactY: player.y,
      score: Number.POSITIVE_INFINITY
    };

    for (let angle = angleStart; angle <= angleEnd; angle += angleStep) {
      for (let power = 20; power <= MAX_POWER; power += powerStep) {
        const candidate = this.simulateShot(player, angle, power, target);
        if (candidate.score < best.score) best = candidate;
      }
    }

    if (memory) {
      const shortBy = memory.impactX - memory.targetX;
      const correction = targetRight ? -shortBy / 9 : shortBy / 9;
      best.power = clamp(best.power + correction, MIN_POWER, MAX_POWER);
    }

    return best;
  }

  private simulateShot(player: PlayerState, angle: number, power: number, target: PlayerState): SimulatedShot {
    const radians = (angle / 180) * Math.PI;
    const speed = 130 + power * 4.9;
    let x = player.x + Math.cos(radians) * 34;
    let y = player.y - 16 - Math.sin(radians) * 34;
    let vx = Math.cos(radians) * speed;
    let vy = -Math.sin(radians) * speed;
    let life = 0;

    while (life < 8) {
      const delta = SHOT_STEP_MS / 1000;
      life += delta;
      vx += this.state.wind * 18 * delta;
      vy += GRAVITY * delta;
      x += vx * delta;
      y += vy * delta;

      if (x < -40 || x > WORLD_WIDTH + 40 || y > WORLD_HEIGHT + 40) break;
      if (y > 0 && isSolidTerrainAt(x, y, this.state.terrainHoles)) break;
    }

    const targetDistance = Math.hypot(x - target.x, y - (target.y - 8));
    const allyPenalty = this.state.players
      .filter((item) => item.teamId === player.teamId && item.id !== player.id && item.hp > 0)
      .reduce((penalty, ally) => {
        const distance = Math.hypot(x - ally.x, y - (ally.y - 8));
        return penalty + Math.max(0, 85 - distance) * 2.4;
      }, 0);

    return {
      angle,
      power,
      impactX: x,
      impactY: y,
      score: targetDistance + allyPenalty
    };
  }

  private addAimingNoise(player: PlayerState, shot: SimulatedShot) {
    const difficulty = player.ai?.difficulty ?? "normal";
    const angleNoise = difficulty === "easy" ? 6 : difficulty === "normal" ? 2.8 : 0.9;
    const powerNoise = difficulty === "easy" ? 9 : difficulty === "normal" ? 4 : 1.4;
    const angle = shot.angle + (Math.random() * 2 - 1) * angleNoise;
    const power = shot.power + (Math.random() * 2 - 1) * powerNoise;
    return {
      angle: clamp(angle, player.x <= WORLD_WIDTH / 2 ? 5 : 95, player.x <= WORLD_WIDTH / 2 ? 85 : 175),
      power: clamp(power, MIN_POWER, MAX_POWER)
    };
  }

  private chooseTarget(player: PlayerState) {
    const enemies = this.state.players.filter((item) => item.teamId !== player.teamId && item.hp > 0);
    return enemies
      .map((enemy) => ({
        enemy,
        score: Math.hypot(enemy.x - player.x, enemy.y - player.y) + enemy.hp * 1.6
      }))
      .sort((a, b) => a.score - b.score)[0]?.enemy;
  }

  private explodeAt(x: number, y: number) {
    this.stopShot();
    const crater: TerrainCrater = { x, y, radius: EXPLOSION_RADIUS };
    this.state.terrainHoles.push(crater);
    const shooter = this.currentPlayer;
    const targetBeforeExplosion = this.chooseTarget(shooter);

    this.state.players.forEach((player) => {
      const distance = Math.hypot(x - player.x, y - (player.y - 8));
      if (distance < EXPLOSION_RADIUS * 2.25) {
        const damage = Math.round(lerp(44, 8, distance / (EXPLOSION_RADIUS * 2.25)));
        player.hp = clamp(player.hp - damage, 0, MAX_HP);
      }
      this.snapPlayerToGround(player);
    });

    if (shooter.kind === "computer" && targetBeforeExplosion) {
      shooter.ai?.memory.push({
        targetId: targetBeforeExplosion.id,
        angle: shooter.angle,
        power: shooter.power,
        impactX: x,
        impactY: y,
        targetX: targetBeforeExplosion.x,
        targetY: targetBeforeExplosion.y,
        missDistance: Math.hypot(x - targetBeforeExplosion.x, y - targetBeforeExplosion.y)
      });
      if (shooter.ai && shooter.ai.memory.length > 8) shooter.ai.memory.shift();
    }

    this.finishShot(x, y);
  }

  private finishShot(impactX?: number, impactY?: number) {
    this.stopShot();
    this.state.projectile = undefined;

    const winnerTeamId = this.getWinnerTeamId();
    if (winnerTeamId) {
      this.state.phase = "gameover";
      this.state.winnerTeamId = winnerTeamId;
      this.state.winnerId = this.state.players.find((player) => player.teamId === winnerTeamId && player.hp > 0)?.id;
      this.state.message = `${winnerTeamId === "A" ? "왼쪽 편" : "오른쪽 편"} 승리`;
      this.sync();
      return;
    }

    if (impactX !== undefined && impactY !== undefined) {
      this.state.message = `착탄 ${Math.round(impactX)}, ${Math.round(impactY)}`;
    }

    this.advanceTurn();
    this.sync();
  }

  private advanceTurn() {
    const alivePlayers = this.state.players.filter((player) => player.hp > 0);
    if (alivePlayers.length === 0) return;
    const currentIndex = this.state.players.findIndex((player) => player.id === this.state.activePlayerId);
    for (let offset = 1; offset <= this.state.players.length; offset += 1) {
      const candidate = this.state.players[(currentIndex + offset) % this.state.players.length];
      if (candidate.hp > 0 && (candidate.kind === "computer" || candidate.connected)) {
        this.state.activePlayerId = candidate.id;
        candidate.power = MIN_POWER;
        candidate.move = MAX_MOVE;
        this.state.wind = randomWind();
        this.state.phase = "aim";
        this.state.message = `${candidate.name} 턴`;
        return;
      }
    }
  }

  private tryMovePlayer(player: PlayerState, distance: number, commit = true) {
    if (player.move <= 0) return false;
    const requestedDistance = Math.sign(distance) * Math.min(Math.abs(distance), player.move);
    const targetX = clamp(player.x + requestedDistance, 34, WORLD_WIDTH - 34);
    const actualDistance = targetX - player.x;
    if (Math.abs(actualDistance) < 0.01) return false;

    if (
      this.state.players.some(
        (other) => other.id !== player.id && other.hp > 0 && Math.abs(targetX - other.x) < 48
      )
    ) {
      return false;
    }

    const targetGround = findGroundY(targetX, this.state.terrainHoles);
    const currentGround = findGroundY(player.x, this.state.terrainHoles);
    if (targetGround > WORLD_HEIGHT) return false;
    if (Math.abs(targetGround - currentGround) > MAX_CLIMB_STEP) return false;

    const bodyClear =
      !isSolidTerrainAt(targetX - 15, targetGround - 20, this.state.terrainHoles) &&
      !isSolidTerrainAt(targetX + 15, targetGround - 20, this.state.terrainHoles) &&
      !isSolidTerrainAt(targetX, targetGround - 34, this.state.terrainHoles);

    if (!bodyClear) return false;
    player.x = targetX;
    this.snapPlayerToGround(player);
    if (commit) player.move = clamp(player.move - Math.abs(actualDistance), 0, MAX_MOVE);
    return true;
  }

  private clampPlayerAngle(player: PlayerState) {
    player.angle = clamp(player.angle, player.x <= WORLD_WIDTH / 2 ? 5 : 95, player.x <= WORLD_WIDTH / 2 ? 85 : 175);
  }

  private canAct(socketId: string) {
    return (
      this.state.phase === "aim" &&
      this.currentPlayer.kind === "human" &&
      this.currentPlayer.socketId === socketId
    );
  }

  private get currentPlayer() {
    return this.state.players.find((player) => player.id === this.state.activePlayerId) ?? this.state.players[0];
  }

  private getPlayerBySocket(socketId: string) {
    return this.state.players.find((player) => player.socketId === socketId);
  }

  private createInitialState(hostSocketId: string): GameState {
    const state: GameState = {
      roomId: this.roomId,
      hostSocketId,
      phase: "waiting",
      activePlayerId: 0,
      wind: randomWind(),
      players: [],
      terrainHoles: [],
      message: "편을 나누고 게임을 시작하세요."
    };
    return state;
  }

  private createPlayer(kind: "human" | "computer", socketId?: string, difficulty: AIDifficulty = "normal") {
    const id = this.nextPlayerId;
    this.nextPlayerId += 1;
    const slotIndex = this.state.players.length;
    const teamId = (slotIndex === 0 ? "A" : "B") as TeamId;
    const player: PlayerState = {
      id,
      slotIndex,
      kind,
      teamId,
      name: kind === "human" ? `플레이어 ${slotIndex + 1}` : `컴퓨터 ${slotIndex + 1}`,
      color: PLAYER_COLORS[slotIndex % PLAYER_COLORS.length],
      socketId,
      connected: kind === "computer" || Boolean(socketId),
      x: SPAWN_X[slotIndex % SPAWN_X.length],
      y: 0,
      slope: 0,
      angle: SPAWN_X[slotIndex % SPAWN_X.length] <= WORLD_WIDTH / 2 ? 45 : 135,
      power: MIN_POWER,
      move: MAX_MOVE,
      hp: MAX_HP,
      ai:
        kind === "computer"
          ? {
              difficulty,
              memory: []
            }
          : undefined
    };
    this.snapPlayerToGround(player);
    return player;
  }

  private resetCombatState() {
    this.stopShot();
    this.clearAI();
    this.state.terrainHoles = [];
    this.state.projectile = undefined;
    this.state.winnerId = undefined;
    this.state.winnerTeamId = undefined;
    this.state.lastShotPower = undefined;
    this.state.wind = randomWind();
    const sideCounts = new Map<TeamId, number>();
    this.state.players.forEach((player, index) => {
      player.slotIndex = index;
      const sideIndex = sideCounts.get(player.teamId) ?? 0;
      sideCounts.set(player.teamId, sideIndex + 1);
      player.x = getSpawnXForTeam(player.teamId, sideIndex, index);
      player.angle = player.x <= WORLD_WIDTH / 2 ? 45 : 135;
      player.power = MIN_POWER;
      player.move = MAX_MOVE;
      player.hp = MAX_HP;
      this.snapPlayerToGround(player);
    });
  }

  private snapPlayerToGround(player: PlayerState, holes = this.state.terrainHoles) {
    const ground = findGroundY(player.x, holes);
    player.y = ground - 8;
    player.slope = findGroundSlope(player.x, holes);
    if (player.y > WORLD_HEIGHT - 20) {
      player.hp = 0;
    }
  }

  private getWinnerTeamId() {
    const aliveTeams = new Set(this.state.players.filter((player) => player.hp > 0).map((player) => player.teamId));
    return aliveTeams.size === 1 ? [...aliveTeams][0] : undefined;
  }

  private canStartMatch() {
    if (this.state.players.length < 2) return false;
    const teams = new Set(this.state.players.map((player) => player.teamId));
    const humans = this.state.players.filter((player) => player.kind === "human" && player.connected);
    return teams.size >= 2 && humans.length >= 1;
  }

  private isHost(socketId: string) {
    return this.state.hostSocketId === socketId;
  }

  private reindexSlots() {
    this.state.players.forEach((player, index) => {
      player.slotIndex = index;
    });
  }

  private sync(allowAI = true) {
    this.broadcast(this.state);
    if (allowAI) this.maybeScheduleAI();
  }

  private maybeScheduleAI() {
    this.clearAI();
    if (this.state.phase !== "aim" || this.currentPlayer.kind !== "computer") return;
    this.aiTimeout = setTimeout(() => this.runComputerTurn(), 780);
  }

  private clearAI() {
    if (!this.aiTimeout) return;
    clearTimeout(this.aiTimeout);
    this.aiTimeout = undefined;
  }

  private stopShot() {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = undefined;
  }
}

function randomWind() {
  return Math.random() * 3.6 - 1.8;
}

function getSpawnXForTeam(teamId: TeamId, sideIndex: number, fallbackIndex: number) {
  if (teamId === "A") return LEFT_SPAWN_X[sideIndex % LEFT_SPAWN_X.length];
  if (teamId === "B") return RIGHT_SPAWN_X[sideIndex % RIGHT_SPAWN_X.length];
  return SPAWN_X[fallbackIndex % SPAWN_X.length];
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * clamp(t, 0, 1);
}
