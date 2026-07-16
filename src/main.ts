import Phaser from "phaser";
import { io, type Socket } from "socket.io-client";
import {
  DEFAULT_TARGET_POWER,
  MAX_POWER,
  MIN_POWER,
  TEAM_IDS,
  TURN_DURATION_MS,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
  WORLD_HEIGHT,
  WORLD_WIDTH
} from "./shared/constants.js";
import { TANK_DEFINITIONS, WEAPON_DEFINITIONS, getTankDefinition, getWeaponDefinition } from "./shared/gameData.js";
import { clamp } from "./shared/terrain.js";
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
  object: Phaser.GameObjects.Arc | Phaser.GameObjects.Sprite;
  weaponId: string;
  previousX?: number;
  previousY?: number;
};

type Snowflake = {
  sprite: Phaser.GameObjects.Arc;
  speed: number;
  drift: number;
  phase: number;
};

type TankView = {
  root: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  tankId?: string;
  nameLabel: Phaser.GameObjects.Text;
  aimGroup: Phaser.GameObjects.Container;
  aimGraphics: Phaser.GameObjects.Graphics;
  angleLabel: Phaser.GameObjects.Text;
  turnLabel: Phaser.GameObjects.Text;
  energyGroup: Phaser.GameObjects.Container;
  energyFrame: Phaser.GameObjects.Rectangle;
  energyFill: Phaser.GameObjects.Rectangle;
};

const PROJECTILE_ROTATION_EPSILON_SQ = 0.25;

let socket: Socket<ServerToClientEvents, ClientToServerEvents>;
let localPlayerId: PlayerId | undefined;
let currentState: GameState | undefined;
let battleScene: BattleScene | undefined;
let gameMenuLockedByGameOver = false;
let matchStartPending = false;
let rollingComputerPlayerIds = new Set<PlayerId>();
let tankSelectionOpen = false;
let selectedTankIndex = 0;
let previousTankIndex = 0;
let tankSlideDirection: -1 | 0 | 1 = 0;
let tankSlideStartedAt = 0;
let tankSelectorAnimationId: number | undefined;
const confirmedTankSelections = new Set<PlayerId>();
const tankSelectImages = new Map<string, HTMLImageElement>();
const TANK_SELECT_SLIDE_MS = 360;

const TANK_IDLE_FRAME_WIDTH = 720;
const TANK_IDLE_FRAME_HEIGHT = 420;
const TANK_IDLE_FRAME_GAP = 72;
const TANK_IDLE_FRAME_COUNT = 8;
const TANK_RENDER_SCALE = 0.1344;
const TANK_AIM_PIVOT_X = 0;
const TANK_AIM_PIVOT_Y = -11;
const TERRAIN_BASE_TEXTURE_KEY = "default-map";
const TERRAIN_BASE_PATH = "/assets/maps/default-map.png?v=1";

function getTankIdleSheetKey(tankId: string) {
  return `${tankId}-idle-sheet`;
}

function getTankIdleAnimKey(tankId: string) {
  return `${tankId}-idle-loop`;
}

function getTankIdleFrameKey(tankId: string, frame: number) {
  return `${tankId}-idle-frame-${frame}`;
}

function getProjectileSheetKey(weaponId: string) {
  const projectile = getWeaponDefinition(weaponId).projectile;
  return `${weaponId}-projectile-sheet-${projectile.frameWidth}x${projectile.frameHeight}-${projectile.originX ?? 0.5}`;
}

