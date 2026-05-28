import Phaser from "phaser";
import { io, type Socket } from "socket.io-client";
import {
  DEFAULT_TARGET_POWER,
  MAX_HP,
  MAX_POWER,
  MIN_POWER,
  WORLD_HEIGHT,
  WORLD_WIDTH
} from "./shared/constants.js";
import { baseTerrainY, clamp } from "./shared/terrain.js";
import type {
  ClientToServerEvents,
  GameState,
  PlayerId,
  ServerToClientEvents,
  TerrainCrater
} from "./shared/types.js";
import "./styles.css";

type ProjectileView = {
  sprite: Phaser.GameObjects.Arc;
};

let socket: Socket<ServerToClientEvents, ClientToServerEvents>;
let localPlayerId: PlayerId | undefined;
let currentState: GameState | undefined;
let battleScene: BattleScene | undefined;

class BattleScene extends Phaser.Scene {
  private terrainCanvas!: HTMLCanvasElement;
  private terrainContext!: CanvasRenderingContext2D;
  private terrainTexture!: Phaser.Textures.CanvasTexture;
  private terrainImage!: Phaser.GameObjects.Image;
  private tankViews: Phaser.GameObjects.Container[] = [];
  private projectile?: ProjectileView;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private fireKey!: Phaser.Input.Keyboard.Key;
  private restartKey!: Phaser.Input.Keyboard.Key;
  private statusText!: Phaser.GameObjects.Text;
  private powerTrack?: HTMLElement;
  private isChargingShot = false;
  private localPower = MIN_POWER;
  private targetPowerMarker = DEFAULT_TARGET_POWER;
  private appliedCraterCount = 0;
  private lastMoveSend = 0;
  private lastAngleSend = 0;

  constructor() {
    super("battle");
  }

  create() {
    battleScene = this;
    this.cameras.main.setBackgroundColor("#78bde7");
    this.createSky();
    this.createTerrain([]);
    this.createTankViews();

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.fireKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.restartKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.statusText = this.add
      .text(WORLD_WIDTH / 2, 84, "Create or join a room", {
        fontFamily: "Arial",
        fontSize: "22px",
        color: "#ffffff",
        stroke: "#0c1720",
        strokeThickness: 5
      })
      .setOrigin(0.5)
      .setDepth(5);

    this.setupPowerMarkerControls();
    this.applyState(currentState);
  }

  update(time: number, deltaMs: number) {
    if (!currentState) return;

    if (Phaser.Input.Keyboard.JustDown(this.restartKey)) {
      socket.emit("restartGame");
      return;
    }

    if (this.canControl()) {
      this.updateNetworkInput(time, deltaMs / 1000);
    }

    this.updateProjectile();
    this.refreshHud();
  }

  applyState(state?: GameState) {
    if (!state) return;
    currentState = state;

    if (state.terrainHoles.length !== this.appliedCraterCount) {
      const newHoles = state.terrainHoles.slice(this.appliedCraterCount);
      this.createTerrain(state.terrainHoles);
      newHoles.forEach((hole) => this.playExplosion(hole));
      this.appliedCraterCount = state.terrainHoles.length;
    }

    state.players.forEach((player, index) => {
      const view = this.tankViews[index];
      if (!view) return;
      view.setPosition(player.x, player.y);
      view.setRotation(player.slope);
      view.setAlpha(player.hp <= 0 ? 0.35 : index === state.activePlayerId ? 1 : 0.72);
      const turret = view.list[1] as Phaser.GameObjects.Rectangle;
      turret.rotation = Phaser.Math.DegToRad(-player.angle) - player.slope;
      turret.setFillStyle(index === state.activePlayerId ? 0xf8fbff : 0x263342);
    });

    if (state.phase !== "flying") {
      this.projectile?.sprite.destroy();
      this.projectile = undefined;
    }

    this.statusText.setText(this.getStatusMessage(state));
    this.refreshHud();
  }

