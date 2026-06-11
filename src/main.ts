import Phaser from "phaser";
import { io, type Socket } from "socket.io-client";
import {
  DEFAULT_TARGET_POWER,
  MAX_POWER,
  MIN_POWER,
  TEAM_IDS,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
  WORLD_HEIGHT,
  WORLD_WIDTH
} from "./shared/constants.js";
import { clamp, getGroundSurfaceY, getTerrainIslands } from "./shared/terrain.js";
import type {
  ClientToServerEvents,
  GameState,
  PlayerId,
  PlayerState,
  ServerToClientEvents,
  TeamId,
  TerrainCrater
} from "./shared/types.js";
import "./styles.css";

type ProjectileView = {
  sprite: Phaser.GameObjects.Arc;
};

type Snowflake = {
  sprite: Phaser.GameObjects.Arc;
  speed: number;
  drift: number;
  phase: number;
};

type TankView = {
  root: Phaser.GameObjects.Container;
  turret: Phaser.GameObjects.Rectangle;
  nameLabel: Phaser.GameObjects.Text;
  energyFrame: Phaser.GameObjects.Rectangle;
  energyFill: Phaser.GameObjects.Rectangle;
};

let socket: Socket<ServerToClientEvents, ClientToServerEvents>;
let localPlayerId: PlayerId | undefined;
let currentState: GameState | undefined;
let battleScene: BattleScene | undefined;
let gameMenuLockedByGameOver = false;

class BattleScene extends Phaser.Scene {
  private terrainCanvas!: HTMLCanvasElement;
  private terrainContext!: CanvasRenderingContext2D;
  private terrainTexture!: Phaser.Textures.CanvasTexture;
  private tankViews: TankView[] = [];
  private snowflakes: Snowflake[] = [];
  private projectile?: ProjectileView;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private fireKey!: Phaser.Input.Keyboard.Key;
  private restartKey!: Phaser.Input.Keyboard.Key;
  private menuKey!: Phaser.Input.Keyboard.Key;
  private statusText!: Phaser.GameObjects.Text;
  private powerTrack?: HTMLElement;
  private isChargingShot = false;
  private localPower = MIN_POWER;
  private targetPowerMarker = DEFAULT_TARGET_POWER;
  private appliedCraterCount = 0;
  private lastMoveSend = 0;
  private lastAngleSend = 0;
  private hoverEdgeDirection = 0;
  private hoverEdgeStartTime = 0;
  private previousPhase?: GameState["phase"];
  private previousActivePlayerId?: PlayerId;
  private appliedTerrainSeed?: number;

  constructor() {
    super("battle");
  }

