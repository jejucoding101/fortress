import {
  EXPLOSION_RADIUS,
  GRAVITY,
  MAX_CLIMB_STEP,
  MAX_HP,
  MAX_MOVE,
  MAX_POWER,
  MIN_POWER,
  SHOT_STEP_MS,
  WORLD_HEIGHT,
  WORLD_WIDTH
} from "../src/shared/constants.js";
import { clamp, findGroundSlope, findGroundY, isSolidTerrainAt } from "../src/shared/terrain.js";
import type { GameState, PlayerState, TerrainCrater } from "../src/shared/types.js";

type Broadcast = (state: GameState) => void;

export class GameSession {
  readonly roomId: string;
  private broadcast: Broadcast;
  private interval?: NodeJS.Timeout;
  state: GameState;

  constructor(roomId: string, broadcast: Broadcast) {
    this.roomId = roomId;
    this.broadcast = broadcast;
    this.state = this.createInitialState();
  }

  addPlayer(socketId: string) {
    const openPlayer = this.state.players.find((player) => !player.socketId);
    if (!openPlayer) return undefined;
    openPlayer.socketId = socketId;
    openPlayer.connected = true;
    this.updatePhaseMessage();
    this.sync();
    return openPlayer.id;
  }

  removePlayer(socketId: string) {
    const player = this.getPlayerBySocket(socketId);
    if (!player) return;
    player.connected = false;
    this.state.message = `${player.name} disconnected`;
    if (this.state.phase !== "gameover") {
      this.stopShot();
      this.state.projectile = undefined;
      this.state.phase = "waiting";
    }
    this.sync();
  }

  restart(socketId: string) {
    if (!this.getPlayerBySocket(socketId)) return;
    const playerSockets = this.state.players.map((player) => player.socketId);
    const connected = this.state.players.map((player) => player.connected);
    this.stopShot();
    this.state = this.createInitialState();
    this.state.players.forEach((player, index) => {
      player.socketId = playerSockets[index];
      player.connected = connected[index];
    });
    this.updatePhaseMessage();
    this.sync();
  }

  move(socketId: string, direction: -1 | 1) {
    if (!this.canAct(socketId)) return;
    const player = this.currentPlayer;
    if (player.move <= 0) return;

    const distance = direction * Math.min(3.2, player.move);
    const targetX = clamp(player.x + distance, 34, WORLD_WIDTH - 34);
    const actualDistance = targetX - player.x;
    if (Math.abs(actualDistance) < 0.01) return;

    const opponent = this.state.players[player.id === 0 ? 1 : 0];
    if (Math.abs(targetX - opponent.x) < 48) return;

    const targetGround = findGroundY(targetX, this.state.terrainHoles);
    const currentGround = findGroundY(player.x, this.state.terrainHoles);
    if (targetGround > WORLD_HEIGHT) return;
    if (Math.abs(targetGround - currentGround) > MAX_CLIMB_STEP) return;

    const bodyClear =
      !isSolidTerrainAt(targetX - 15, targetGround - 20, this.state.terrainHoles) &&
      !isSolidTerrainAt(targetX + 15, targetGround - 20, this.state.terrainHoles) &&
      !isSolidTerrainAt(targetX, targetGround - 34, this.state.terrainHoles);

    if (!bodyClear) return;
    player.x = targetX;
    this.snapPlayerToGround(player);
    player.move = clamp(player.move - Math.abs(actualDistance), 0, MAX_MOVE);
    this.sync();
  }

  setAngle(socketId: string, direction: -1 | 1) {
    if (!this.canAct(socketId)) return;
    const player = this.currentPlayer;
    const angleDirection = player.id === 0 ? 1 : -1;
    player.angle += direction * angleDirection * 2.2;
    player.angle = clamp(player.angle, player.id === 0 ? 5 : 95, player.id === 0 ? 85 : 175);
    this.sync();
  }