  private updateNetworkInput(time: number, delta: number) {
    const direction = this.cursors.left.isDown ? -1 : this.cursors.right.isDown ? 1 : 0;
    if (direction && time - this.lastMoveSend > 34) {
      socket.emit("playerMove", direction);
      this.lastMoveSend = time;
    }

    const angleDirection = this.cursors.up.isDown ? 1 : this.cursors.down.isDown ? -1 : 0;
    if (angleDirection && time - this.lastAngleSend > 34) {
      socket.emit("setAngle", angleDirection);
      this.lastAngleSend = time;
    }

    if (Phaser.Input.Keyboard.JustDown(this.fireKey)) {
      this.isChargingShot = true;
      this.localPower = MIN_POWER;
    }

    if (this.isChargingShot && this.fireKey.isDown) {
      this.localPower = clamp(this.localPower + 82 * delta, MIN_POWER, MAX_POWER);
    }

    if (this.isChargingShot && Phaser.Input.Keyboard.JustUp(this.fireKey)) {
      socket.emit("releaseShot", this.localPower);
      this.isChargingShot = false;
    }
  }

  private updateProjectile() {
    if (!currentState?.projectile) return;

    if (!this.projectile) {
      this.projectile = {
        sprite: this.add.circle(0, 0, 5, 0xf8f3d2, 1).setDepth(4)
      };
      this.projectile.sprite.setStrokeStyle(2, 0x332819, 0.8);
    }

    this.projectile.sprite.setPosition(currentState.projectile.x, currentState.projectile.y);
  }

  private createSky() {
    const sky = this.add.graphics();
    sky.fillGradientStyle(0x7bc4ec, 0x7bc4ec, 0xdff2ff, 0xdff2ff, 1);
    sky.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    const sun = this.add.circle(820, 88, 34, 0xffdf79, 0.95);
    sun.setStrokeStyle(4, 0xfff3bd, 0.35);

    const mountain = this.add.graphics();
    mountain.fillStyle(0x5d91a9, 0.45);
    mountain.fillTriangle(20, 380, 180, 160, 348, 380);
    mountain.fillTriangle(248, 380, 472, 188, 690, 380);
    mountain.fillTriangle(570, 380, 768, 176, 980, 380);
    mountain.fillStyle(0xffffff, 0.35);
    mountain.fillTriangle(180, 160, 138, 218, 218, 218);
    mountain.fillTriangle(768, 176, 718, 238, 810, 238);
  }