  create() {
    battleScene = this;
    this.cameras.main.setBackgroundColor("#78bde7");
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.createSky();
    this.createWeatherParticles();
    this.createTerrain([], currentState?.terrainSeed ?? 1);
    this.ensureTankViews(2);

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.fireKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.restartKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.menuKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.statusText = this.add
      .text(VIEWPORT_WIDTH / 2, 84, "Create or join a room", {
        fontFamily: "Arial",
        fontSize: "22px",
        color: "#ffffff",
        stroke: "#0c1720",
        strokeThickness: 5
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
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

    if (Phaser.Input.Keyboard.JustDown(this.menuKey)) {
      toggleGameMenu();
      return;
    }

    if (this.canControl()) {
      this.updateNetworkInput(time, deltaMs / 1000);
    }

    this.updateCamera(time, deltaMs / 1000);
    this.updateProjectile();
    this.updateWeatherParticles(deltaMs / 1000);
    this.refreshHud();
  }

  applyState(state?: GameState) {
    if (!state) return;
    currentState = state;
    updateLobbyState(state);
    this.ensureTankViews(state.players.length);
    this.handleCameraStateTransition(state);

    if (
      state.terrainSeed !== this.appliedTerrainSeed ||
      state.terrainHoles.length !== this.appliedCraterCount
    ) {
      const newHoles = state.terrainHoles.slice(this.appliedCraterCount);
      this.createTerrain(state.terrainHoles, state.terrainSeed);
      if (state.terrainSeed === this.appliedTerrainSeed) {
        newHoles.forEach((hole) => this.playExplosion(hole));
      }
      this.appliedTerrainSeed = state.terrainSeed;
      this.appliedCraterCount = state.terrainHoles.length;
    }

    state.players.forEach((player, index) => {
      const view = this.tankViews[index];
      if (!view) return;
      view.root.setPosition(player.x, player.y);
      view.root.setRotation(player.slope);
      view.root.setAlpha(player.hp <= 0 ? 0.35 : player.id === state.activePlayerId ? 1 : 0.72);
      view.turret.rotation = Phaser.Math.DegToRad(-player.angle) - player.slope;
      view.turret.setFillStyle(player.id === state.activePlayerId ? 0xf8fbff : 0x263342);
      view.nameLabel.setText(player.name);
      view.nameLabel.setRotation(-player.slope);
      view.energyFrame.setRotation(-player.slope);
      view.energyFill.setRotation(-player.slope);
      view.energyFill.width = Phaser.Math.Clamp((player.hp / 100) * 44, 0, 44);
      view.energyFill.x = -22 + view.energyFill.width / 2;
      view.energyFill.setFillStyle(player.hp > 35 ? 0x8df05f : 0xffa33d);
    });

    if (state.phase !== "flying") {
      this.projectile?.sprite.destroy();
      this.projectile = undefined;
    }

    this.statusText.setText(this.getStatusMessage(state));
    this.refreshHud();
    syncGameMenuToState(state);
  }

  private updateCamera(time: number, delta: number) {
    if (!currentState) return;

    if (currentState.phase === "flying" && currentState.projectile) {
      const targetScrollX = Phaser.Math.Clamp(
        currentState.projectile.x - VIEWPORT_WIDTH / 2,
        0,
        WORLD_WIDTH - VIEWPORT_WIDTH
      );
      this.cameras.main.scrollX = Phaser.Math.Linear(this.cameras.main.scrollX, targetScrollX, 0.18);
      return;
    }

    if (currentState.phase !== "aim") {
      this.hoverEdgeDirection = 0;
      this.hoverEdgeStartTime = 0;
      return;
    }

    const pointer = this.input.activePointer;
    const edgeThreshold = 28;
    const nextDirection =
      pointer.x <= edgeThreshold ? -1 : pointer.x >= VIEWPORT_WIDTH - edgeThreshold ? 1 : 0;

    if (nextDirection !== this.hoverEdgeDirection) {
      this.hoverEdgeDirection = nextDirection;
      this.hoverEdgeStartTime = nextDirection === 0 ? 0 : time;
    }

    if (!nextDirection || time - this.hoverEdgeStartTime < 250) {
      return;
    }

    const scrollSpeed = 540;
    const nextScrollX = this.cameras.main.scrollX + nextDirection * scrollSpeed * delta;
    this.cameras.main.scrollX = Phaser.Math.Clamp(nextScrollX, 0, WORLD_WIDTH - VIEWPORT_WIDTH);
  }

  private handleCameraStateTransition(state: GameState) {
    const phaseChanged = this.previousPhase !== state.phase;
    const activePlayerChanged = this.previousActivePlayerId !== state.activePlayerId;

    if ((phaseChanged && state.phase === "aim") || (state.phase === "aim" && activePlayerChanged)) {
      const activePlayer = getActivePlayer(state);
      if (activePlayer) {
        this.centerCameraOnX(activePlayer.x);
      }
    }

    if (phaseChanged && state.phase === "flying") {
      const activePlayer = getActivePlayer(state);
      if (activePlayer) {
        this.centerCameraOnX(activePlayer.x);
      }
    }

    this.previousPhase = state.phase;
    this.previousActivePlayerId = state.activePlayerId;
  }

  private centerCameraOnX(targetX: number) {
    this.cameras.main.scrollX = Phaser.Math.Clamp(
      targetX - VIEWPORT_WIDTH / 2,
      0,
      WORLD_WIDTH - VIEWPORT_WIDTH
    );
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

  private createWeatherParticles() {
    this.snowflakes.forEach((flake) => flake.sprite.destroy());
    this.snowflakes = [];

    for (let index = 0; index < 42; index += 1) {
      const size = Phaser.Math.FloatBetween(1.2, 2.8);
      const sprite = this.add
        .circle(
          Phaser.Math.Between(0, WORLD_WIDTH),
          Phaser.Math.Between(-WORLD_HEIGHT, WORLD_HEIGHT),
          size,
          0xf4fbff,
          Phaser.Math.FloatBetween(0.34, 0.78)
        )
        .setDepth(2);
      this.snowflakes.push({
        sprite,
        speed: Phaser.Math.FloatBetween(18, 52),
        drift: Phaser.Math.FloatBetween(10, 32),
        phase: Phaser.Math.FloatBetween(0, Math.PI * 2)
      });
    }
  }

  private updateWeatherParticles(delta: number) {
    const wind = currentState?.wind ?? 0;
    this.snowflakes.forEach((flake) => {
      flake.phase += delta * 1.8;
      flake.sprite.x += wind * flake.drift * delta + Math.sin(flake.phase) * 8 * delta;
      flake.sprite.y += flake.speed * delta;

      if (flake.sprite.y > WORLD_HEIGHT + 8) {
        flake.sprite.y = Phaser.Math.Between(-80, -8);
        flake.sprite.x = Phaser.Math.Between(0, WORLD_WIDTH);
      }

      if (flake.sprite.x < -12) flake.sprite.x = WORLD_WIDTH + 12;
      if (flake.sprite.x > WORLD_WIDTH + 12) flake.sprite.x = -12;
    });
  }

  private createTerrain(holes: TerrainCrater[], terrainSeed: number) {
    if (!this.terrainTexture) {
      const texture = this.textures.createCanvas("terrain", WORLD_WIDTH, WORLD_HEIGHT);
      if (!texture) throw new Error("Failed to create terrain texture.");
      this.terrainTexture = texture;
      this.terrainCanvas = this.terrainTexture.getSourceImage() as HTMLCanvasElement;
      this.terrainContext = this.terrainCanvas.getContext("2d", { willReadFrequently: true })!;
      this.add.image(0, 0, "terrain").setOrigin(0);
    }

    const points: Array<{ x: number; y: number }> = [];
    for (let x = 0; x <= WORLD_WIDTH; x += 12) {
      points.push({ x, y: getGroundSurfaceY(x, terrainSeed) });
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

    getTerrainIslands(terrainSeed).forEach((island) => {
      ctx.beginPath();
      ctx.ellipse(island.x, island.y, island.radiusX, island.radiusY, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#5a8f36";
      ctx.fill();

      ctx.beginPath();
      ctx.ellipse(island.x, island.y + 4, island.radiusX, island.radiusY - 6, 0, 0, Math.PI * 2);
      const islandSoil = ctx.createLinearGradient(0, island.y - island.radiusY, 0, island.y + island.radiusY);
      islandSoil.addColorStop(0, "#7cb147");
      islandSoil.addColorStop(0.2, "#5e9937");
      islandSoil.addColorStop(0.22, "#7d5a34");
      islandSoil.addColorStop(1, "#3f2c20");
      ctx.fillStyle = islandSoil;
      ctx.fill();
    });

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

  private ensureTankViews(count: number) {
    while (this.tankViews.length < count) {
      const index = this.tankViews.length;
      const color = currentState?.players[index]?.color ?? (index === 0 ? 0x45c7ff : 0xff9152);
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
      const nameLabel = this.add
        .text(0, -34, `PLAYER ${index + 1}`, {
          fontFamily: "Arial",
          fontSize: "12px",
          color: "#f8fbff",
          stroke: "#0c1720",
          strokeThickness: 3
        })
        .setOrigin(0.5, 1);
      const energyFrame = this.add
        .rectangle(0, 20, 48, 8, 0x0c1720, 0.85)
        .setStrokeStyle(1, 0xf4fbff, 0.55);
      const energyFill = this.add.rectangle(0, 20, 44, 4, 0x8df05f, 1);
      container.add([nameLabel, body, turret, energyFrame, energyFill]);
      this.tankViews.push({
        root: container,
        turret,
        nameLabel,
        energyFrame,
        energyFill
      });
    }

    this.tankViews.forEach((view, index) => {
      view.root.setVisible(index < count);
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
    const currentPlayer = getActivePlayer(currentState);
    if (!currentPlayer) return;
    const hudPlayer = localPlayerId === undefined ? currentPlayer : getPlayerById(currentState, localPlayerId) ?? currentPlayer;
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

    hp0.style.width = `${currentState.players[0]?.hp ?? 0}%`;
    hp1.style.width = `${currentState.players[1]?.hp ?? 0}%`;
    hpText0.textContent = `${currentState.players[0]?.hp ?? 0}`;
    hpText1.textContent = `${currentState.players[1]?.hp ?? 0}`;
    turn.textContent = currentState.message;
    roomLabel.textContent = `방 ${currentState.roomId}`;
    wind.textContent = `바람 ${currentState.wind >= 0 ? ">" : "<"} ${Math.abs(currentState.wind).toFixed(1)}`;
    angle.textContent = `각도 ${Math.round(currentPlayer.angle)}`;
    power.textContent = `파워 ${Math.round(shownPower)}`;
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
      !isGameMenuOpen() &&
      currentState?.phase === "aim" &&
      localPlayerId !== undefined &&
      currentState.activePlayerId === localPlayerId &&
      getActivePlayer(currentState)?.kind === "human"
    );
  }

  private getStatusMessage(state: GameState) {
    if (state.phase === "waiting") return state.message;
    if (localPlayerId === undefined) return state.message;
    if (state.phase === "gameover") return state.message;
    if (state.phase === "flying") return "포탄 비행 중";
    return state.activePlayerId === localPlayerId ? "내 턴" : `${getActivePlayer(state)?.name ?? "상대"} 턴`;
  }

  private powerToPercent(power: number) {
    return clamp(((power - MIN_POWER) / (MAX_POWER - MIN_POWER)) * 100, 0, 100);
  }

  private angleToDialRotation(angle: number) {
    if (!currentState) return -45;
    const player = getActivePlayer(currentState);
    const normalized = (player?.x ?? 0) <= WORLD_WIDTH / 2 ? angle : 180 - angle;
    return clamp(normalized - 90, -85, -5);
  }
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game",
  width: VIEWPORT_WIDTH,
  height: VIEWPORT_HEIGHT,
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
    setLobbyStatus("서버에 연결되었습니다. 방을 만들거나 입장하세요.");
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
    updateLobbyState(state);
    battleScene?.applyState(state);
  });

  socket.on("errorMessage", setLobbyStatus);
}

function setupLobby() {
  const createButton = document.querySelector<HTMLButtonElement>("#create-room")!;
  const joinButton = document.querySelector<HTMLButtonElement>("#join-room")!;
  const input = document.querySelector<HTMLInputElement>("#room-code")!;
  const addComputerButton = document.querySelector<HTMLButtonElement>("#add-computer")!;
  const startMatchButton = document.querySelector<HTMLButtonElement>("#start-match")!;
  const nameInput = document.querySelector<HTMLInputElement>("#player-name")!;
  const saveNameButton = document.querySelector<HTMLButtonElement>("#save-name")!;
  const resumeGameButton = document.querySelector<HTMLButtonElement>("#resume-game")!;
  const restartGameButton = document.querySelector<HTMLButtonElement>("#restart-game")!;
  const exitGameButton = document.querySelector<HTMLButtonElement>("#exit-game")!;

  createButton.addEventListener("click", () => {
    socket.emit("createRoom", applyJoinPayload);
  });

  joinButton.addEventListener("click", () => {
    const roomId = input.value.trim().toUpperCase();
    if (!roomId) {
      setLobbyStatus("방 번호를 입력하세요.");
      return;
    }
    socket.emit("joinRoom", roomId, applyJoinPayload);
  });

  addComputerButton.addEventListener("click", () => {
    socket.emit("addComputerPlayer", "normal");
  });

  startMatchButton.addEventListener("click", () => {
    socket.emit("startMatch");
  });

  saveNameButton.addEventListener("click", () => {
    const name = nameInput.value.trim();
    if (!name) {
      setLobbyStatus("사용할 이름을 입력하세요.");
      return;
    }
    socket.emit("setPlayerName", name);
  });

  nameInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    saveNameButton.click();
  });

  resumeGameButton.addEventListener("click", () => {
    closeGameMenu();
  });

  restartGameButton.addEventListener("click", () => {
    closeGameMenu(true);
    socket.emit("restartGame");
  });

  exitGameButton.addEventListener("click", () => {
    window.location.reload();
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
  document.querySelector<HTMLElement>(".lobby-actions")!.classList.add("hidden");
  document.querySelector<HTMLElement>("#room-setup")!.classList.remove("hidden");
  if (payload.state) {
    currentState = payload.state;
    updateLobbyState(payload.state);
    battleScene?.applyState(payload.state);
  }
}

function setLobbyStatus(message: string) {
  document.querySelector<HTMLElement>("#lobby-status")!.textContent = message;
}

function updateLobbyState(state: GameState) {
  const lobby = document.querySelector<HTMLElement>("#lobby")!;
  const setup = document.querySelector<HTMLElement>("#room-setup")!;
  const slotList = document.querySelector<HTMLElement>("#slot-list")!;
  const roomCode = document.querySelector<HTMLElement>("#setup-room-code")!;
  const role = document.querySelector<HTMLElement>("#setup-role")!;
  const addComputer = document.querySelector<HTMLButtonElement>("#add-computer")!;
  const startMatch = document.querySelector<HTMLButtonElement>("#start-match")!;
  const nameInput = document.querySelector<HTMLInputElement>("#player-name")!;
  const isHost = socket?.id === state.hostSocketId;
  const localPlayer = localPlayerId === undefined ? undefined : getPlayerById(state, localPlayerId);

  if (state.phase !== "waiting") {
    lobby.classList.add("hidden");
    return;
  }

  lobby.classList.remove("hidden");
  setup.classList.remove("hidden");
  roomCode.textContent = `방 번호 ${state.roomId}`;
  role.textContent = isHost ? "방장" : "플레이어";
  addComputer.disabled = !isHost;
  startMatch.disabled = !isHost;
  if (localPlayer && document.activeElement !== nameInput) {
    nameInput.value = localPlayer.name;
  }
  slotList.innerHTML = "";

  const leftColumn = createTeamColumn("A", "왼쪽 편", state, isHost);
  const rightColumn = createTeamColumn("B", "오른쪽 편", state, isHost);
  slotList.append(leftColumn, rightColumn);
  setLobbyStatus(`방 번호 ${state.roomId} · 왼쪽/오른쪽 편을 정한 뒤 게임을 시작하세요.`);
}

function getGameMenuElements() {
  return {
    root: document.querySelector<HTMLElement>("#game-menu")!,
    title: document.querySelector<HTMLElement>("#game-menu-title")!,
    message: document.querySelector<HTMLElement>("#game-menu-message")!,
    resume: document.querySelector<HTMLButtonElement>("#resume-game")!
  };
}

function isGameMenuOpen() {
  return !getGameMenuElements().root.classList.contains("hidden");
}

function openGameMenu(reason: "pause" | "gameover") {
  const { root, title, message, resume } = getGameMenuElements();
  gameMenuLockedByGameOver = reason === "gameover";
  title.textContent = reason === "gameover" ? "게임 종료" : "게임 메뉴";
  message.textContent =
    reason === "gameover"
      ? currentState?.message ?? "승패가 결정되었습니다."
      : "계속 진행하거나 다시 시작할 수 있습니다.";
  resume.style.display = reason === "gameover" ? "none" : "inline-block";
  root.classList.remove("hidden");
  root.setAttribute("aria-hidden", "false");
}

function closeGameMenu(force = false) {
  if (gameMenuLockedByGameOver && !force) return;
  const { root } = getGameMenuElements();
  root.classList.add("hidden");
  root.setAttribute("aria-hidden", "true");
  gameMenuLockedByGameOver = false;
}

function toggleGameMenu() {
  if (!currentState || currentState.phase === "waiting") return;
  if (currentState.phase === "gameover") {
    openGameMenu("gameover");
    return;
  }
  if (isGameMenuOpen()) {
    closeGameMenu();
  } else {
    openGameMenu("pause");
  }
}

function syncGameMenuToState(state: GameState) {
  if (state.phase === "gameover") {
    openGameMenu("gameover");
    return;
  }

  if (state.phase === "waiting" || state.phase === "aim" || state.phase === "flying") {
    closeGameMenu(true);
  }
}

function createSlotIndex(index: number) {
  const element = document.createElement("span");
  element.className = "slot-index";
  element.textContent = `${index}`;
  return element;
}

function createSlotName(player: PlayerState) {
  const wrapper = document.createElement("span");
  wrapper.className = "slot-name";
  const kind = document.createElement("span");
  const name = document.createElement("strong");
  const meta = document.createElement("span");
  kind.className = `slot-kind ${player.kind === "computer" ? "computer-kind" : "human-kind"}`;
  kind.textContent = player.kind === "computer" ? "CPU" : "USER";
  name.textContent = player.name;
  meta.textContent = `${player.kind === "computer" ? "컴퓨터" : "사람"} - ${player.teamId === "A" ? "왼쪽 편" : "오른쪽 편"}`;
  wrapper.append(kind, name);
  return wrapper;
}

function createTeamColumn(teamId: TeamId, label: string, state: GameState, isHost: boolean) {
  const column = document.createElement("div");
  column.className = `team-column ${teamId === "A" ? "left-team" : "right-team"}`;
  const title = document.createElement("div");
  title.className = "team-title";
  const count = state.players.filter((player) => player.teamId === teamId).length;
  title.innerHTML = `<strong>${label}</strong><span>${count}명</span>`;
  column.append(title);

  state.players
    .filter((player) => player.teamId === teamId)
    .forEach((player) => {
      const row = document.createElement("div");
      row.className = `slot-row ${player.kind === "computer" ? "computer-slot" : "human-slot"}`;
      row.append(createSlotIndex(player.slotIndex + 1));
      row.append(createSlotName(player));
      row.append(createSideButton(player, teamId === "A" ? "B" : "A", isHost));
      row.append(createRemoveButton(player, isHost));
      column.append(row);
    });

  return column;
}

function createSideButton(player: PlayerState, targetTeamId: TeamId, isHost: boolean) {
  const button = document.createElement("button");
  button.className = "side-button";
  button.type = "button";
  button.textContent = targetTeamId === "A" ? "←" : "→";
  const canChange = isHost || (player.kind === "human" && player.id === localPlayerId);
  button.disabled = !canChange;
  button.title = targetTeamId === "A" ? "왼쪽 편으로 이동" : "오른쪽 편으로 이동";
  button.addEventListener("click", () => {
    socket.emit("setTeam", player.id, targetTeamId);
  });
  return button;
}

function createRemoveButton(player: PlayerState, isHost: boolean) {
  const button = document.createElement("button");
  button.className = "remove-cpu";
  button.type = "button";
  button.textContent = "X";
  button.disabled = !isHost || player.kind !== "computer";
  button.addEventListener("click", () => {
    socket.emit("removeComputerPlayer", player.id);
  });
  return button;
}

function getPlayerById(state: GameState, playerId: PlayerId) {
  return state.players.find((player) => player.id === playerId);
}

function getActivePlayer(state: GameState) {
  return getPlayerById(state, state.activePlayerId);
}