function getProjectileAnimKey(weaponId: string) {
  return `${weaponId}-projectile-flight`;
}

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
  private pendingCameraRecenter?: number;
  private localTurnEndsAt?: number;
  private turnTimerKey?: string;

  constructor() {
    super("battle");
  }

  preload() {
    this.load.image(TERRAIN_BASE_TEXTURE_KEY, TERRAIN_BASE_PATH);
    TANK_DEFINITIONS.forEach((tank) => {
      if (!tank.asset.idleSheetPath) return;
      this.load.image(getTankIdleSheetKey(tank.id), tank.asset.idleSheetPath);
    });
    WEAPON_DEFINITIONS.forEach((weapon) => {
      const projectile = weapon.projectile;
      if (!projectile.spriteSheetPath || !projectile.frameWidth || !projectile.frameHeight) return;
      this.load.spritesheet(getProjectileSheetKey(weapon.id), projectile.spriteSheetPath, {
        frameWidth: projectile.frameWidth,
        frameHeight: projectile.frameHeight
      });
    });
  }

  create() {
    battleScene = this;
    this.cameras.main.setBackgroundColor("#78bde7");
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.createTankAnimations();
    this.createProjectileAnimations();
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
    this.updateTankOverlays(currentState);
    this.refreshHud();
  }

  applyState(state?: GameState) {
    if (!state) return;
    currentState = state;
    this.syncLocalTurnTimer(state);
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
      this.setTankViewTank(view, player.tankId);
      view.root.setPosition(player.x, player.y);
      view.root.setRotation(player.slope);
      view.root.setAlpha(player.hp <= 0 ? 0.35 : player.id === state.activePlayerId ? 1 : 0.72);
      view.sprite.setFlipX(this.getTankFlipX(player));
      view.nameLabel.setText(player.name);
      view.nameLabel.setRotation(-player.slope);
      view.energyGroup.setRotation(-player.slope);
      view.energyFill.width = Phaser.Math.Clamp((player.hp / player.maxHp) * 44, 0, 44);
      view.energyFill.x = -22;
      view.energyFill.setFillStyle(player.hp / player.maxHp > 0.35 ? 0x8df05f : 0xffa33d);
    });
    this.updateTankOverlays(state);

    if (state.phase !== "flying") {
      this.projectile?.object.destroy();
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

    if (this.pendingCameraRecenter) {
      window.clearTimeout(this.pendingCameraRecenter);
      this.pendingCameraRecenter = undefined;
    }

    if ((phaseChanged && state.phase === "aim") || (state.phase === "aim" && activePlayerChanged)) {
      const activePlayer = getActivePlayer(state);
      if (activePlayer) {
        const shouldDelayRecenter = this.previousPhase === "flying" && state.phase === "aim";
        if (shouldDelayRecenter) {
          this.pendingCameraRecenter = window.setTimeout(() => {
            const latestState = currentState;
            const latestActivePlayer = latestState ? getActivePlayer(latestState) : undefined;
            if (latestState?.phase === "aim" && latestActivePlayer) {
              this.centerCameraOnX(latestActivePlayer.x);
            }
            this.pendingCameraRecenter = undefined;
          }, 1500);
        } else {
          this.centerCameraOnX(activePlayer.x);
        }
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
    const weapon = getWeaponDefinition(currentState.projectile.weaponId);
    const projectileVisual = weapon.projectile;

    if (!this.projectile || this.projectile.weaponId !== weapon.id) {
      this.projectile?.object.destroy();
      this.projectile = this.createProjectileView(weapon.id);
    }

    const { x, y } = currentState.projectile;
    const previousX = this.projectile.previousX;
    const previousY = this.projectile.previousY;
    const movementX = previousX === undefined ? 0 : x - previousX;
    const movementY = previousY === undefined ? 0 : y - previousY;
    const hasMovementSample =
      previousX !== undefined &&
      previousY !== undefined &&
      movementX * movementX + movementY * movementY >= PROJECTILE_ROTATION_EPSILON_SQ;
    this.projectile.object.setPosition(x, y);

    if (this.projectile.object instanceof Phaser.GameObjects.Sprite) {
      this.projectile.object.setScale(projectileVisual.scale ?? 1);
      this.projectile.object.play(getProjectileAnimKey(weapon.id), true);
      if (hasMovementSample) {
        this.projectile.object.setRotation(Phaser.Math.Angle.Between(previousX, previousY, x, y));
      }
    } else {
      this.projectile.object.setRadius(projectileVisual.radius);
      this.projectile.object.setFillStyle(projectileVisual.fillColor, 1);
      if (projectileVisual.strokeColor === undefined) {
        this.projectile.object.setStrokeStyle();
      } else {
        this.projectile.object.setStrokeStyle(2, projectileVisual.strokeColor, 0.8);
      }
    }

    if (previousX === undefined || previousY === undefined || hasMovementSample) {
      this.projectile.previousX = x;
      this.projectile.previousY = y;
    }
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

  private createTerrain(holes: TerrainCrater[], _terrainSeed: number) {
    if (!this.terrainTexture) {
      const texture = this.textures.createCanvas("terrain", WORLD_WIDTH, WORLD_HEIGHT);
      if (!texture) throw new Error("Failed to create terrain texture.");
      this.terrainTexture = texture;
      this.terrainCanvas = this.terrainTexture.getSourceImage() as HTMLCanvasElement;
      this.terrainContext = this.terrainCanvas.getContext("2d", { willReadFrequently: true })!;
      this.add.image(0, 0, "terrain").setOrigin(0);
    }

    const ctx = this.terrainContext;
    ctx.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    const baseMap = this.textures.get(TERRAIN_BASE_TEXTURE_KEY).getSourceImage() as CanvasImageSource;
    ctx.drawImage(baseMap, 0, 0, WORLD_WIDTH, WORLD_HEIGHT);

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
      const container = this.add.container(-100, -100).setDepth(3);
      const defaultTankId = TANK_DEFINITIONS[0].id;
      const sprite = this.add
        .sprite(0, 14, getTankIdleFrameKey(defaultTankId, 0))
        .setOrigin(0.5, 1)
        .setScale(TANK_RENDER_SCALE)
        .play(getTankIdleAnimKey(defaultTankId));
      const nameLabel = this.add
        .text(0, -72, `PLAYER ${index + 1}`, {
          fontFamily: "Arial",
          fontSize: "12px",
          color: "#f8fbff",
          stroke: "#0c1720",
          strokeThickness: 3
        })
        .setOrigin(0.5, 1);
      const energyGroup = this.add.container(0, 20);
      const energyFrame = this.add
        .rectangle(0, 0, 48, 8, 0x0c1720, 0.85)
        .setStrokeStyle(1, 0xf4fbff, 0.55);
      const energyFill = this.add.rectangle(-22, 0, 44, 4, 0x8df05f, 1).setOrigin(0, 0.5);
      energyGroup.add([energyFrame, energyFill]);
      const aimGroup = this.add.container(0, 0);
      const aimGraphics = this.add.graphics();
      const angleLabel = this.add
        .text(0, 0, "0", {
          fontFamily: "Arial",
          fontSize: "12px",
          color: "#d8fff0",
          stroke: "#06422e",
          strokeThickness: 3
        })
        .setOrigin(0.5);
      const turnLabel = this.add
        .text(-48, -88, "20", {
          fontFamily: "Arial",
          fontSize: "13px",
          color: "#ffffff",
          stroke: "#000000",
          strokeThickness: 3
        })
        .setOrigin(0.5);
      aimGroup.add([aimGraphics, angleLabel, turnLabel]);
      container.add([sprite, nameLabel, energyGroup, aimGroup]);
      this.tankViews.push({
        root: container,
        sprite,
        tankId: defaultTankId,
        nameLabel,
        aimGroup,
        aimGraphics,
        angleLabel,
        turnLabel,
        energyGroup,
        energyFrame,
        energyFill
      });
    }

    this.tankViews.forEach((view, index) => {
      view.root.setVisible(index < count);
    });
  }

  private createTankAnimations() {
    TANK_DEFINITIONS.forEach((tank) => {
      const animKey = getTankIdleAnimKey(tank.id);
      if (this.anims.exists(animKey)) return;

      const sourceImage = this.textures.get(getTankIdleSheetKey(tank.id)).getSourceImage() as CanvasImageSource & {
        width: number;
        height: number;
      };
      const frameKeys = Array.from({ length: TANK_IDLE_FRAME_COUNT }, (_item, index) => {
        const key = getTankIdleFrameKey(tank.id, index);
        if (this.textures.exists(key)) return key;

        const texture = this.textures.createCanvas(key, TANK_IDLE_FRAME_WIDTH, TANK_IDLE_FRAME_HEIGHT);
        if (!texture) return key;

        const context = texture.getContext();
        this.drawAlignedTankFrame(
          context,
          sourceImage,
          index * (TANK_IDLE_FRAME_WIDTH + TANK_IDLE_FRAME_GAP),
          0,
          TANK_IDLE_FRAME_WIDTH,
          TANK_IDLE_FRAME_HEIGHT
        );
        texture.refresh();
        return key;
      });

      this.anims.create({
        key: animKey,
        frames: frameKeys.map((key) => ({ key })),
        frameRate: 6,
        repeat: -1
      });
    });
  }

  private createProjectileAnimations() {
    WEAPON_DEFINITIONS.forEach((weapon) => {
      const projectile = weapon.projectile;
      if (!projectile.spriteSheetPath || !projectile.frameCount) return;

      const animKey = getProjectileAnimKey(weapon.id);
      if (this.anims.exists(animKey)) return;

      this.anims.create({
        key: animKey,
        frames: this.anims.generateFrameNumbers(getProjectileSheetKey(weapon.id), {
          start: 0,
          end: projectile.frameCount - 1
        }),
        frameRate: projectile.frameRate ?? 12,
        repeat: -1
      });
    });
  }

  private createProjectileView(weaponId: string): ProjectileView {
    const weapon = getWeaponDefinition(weaponId);
    const projectile = weapon.projectile;

    if (projectile.spriteSheetPath) {
      const sprite = this.add
        .sprite(0, 0, getProjectileSheetKey(weapon.id), 0)
        .setOrigin(projectile.originX ?? 0.5, projectile.originY ?? 0.5)
        .setScale(projectile.scale ?? 1)
        .setDepth(4);
      sprite.play(getProjectileAnimKey(weapon.id), true);
      return { object: sprite, weaponId: weapon.id };
    }

    const circle = this.add
      .circle(0, 0, projectile.radius, projectile.fillColor, 1)
      .setDepth(4);
    return { object: circle, weaponId: weapon.id };
  }

  private setTankViewTank(view: TankView, tankId: string) {
    const tank = getTankDefinition(tankId);
    if (view.tankId === tank.id) return;

    view.tankId = tank.id;
    view.sprite.setTexture(getTankIdleFrameKey(tank.id, 0));
    view.sprite.play(getTankIdleAnimKey(tank.id), true);
  }

  private getTankFlipX(player: PlayerState) {
    const tank = getTankDefinition(player.tankId);
    const shouldFaceRight = player.facing === 1;
    return tank.asset.sourceFacing === "right" ? !shouldFaceRight : shouldFaceRight;
  }

  private drawAlignedTankFrame(
    context: CanvasRenderingContext2D,
    sourceImage: CanvasImageSource,
    sourceX: number,
    sourceY: number,
    frameWidth: number,
    frameHeight: number
  ) {
    const scratch = document.createElement("canvas");
    scratch.width = frameWidth;
    scratch.height = frameHeight;
    const scratchContext = scratch.getContext("2d", { willReadFrequently: true });
    if (!scratchContext) return;

    scratchContext.clearRect(0, 0, frameWidth, frameHeight);
    scratchContext.drawImage(sourceImage, sourceX, sourceY, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight);

    const imageData = scratchContext.getImageData(0, 0, frameWidth, frameHeight);
    const outsideMask = this.getOutsideBackgroundMask(imageData, frameWidth, frameHeight);
    const fullBounds = this.getVisibleFrameBounds(outsideMask, frameWidth, frameHeight);
    context.clearRect(0, 0, frameWidth, frameHeight);
    if (!fullBounds) return;

    const cleaned = document.createElement("canvas");
    cleaned.width = frameWidth;
    cleaned.height = frameHeight;
    const cleanedContext = cleaned.getContext("2d", { willReadFrequently: true });
    if (!cleanedContext) return;
    const cleanedImageData = cleanedContext.createImageData(frameWidth, frameHeight);
    for (let index = 0; index < outsideMask.length; index += 1) {
      if (outsideMask[index]) continue;
      const offset = index * 4;
      cleanedImageData.data[offset] = imageData.data[offset];
      cleanedImageData.data[offset + 1] = imageData.data[offset + 1];
      cleanedImageData.data[offset + 2] = imageData.data[offset + 2];
      cleanedImageData.data[offset + 3] = imageData.data[offset + 3];
    }
    cleanedContext.putImageData(cleanedImageData, 0, 0);

    const trackAnchor = this.getTrackAnchor(imageData, frameWidth, frameHeight, fullBounds, outsideMask);
    const boundsWidth = fullBounds.maxX - fullBounds.minX + 1;
    const boundsHeight = fullBounds.maxY - fullBounds.minY + 1;
    const alignedX = Math.round(frameWidth / 2 - (trackAnchor.centerX - fullBounds.minX));
    const alignedY = Math.round(frameHeight - 26 - (trackAnchor.bottomY - fullBounds.minY));

    context.drawImage(
      cleaned,
      fullBounds.minX,
      fullBounds.minY,
      boundsWidth,
      boundsHeight,
      alignedX,
      alignedY,
      boundsWidth,
      boundsHeight
    );
  }

  private getOutsideBackgroundMask(imageData: ImageData, width: number, height: number) {
    const { data } = imageData;
    const objectSeed = new Uint8Array(width * height);
    const outside = new Uint8Array(width * height);
    const queue: number[] = [];

    for (let index = 0; index < width * height; index += 1) {
      const offset = index * 4;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const alpha = data[offset + 3];
      const max = Math.max(red, green, blue);
      const min = Math.min(red, green, blue);
      const saturation = max - min;
      objectSeed[index] = alpha > 8 && (saturation > 28 || max < 205) ? 1 : 0;
    }

    const enqueue = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const index = y * width + x;
      if (outside[index] || objectSeed[index]) return;
      outside[index] = 1;
      queue.push(index);
    };

    for (let x = 0; x < width; x += 1) {
      enqueue(x, 0);
      enqueue(x, height - 1);
    }
    for (let y = 0; y < height; y += 1) {
      enqueue(0, y);
      enqueue(width - 1, y);
    }

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor];
      const x = index % width;
      const y = Math.floor(index / width);
      enqueue(x + 1, y);
      enqueue(x - 1, y);
      enqueue(x, y + 1);
      enqueue(x, y - 1);
    }

    return outside;
  }

  private getVisibleFrameBounds(outsideMask: Uint8Array, width: number, height: number) {
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (outsideMask[y * width + x]) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }

    return maxX < 0 || maxY < 0 ? undefined : { minX, minY, maxX, maxY };
  }

  private getTrackAnchor(
    imageData: ImageData,
    width: number,
    _height: number,
    fullBounds: { minX: number; minY: number; maxX: number; maxY: number },
    outsideMask: Uint8Array
  ) {
    const { data } = imageData;
    const trackStart = Math.floor(fullBounds.minY + (fullBounds.maxY - fullBounds.minY) * 0.55);
    let trackMinX = width;
    let trackMaxX = -1;
    let trackBottomY = fullBounds.maxY;

    for (let y = trackStart; y <= fullBounds.maxY; y += 1) {
      for (let x = fullBounds.minX; x <= fullBounds.maxX; x += 1) {
        if (outsideMask[y * width + x]) continue;
        const offset = (y * width + x) * 4;
        const alpha = data[offset + 3];
        if (alpha <= 8) continue;

        const red = data[offset];
        const green = data[offset + 1];
        const blue = data[offset + 2];
        const max = Math.max(red, green, blue);
        const min = Math.min(red, green, blue);
        const saturation = max - min;
        if (max >= 120 || saturation >= 95) continue;

        if (x < trackMinX) trackMinX = x;
        if (x > trackMaxX) trackMaxX = x;
        if (y > trackBottomY) trackBottomY = y;
      }
    }

    if (trackMaxX < trackMinX) {
      return {
        centerX: (fullBounds.minX + fullBounds.maxX) / 2,
        bottomY: fullBounds.maxY
      };
    }

    return {
      centerX: (trackMinX + trackMaxX) / 2,
      bottomY: trackBottomY
    };
  }

  private syncLocalTurnTimer(state: GameState) {
    if (state.phase !== "aim" || state.turnRemainingMs === undefined) {
      this.turnTimerKey = undefined;
      this.localTurnEndsAt = undefined;
      return;
    }

    const timerKey = `${state.activePlayerId}:${state.turnEndsAt ?? "local"}`;
    if (this.turnTimerKey === timerKey) return;

    this.turnTimerKey = timerKey;
    this.localTurnEndsAt = Date.now() + state.turnRemainingMs;
  }

  private updateTankOverlays(state: GameState) {
    this.tankViews.forEach((view, index) => {
      const player = state.players[index];
      view.aimGraphics.clear();
      view.aimGroup.setVisible(false);
      if (!player || state.phase !== "aim" || player.id !== state.activePlayerId || player.hp <= 0) return;

      const facingRight = player.facing === 1;
      const facing = facingRight ? 1 : -1;
      const aimAngle = Phaser.Math.Clamp(facingRight ? player.angle : 180 - player.angle, 0, 90);
      const radians = Phaser.Math.DegToRad(aimAngle);
      const originX = 0;
      const originY = 0;
      const radius = 52;
      const lineLength = 84;

      view.aimGroup.setVisible(true);
      view.aimGroup.setPosition(TANK_AIM_PIVOT_X, TANK_AIM_PIVOT_Y);
      view.aimGroup.setRotation(-player.slope);
      view.aimGraphics.lineStyle(5, 0x48f0a3, 0.38);
      view.aimGraphics.beginPath();
      for (let step = 0; step <= 24; step += 1) {
        const t = step / 24;
        const angle = radians * t;
        const x = originX + facing * Math.cos(angle) * radius;
        const y = originY - Math.sin(angle) * radius;
        if (step === 0) {
          view.aimGraphics.moveTo(x, y);
        } else {
          view.aimGraphics.lineTo(x, y);
        }
      }
      view.aimGraphics.strokePath();

      view.aimGraphics.lineStyle(4, 0xffffff, 0.9);
      view.aimGraphics.beginPath();
      view.aimGraphics.moveTo(originX, originY);
      view.aimGraphics.lineTo(originX + facing * Math.cos(radians) * lineLength, originY - Math.sin(radians) * lineLength);
      view.aimGraphics.strokePath();

      view.angleLabel.setText(`${Math.round(aimAngle)}`);
      view.angleLabel.setPosition(
        originX + facing * Math.cos(radians * 0.55) * (radius + 12),
        originY - Math.sin(radians * 0.55) * (radius + 12)
      );

      const remainingMs =
        this.localTurnEndsAt === undefined
          ? state.turnRemainingMs ?? TURN_DURATION_MS
          : Math.max(0, this.localTurnEndsAt - Date.now());
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      const timerRatio = Phaser.Math.Clamp(remainingMs / TURN_DURATION_MS, 0, 1);
      const timerX = -48;
      const timerY = -88 - TANK_AIM_PIVOT_Y;
      view.aimGraphics.fillStyle(0x07110c, 0.92);
      view.aimGraphics.fillCircle(timerX, timerY, 15);
      view.aimGraphics.lineStyle(4, remainingSeconds <= 5 ? 0xff704d : 0x7cff74, 0.95);
      view.aimGraphics.beginPath();
      view.aimGraphics.arc(timerX, timerY, 15, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * timerRatio, false);
      view.aimGraphics.strokePath();
      view.turnLabel.setText(`${remainingSeconds}`);
      view.turnLabel.setPosition(timerX, timerY);
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
    const player0 = currentState.players[0];
    const player1 = currentState.players[1];
    const hpRatio0 = player0 ? player0.hp / player0.maxHp : 0;
    const hpRatio1 = player1 ? player1.hp / player1.maxHp : 0;
    const displayedAngle = this.getDisplayedAimAngle(currentPlayer);

    hp0.style.width = `${clamp(hpRatio0 * 100, 0, 100)}%`;
    hp1.style.width = `${clamp(hpRatio1 * 100, 0, 100)}%`;
    hpText0.textContent = player0 ? `${player0.hp}/${player0.maxHp}` : "0";
    hpText1.textContent = player1 ? `${player1.hp}/${player1.maxHp}` : "0";
    turn.textContent = currentState.message;
    roomLabel.textContent = `방 ${currentState.roomId}`;
    wind.textContent = `바람 ${currentState.wind >= 0 ? ">" : "<"} ${Math.abs(currentState.wind).toFixed(1)}`;
    angle.textContent = `각도 ${Math.round(displayedAngle)}`;
    power.textContent = `파워 ${Math.round(shownPower)}`;
    powerValue.textContent = `${Math.round(shownPower)}`;
    energyValue.textContent = `${hudPlayer.hp}/${hudPlayer.maxHp}`;
    energyFill.style.width = `${clamp((hudPlayer.hp / hudPlayer.maxHp) * 100, 0, 100)}%`;
    moveValue.textContent = `${Math.round(hudPlayer.move)}`;
    moveFill.style.width = `${clamp((hudPlayer.move / hudPlayer.maxMove) * 100, 0, 100)}%`;
    powerFill.style.width = `${this.powerToPercent(shownPower)}%`;
    targetMarker.style.left = `${this.powerToPercent(this.targetPowerMarker)}%`;
    powerTrack.setAttribute("aria-valuenow", `${Math.round(this.targetPowerMarker)}`);
    consoleWind.textContent = `${currentState.wind >= 0 ? ">" : "<"} ${Math.abs(currentState.wind).toFixed(1)}`;
    consoleAngle.textContent = `${Math.round(displayedAngle)}`;
    angleNeedle.style.setProperty("--dial-angle", `${this.angleToDialRotation(displayedAngle)}deg`);
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

  private getDisplayedAimAngle(player: PlayerState) {
    const facingRight = player.facing === 1;
    return clamp(facingRight ? player.angle : 180 - player.angle, 0, 90);
  }

  private angleToDialRotation(displayedAngle: number) {
    return clamp(-displayedAngle, -90, 0);
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
setupTankSelector();

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
    maybeOpenTankSelector();
  });

  socket.on("errorMessage", setLobbyStatus);
}

function randomizeComputerTanks() {
  return new Promise<{ ok: boolean; message?: string }>((resolve) => {
    socket.emit("randomizeComputerTanks", resolve);
  });
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function setupTankSelector() {
  document.querySelector<HTMLButtonElement>("#tank-select-prev")!.addEventListener("click", () => moveTankSelection(-1));
  document.querySelector<HTMLButtonElement>("#tank-select-next")!.addEventListener("click", () => moveTankSelection(1));
  document.querySelector<HTMLButtonElement>("#tank-select-confirm")!.addEventListener("click", confirmTankSelection);
  window.addEventListener("keydown", (event) => {
    if (!tankSelectionOpen) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveTankSelection(-1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveTankSelection(1);
    }
    if (event.key === "Enter") {
      event.preventDefault();
      confirmTankSelection();
    }
  });
}

function maybeOpenTankSelector() {
  if (!currentState || localPlayerId === undefined) return;
  if (currentState.phase !== "waiting") {
    closeTankSelector();
    return;
  }

  const localPlayer = getPlayerById(currentState, localPlayerId);
  if (!localPlayer || localPlayer.kind !== "human" || confirmedTankSelections.has(localPlayer.id)) return;
  openTankSelector(localPlayer.tankId);
}

function openTankSelector(tankId: string) {
  const selectedIndex = TANK_DEFINITIONS.findIndex((tank) => tank.id === tankId);
  selectedTankIndex = selectedIndex < 0 ? 0 : selectedIndex;
  previousTankIndex = selectedTankIndex;
  tankSlideDirection = 0;
  tankSelectionOpen = true;
  const screen = document.querySelector<HTMLElement>("#tank-select-screen")!;
  screen.classList.remove("hidden");
  screen.setAttribute("aria-hidden", "false");
  updateTankSelectorName();
  startTankSelectorAnimation();
}

function closeTankSelector() {
  if (!tankSelectionOpen) return;
  tankSelectionOpen = false;
  const screen = document.querySelector<HTMLElement>("#tank-select-screen")!;
  screen.classList.add("hidden");
  screen.setAttribute("aria-hidden", "true");
  if (tankSelectorAnimationId !== undefined) {
    window.cancelAnimationFrame(tankSelectorAnimationId);
    tankSelectorAnimationId = undefined;
  }
}

function moveTankSelection(direction: -1 | 1) {
  if (!tankSelectionOpen) return;
  previousTankIndex = selectedTankIndex;
  selectedTankIndex = (selectedTankIndex + direction + TANK_DEFINITIONS.length) % TANK_DEFINITIONS.length;
  tankSlideDirection = direction;
  tankSlideStartedAt = performance.now();
  updateTankSelectorName();
}

function confirmTankSelection() {
  if (!tankSelectionOpen || localPlayerId === undefined) return;
  const tank = TANK_DEFINITIONS[selectedTankIndex];
  confirmedTankSelections.add(localPlayerId);
  socket.emit("setTank", localPlayerId, tank.id);
  closeTankSelector();
}

function updateTankSelectorName() {
  document.querySelector<HTMLElement>("#tank-select-name")!.textContent = TANK_DEFINITIONS[selectedTankIndex].name;
}

function startTankSelectorAnimation() {
  if (tankSelectorAnimationId !== undefined) return;

  const draw = (time: number) => {
    drawTankSelector(time);
    if (tankSelectionOpen) {
      tankSelectorAnimationId = window.requestAnimationFrame(draw);
    } else {
      tankSelectorAnimationId = undefined;
    }
  };

  tankSelectorAnimationId = window.requestAnimationFrame(draw);
}

function drawTankSelector(time: number) {
  const canvas = document.querySelector<HTMLCanvasElement>("#tank-select-canvas")!;
  const context = canvas.getContext("2d");
  if (!context) return;

  context.clearRect(0, 0, canvas.width, canvas.height);
  const slideProgress =
    tankSlideDirection === 0 ? 1 : Math.min(1, (time - tankSlideStartedAt) / TANK_SELECT_SLIDE_MS);
  const eased = 1 - Math.pow(1 - slideProgress, 3);
  const frame = Math.floor(time / 150) % TANK_IDLE_FRAME_COUNT;

  if (tankSlideDirection !== 0 && slideProgress < 1) {
    drawTankSelectionFrame(context, TANK_DEFINITIONS[previousTankIndex], frame, -tankSlideDirection * eased * canvas.width);
    drawTankSelectionFrame(
      context,
      TANK_DEFINITIONS[selectedTankIndex],
      frame,
      tankSlideDirection * (1 - eased) * canvas.width
    );
  } else {
    tankSlideDirection = 0;
    drawTankSelectionFrame(context, TANK_DEFINITIONS[selectedTankIndex], frame, 0);
  }
}

function drawTankSelectionFrame(
  context: CanvasRenderingContext2D,
  tank: (typeof TANK_DEFINITIONS)[number],
  frame: number,
  offsetX: number
) {
  const image = getTankSelectImage(tank.id, tank.asset.idleSheetPath);
  if (!image?.complete || !image.naturalWidth) return;

  const sourceX = frame * (TANK_IDLE_FRAME_WIDTH + TANK_IDLE_FRAME_GAP);
  const targetWidth = 520;
  const targetHeight = 303;
  const targetX = Math.round((context.canvas.width - targetWidth) / 2 + offsetX);
  const targetY = 72;

  context.save();
  context.globalAlpha = Math.max(0.15, 1 - Math.min(1, Math.abs(offsetX) / context.canvas.width) * 0.52);
  if (tank.asset.sourceFacing === "left") {
    context.translate(targetX + targetWidth / 2, 0);
    context.scale(-1, 1);
    context.translate(-(targetX + targetWidth / 2), 0);
  }
  context.drawImage(
    image,
    sourceX,
    0,
    TANK_IDLE_FRAME_WIDTH,
    TANK_IDLE_FRAME_HEIGHT,
    targetX,
    targetY,
    targetWidth,
    targetHeight
  );
  context.restore();
}

function getTankSelectImage(tankId: string, path?: string) {
  if (!path) return undefined;
  const cached = tankSelectImages.get(tankId);
  if (cached) return cached;

  const image = new Image();
  image.src = path;
  tankSelectImages.set(tankId, image);
  return image;
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

  startMatchButton.addEventListener("click", async () => {
    if (!currentState || matchStartPending) return;
    matchStartPending = true;
    rollingComputerPlayerIds = new Set(currentState.players.filter((player) => player.kind === "computer").map((player) => player.id));
    updateLobbyState(currentState);

    const payload = await randomizeComputerTanks();
    if (!payload.ok) {
      setLobbyStatus(payload.message ?? "캐릭터 배정에 실패했습니다.");
      rollingComputerPlayerIds.clear();
      matchStartPending = false;
      updateLobbyState(currentState);
      return;
    }

    await delay(rollingComputerPlayerIds.size > 0 ? 1500 : 0);
    rollingComputerPlayerIds.clear();
    matchStartPending = false;
    if (currentState) updateLobbyState(currentState);
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
  if (payload.playerId !== undefined) confirmedTankSelections.delete(payload.playerId);
  document.querySelector<HTMLElement>(".lobby-actions")!.classList.add("hidden");
  document.querySelector<HTMLElement>("#room-setup")!.classList.remove("hidden");
  if (payload.state) {
    currentState = payload.state;
    updateLobbyState(payload.state);
    battleScene?.applyState(payload.state);
    maybeOpenTankSelector();
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
  addComputer.disabled = !isHost || matchStartPending;
  startMatch.disabled = !isHost || matchStartPending;
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
  const tank = getTankDefinition(player.tankId);
  const kind = document.createElement("span");
  const name = document.createElement("strong");
  const meta = document.createElement("span");
  kind.className = `slot-kind ${player.kind === "computer" ? "computer-kind" : "human-kind"}`;
  kind.textContent = player.kind === "computer" ? "CPU" : "USER";
  name.textContent = player.name;
  meta.textContent = `${tank.name} - ${player.teamId === "A" ? "왼쪽 편" : "오른쪽 편"}`;
  wrapper.append(kind, name, meta);
  return wrapper;
}

function createTankPreview(player: PlayerState) {
  const tank = getTankDefinition(player.tankId);
  if (rollingComputerPlayerIds.has(player.id)) {
    const machine = document.createElement("div");
    machine.className = "tank-preview slot-machine";
    const reel = document.createElement("div");
    reel.className = "slot-reel";
    [...TANK_DEFINITIONS, ...TANK_DEFINITIONS, tank].forEach((item) => {
      const image = document.createElement("img");
      image.src = item.asset.thumbnailPath ?? item.asset.idleSheetPath ?? "";
      image.alt = item.name;
      reel.append(image);
    });
    machine.append(reel);
    return machine;
  }

  const image = document.createElement("img");
  image.className = "tank-preview";
  image.src = tank.asset.thumbnailPath ?? tank.asset.idleSheetPath ?? "";
  image.alt = tank.name;
  return image;
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
      row.append(createTankPreview(player));
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
  const canChange = !matchStartPending && (isHost || (player.kind === "human" && player.id === localPlayerId));
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
  button.disabled = matchStartPending || !isHost || player.kind !== "computer";
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