  private createTerrain(holes: TerrainCrater[]) {
    if (!this.terrainTexture) {
      const texture = this.textures.createCanvas("terrain", WORLD_WIDTH, WORLD_HEIGHT);
      if (!texture) throw new Error("Failed to create terrain texture.");
      this.terrainTexture = texture;
      this.terrainCanvas = this.terrainTexture.getSourceImage() as HTMLCanvasElement;
      this.terrainContext = this.terrainCanvas.getContext("2d", { willReadFrequently: true })!;
      this.terrainImage = this.add.image(0, 0, "terrain").setOrigin(0);
    }

    const points: Array<{ x: number; y: number }> = [];
    for (let x = 0; x <= WORLD_WIDTH; x += 12) {
      points.push({ x, y: baseTerrainY(x) });
    }

    const ctx = this.terrainContext;
    ctx.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    ctx.beginPath();
    ctx.moveTo(0, WORLD_HEIGHT);
    points.forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.lineTo(WORLD_WIDTH, WORLD_HEIGHT);
    ctx.closePath();
    const soil = ctx.createLinearGradient(0, 290, 0, WORLD_HEIGHT);
    soil.addColorStop(0, "#70a33f");
    soil.addColorStop(0.14, "#528f35");
    soil.addColorStop(0.15, "#7d5a34");
    soil.addColorStop(1, "#3f2c20");
    ctx.fillStyle = soil;
    ctx.fill();

    holes.forEach((hole) => {
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(hole.x, hole.y, hole.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    this.terrainTexture.refresh();
  }

  private createTankViews() {
    this.tankViews = [0, 1].map((index) => {
      const color = index === 0 ? 0x45c7ff : 0xff9152;
      const container = this.add.container(-100, -100).setDepth(3);
      const body = this.add.graphics();
      body.fillStyle(color, 1);
      body.fillRoundedRect(-19, -15, 38, 20, 6);
      body.fillStyle(0x263342, 1);
      body.fillRoundedRect(-23, 1, 46, 9, 5);
      body.fillStyle(0xffffff, 0.9);
      body.fillCircle(-10, 7, 3);
      body.fillCircle(10, 7, 3);
      const turret = this.add.rectangle(0, -14, 30, 6, 0x263342).setOrigin(0, 0.5);
      container.add([body, turret]);
      return container;
    });
  }

  private playExplosion(hole: TerrainCrater) {
    const blast = this.add.circle(hole.x, hole.y, 12, 0xfff0a3, 0.88).setDepth(6);
    const shockwave = this.add.circle(hole.x, hole.y, hole.radius, 0xffffff, 0).setDepth(6);
    shockwave.setStrokeStyle(4, 0xffffff, 0.5);
    this.tweens.add({
      targets: blast,
      radius: hole.radius * 1.25,
      alpha: 0,
      duration: 260,
      ease: "Quad.easeOut",
      onComplete: () => blast.destroy()
    });
    this.tweens.add({
      targets: shockwave,
      scaleX: 1.28,
      scaleY: 1.28,
      alpha: 0,
      duration: 260,
      ease: "Quad.easeOut",
      onComplete: () => shockwave.destroy()
    });
    this.cameras.main.shake(170, 0.006);
  }

  private refreshHud() {
    if (!currentState) return;
    const currentPlayer = currentState.players[currentState.activePlayerId];
    const hudPlayer = localPlayerId === undefined ? currentPlayer : currentState.players[localPlayerId];
    const shownPower = this.isChargingShot ? this.localPower : currentPlayer.power;
    const hp0 = document.querySelector<HTMLSpanElement>("#hp-0")!;
    const hp1 = document.querySelector<HTMLSpanElement>("#hp-1")!;
    const hpText0 = document.querySelector<HTMLElement>("#hp-text-0")!;
    const hpText1 = document.querySelector<HTMLElement>("#hp-text-1")!;
    const turn = document.querySelector<HTMLElement>("#turn")!;
    const roomLabel = document.querySelector<HTMLElement>("#room-label")!;
    const wind = document.querySelector<HTMLElement>("#wind")!;
    const angle = document.querySelector<HTMLElement>("#angle")!;
    const power = document.querySelector<HTMLElement>("#power")!;
    const powerValue = document.querySelector<HTMLElement>("#power-value")!;
    const powerFill = document.querySelector<HTMLElement>("#power-fill")!;
    const energyFill = document.querySelector<HTMLElement>("#energy-fill")!;
    const energyValue = document.querySelector<HTMLElement>("#energy-value")!;
    const moveFill = document.querySelector<HTMLElement>("#move-fill")!;
    const moveValue = document.querySelector<HTMLElement>("#move-value")!;
    const lastShotMarker = document.querySelector<HTMLElement>("#last-shot-marker")!;
    const targetMarker = document.querySelector<HTMLElement>("#target-marker")!;
    const powerTrack = document.querySelector<HTMLElement>("#power-track")!;
    const consoleWind = document.querySelector<HTMLElement>("#console-wind")!;
    const consoleAngle = document.querySelector<HTMLElement>("#console-angle")!;
    const angleNeedle = document.querySelector<HTMLElement>("#angle-needle")!;
    const lastShotValue = document.querySelector<HTMLElement>("#last-shot-value")!;

    hp0.style.width = `${currentState.players[0].hp}%`;
    hp1.style.width = `${currentState.players[1].hp}%`;
    hpText0.textContent = `${currentState.players[0].hp}`;
    hpText1.textContent = `${currentState.players[1].hp}`;
    turn.textContent = currentState.message;
    roomLabel.textContent = `Room ${currentState.roomId}`;
    wind.textContent = `Wind ${currentState.wind >= 0 ? ">" : "<"} ${Math.abs(currentState.wind).toFixed(1)}`;
    angle.textContent = `Angle ${Math.round(currentPlayer.angle)}`;
    power.textContent = `Power ${Math.round(shownPower)}`;
    powerValue.textContent = `${Math.round(shownPower)}`;
    energyValue.textContent = `${hudPlayer.hp}`;
    energyFill.style.width = `${hudPlayer.hp}%`;
    moveValue.textContent = `${Math.round(hudPlayer.move)}`;
    moveFill.style.width = `${hudPlayer.move}%`;
    powerFill.style.width = `${this.powerToPercent(shownPower)}%`;
    targetMarker.style.left = `${this.powerToPercent(this.targetPowerMarker)}%`;
    powerTrack.setAttribute("aria-valuenow", `${Math.round(this.targetPowerMarker)}`);
    consoleWind.textContent = `${currentState.wind >= 0 ? ">" : "<"} ${Math.abs(currentState.wind).toFixed(1)}`;
    consoleAngle.textContent = `${Math.round(currentPlayer.angle)}`;
    angleNeedle.style.setProperty("--dial-angle", `${this.angleToDialRotation(currentPlayer.angle)}deg`);
    lastShotValue.textContent =
      currentState.lastShotPower === undefined ? "--" : `${Math.round(currentState.lastShotPower)}`;

    if (currentState.lastShotPower === undefined) {
      lastShotMarker.style.display = "none";
    } else {
      lastShotMarker.style.display = "block";
      lastShotMarker.style.left = `${this.powerToPercent(currentState.lastShotPower)}%`;
    }
  }

  private setupPowerMarkerControls() {
    this.powerTrack = document.querySelector<HTMLElement>("#power-track")!;

    const updateMarkerFromPointer = (event: PointerEvent) => {
      if (!this.powerTrack) return;
      const rect = this.powerTrack.getBoundingClientRect();
      const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      this.targetPowerMarker = MIN_POWER + ratio * (MAX_POWER - MIN_POWER);
      this.refreshHud();
    };

    this.powerTrack.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.powerTrack?.setPointerCapture(event.pointerId);
      updateMarkerFromPointer(event);
    });

    this.powerTrack.addEventListener("pointermove", (event) => {
      if (!this.powerTrack?.hasPointerCapture(event.pointerId)) return;
      updateMarkerFromPointer(event);
    });
  }

  private canControl() {
    return (
      currentState?.phase === "aim" &&
      localPlayerId !== undefined &&
      currentState.activePlayerId === localPlayerId
    );
  }

  private getStatusMessage(state: GameState) {
    if (state.phase === "waiting") return state.message;
    if (localPlayerId === undefined) return state.message;
    if (state.phase === "gameover") return state.message;
    if (state.phase === "flying") return "Shot in flight";
    return state.activePlayerId === localPlayerId ? "Your turn" : "Opponent turn";
  }

  private powerToPercent(power: number) {
    return clamp(((power - MIN_POWER) / (MAX_POWER - MIN_POWER)) * 100, 0, 100);
  }

  private angleToDialRotation(angle: number) {
    if (!currentState) return -45;
    const normalized = currentState.activePlayerId === 0 ? angle : 180 - angle;
    return clamp(normalized - 90, -85, -5);
  }
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game",
  width: WORLD_WIDTH,
  height: WORLD_HEIGHT,
  backgroundColor: "#101721",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  scene: [BattleScene]
};

new Phaser.Game(config);
setupSocket();
setupLobby();

function setupSocket() {
  const serverUrl =
    import.meta.env.VITE_SERVER_URL ??
    `${window.location.protocol}//${window.location.hostname}:3000`;
  socket = io(serverUrl);

  socket.on("connect", () => {
    setLobbyStatus("서버 연결됨. 방을 만들거나 입장하세요.");
  });

  socket.on("disconnect", () => {
    setLobbyStatus("서버 연결이 끊어졌습니다.");
  });

  socket.on("joinedRoom", (payload) => {
    if (!payload.ok) return;
    applyJoinPayload(payload);
  });

  socket.on("stateSync", (state) => {
    currentState = state;
    battleScene?.applyState(state);
  });

  socket.on("errorMessage", setLobbyStatus);
}

function setupLobby() {
  const createButton = document.querySelector<HTMLButtonElement>("#create-room")!;
  const joinButton = document.querySelector<HTMLButtonElement>("#join-room")!;
  const input = document.querySelector<HTMLInputElement>("#room-code")!;

  createButton.addEventListener("click", () => {
    socket.emit("createRoom", applyJoinPayload);
  });

  joinButton.addEventListener("click", () => {
    const roomId = input.value.trim().toUpperCase();
    if (!roomId) {
      setLobbyStatus("방 코드를 입력하세요.");
      return;
    }
    socket.emit("joinRoom", roomId, applyJoinPayload);
  });
}

function applyJoinPayload(payload: {
  ok: boolean;
  roomId?: string;
  playerId?: PlayerId;
  message?: string;
  state?: GameState;
}) {
  if (!payload.ok) {
    setLobbyStatus(payload.message ?? "입장에 실패했습니다.");
    return;
  }

  localPlayerId = payload.playerId;
  document.querySelector<HTMLElement>("#lobby")!.classList.add("hidden");
  if (payload.state) {
    currentState = payload.state;
    battleScene?.applyState(payload.state);
  }
}

function setLobbyStatus(message: string) {
  document.querySelector<HTMLElement>("#lobby-status")!.textContent = message;
}