  releaseShot(socketId: string, power: number) {
    if (!this.canAct(socketId)) return;
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
    this.state.message = `${player.name} fired`;
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
        this.finishShot();
        return;
      }

      if (projectile.y > 0 && isSolidTerrainAt(projectile.x, projectile.y, this.state.terrainHoles)) {
        this.explodeAt(projectile.x, projectile.y);
        return;
      }

      this.sync();
    }, SHOT_STEP_MS);
  }

  private explodeAt(x: number, y: number) {
    this.stopShot();
    const crater: TerrainCrater = { x, y, radius: EXPLOSION_RADIUS };
    this.state.terrainHoles.push(crater);

    this.state.players.forEach((player) => {
      const distance = Math.hypot(x - player.x, y - (player.y - 8));
      if (distance < EXPLOSION_RADIUS * 2.25) {
        const damage = Math.round(lerp(44, 8, distance / (EXPLOSION_RADIUS * 2.25)));
        player.hp = clamp(player.hp - damage, 0, MAX_HP);
      }
      this.snapPlayerToGround(player);
    });

    this.finishShot();
  }

  private finishShot() {
    this.stopShot();
    this.state.projectile = undefined;
    const defeated = this.state.players.find((player) => player.hp <= 0);

    if (defeated) {
      const winner = this.state.players.find((player) => player.hp > 0);
      this.state.phase = "gameover";
      this.state.winnerId = winner?.id;
      this.state.message = `${winner?.name ?? "No one"} wins`;
      this.sync();
      return;
    }

    this.state.activePlayerId = this.state.activePlayerId === 0 ? 1 : 0;
    const nextPlayer = this.currentPlayer;
    nextPlayer.power = MIN_POWER;
    nextPlayer.move = MAX_MOVE;
    this.state.wind = randomWind();
    this.state.phase = "aim";
    this.state.message = `${nextPlayer.name} turn`;
    this.sync();
  }

  private stopShot() {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = undefined;
  }

  private canAct(socketId: string) {
    return this.state.phase === "aim" && this.currentPlayer.socketId === socketId;
  }

  private get currentPlayer() {
    return this.state.players[this.state.activePlayerId];
  }

  private getPlayerBySocket(socketId: string) {
    return this.state.players.find((player) => player.socketId === socketId);
  }

  private createInitialState(): GameState {
    const players: [PlayerState, PlayerState] = [
      {
        id: 0,
        name: "P1",
        color: 0x45c7ff,
        connected: false,
        x: 178,
        y: 0,
        slope: 0,
        angle: 45,
        power: MIN_POWER,
        move: MAX_MOVE,
        hp: MAX_HP
      },
      {
        id: 1,
        name: "P2",
        color: 0xff9152,
        connected: false,
        x: 782,
        y: 0,
        slope: 0,
        angle: 135,
        power: MIN_POWER,
        move: MAX_MOVE,
        hp: MAX_HP
      }
    ];

    const state: GameState = {
      roomId: this.roomId,
      phase: "waiting",
      activePlayerId: 0,
      wind: randomWind(),
      players,
      terrainHoles: [],
      message: "Waiting for opponent"
    };

    players.forEach((player) => this.snapPlayerToGround(player, state.terrainHoles));
    return state;
  }

  private snapPlayerToGround(player: PlayerState, holes = this.state.terrainHoles) {
    const ground = findGroundY(player.x, holes);
    player.y = ground - 8;
    player.slope = findGroundSlope(player.x, holes);
    if (player.y > WORLD_HEIGHT - 20) {
      player.hp = 0;
    }
  }

  private updatePhaseMessage() {
    if (this.state.players.every((player) => player.connected)) {
      this.state.phase = "aim";
      this.state.message = `${this.currentPlayer.name} turn`;
    } else {
      this.state.phase = "waiting";
      this.state.message = "Waiting for opponent";
    }
  }

  private sync() {
    this.broadcast(this.state);
  }
}

function randomWind() {
  return Math.random() * 3.6 - 1.8;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * clamp(t, 0, 1);
}
