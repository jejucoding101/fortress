import express from "express";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "../src/shared/types.js";
import { RoomManager } from "./rooms.js";

const app = express();
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tankAssetDir = path.join(projectRoot, "public", "assets", "tanks");
const projectileAssetDir = path.join(projectRoot, "public", "assets", "projectiles");

app.use(express.json({ limit: "12mb" }));
app.use((request, response, next) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (request.method === "OPTIONS") {
    response.sendStatus(204);
    return;
  }
  next();
});

app.post("/dev/eye-mask", async (request, response) => {
  const { filename, dataUrl } = request.body as { filename?: unknown; dataUrl?: unknown };

  if (typeof filename !== "string" || !/^tank\d+_eye_mask\.png$/.test(filename)) {
    response.status(400).json({ ok: false, error: "Invalid mask filename." });
    return;
  }
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,")) {
    response.status(400).json({ ok: false, error: "Invalid PNG payload." });
    return;
  }

  const png = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
  const outputPath = path.join(tankAssetDir, filename);
  await mkdir(tankAssetDir, { recursive: true });
  await writeFile(outputPath, png);
  response.json({ ok: true, path: path.relative(projectRoot, outputPath).replaceAll(path.sep, "/") });
});

app.post("/dev/projectile-frames", async (request, response) => {
  const { sheets, edits } = request.body as {
    sheets?: unknown;
    edits?: unknown;
  };

  if (!Array.isArray(sheets) || sheets.length === 0) {
    response.status(400).json({ ok: false, error: "Missing projectile sheets." });
    return;
  }

  if (typeof edits !== "object" || edits === null || Array.isArray(edits)) {
    response.status(400).json({ ok: false, error: "Missing projectile frame edits." });
    return;
  }

  for (const value of Object.values(edits)) {
    if (
      !Array.isArray(value) ||
      value.length !== 5 ||
      value.some((edit) => {
        if (typeof edit !== "object" || edit === null) return true;
        const frameEdit = edit as { x?: unknown; y?: unknown; scale?: unknown };
        return ![frameEdit.x, frameEdit.y, frameEdit.scale].every(
          (number) => typeof number === "number" && Number.isFinite(number)
        );
      })
    ) {
      response.status(400).json({ ok: false, error: "Invalid projectile frame edits." });
      return;
    }
  }

  await mkdir(projectileAssetDir, { recursive: true });
  const written: string[] = [];

  for (const sheet of sheets) {
    const { filename, dataUrl } = sheet as { filename?: unknown; dataUrl?: unknown };
    if (typeof filename !== "string" || !/^[a-z0-9_]+_flight_sheet\.png$/.test(filename)) {
      response.status(400).json({ ok: false, error: "Invalid projectile filename." });
      return;
    }
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,")) {
      response.status(400).json({ ok: false, error: "Invalid projectile PNG payload." });
      return;
    }

    const png = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
    const outputPath = path.join(projectileAssetDir, filename);
    await writeFile(outputPath, png);
    written.push(path.relative(projectRoot, outputPath).replaceAll(path.sep, "/"));
  }

  await writeFile(
    path.join(projectileAssetDir, "projectile_frame_edits.json"),
    `${JSON.stringify(edits, null, 2)}\n`,
    "utf8"
  );

  const version = `manual-${Date.now()}`;
  const gameDataPath = path.join(projectRoot, "src", "shared", "gameData.ts");
  const gameData = await readFile(gameDataPath, "utf8");
  const updatedGameData = gameData.replace(
    /const PROJECTILE_ASSET_VERSION = ".*?";/,
    `const PROJECTILE_ASSET_VERSION = "${version}";`
  );
  if (updatedGameData !== gameData) {
    await writeFile(gameDataPath, updatedGameData);
  }

  response.json({ ok: true, version, written });
});

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: true
  }
});
const rooms = new RoomManager(io);

io.on("connection", (socket) => {
  let currentRoomId: string | undefined;

  socket.on("createRoom", (callback) => {
    const payload = rooms.createRoom(socket.id);
    if (payload.ok && payload.roomId) {
      currentRoomId = payload.roomId;
      socket.join(currentRoomId);
      socket.emit("joinedRoom", payload);
    }
    callback(payload);
  });

  socket.on("joinRoom", (roomId, callback) => {
    const payload = rooms.joinRoom(socket.id, roomId);
    if (payload.ok && payload.roomId) {
      currentRoomId = payload.roomId;
      socket.join(currentRoomId);
      socket.emit("joinedRoom", payload);
      if (payload.state) io.to(currentRoomId).emit("stateSync", payload.state);
    }
    callback(payload);
  });

  socket.on("setPlayerName", (name) => {
    rooms.setPlayerName(socket.id, currentRoomId, name);
  });

  socket.on("addComputerPlayer", (difficulty) => {
    rooms.addComputer(socket.id, currentRoomId, difficulty);
  });

  socket.on("removeComputerPlayer", (playerId) => {
    rooms.removeComputer(socket.id, currentRoomId, playerId);
  });

  socket.on("setTeam", (playerId, teamId) => {
    rooms.setTeam(socket.id, currentRoomId, playerId, teamId);
  });

  socket.on("setTank", (playerId, tankId) => {
    rooms.setTank(socket.id, currentRoomId, playerId, tankId);
  });

  socket.on("randomizeComputerTanks", (callback) => {
    callback(rooms.randomizeComputerTanks(socket.id, currentRoomId));
  });

  socket.on("startMatch", () => {
    rooms.startMatch(socket.id, currentRoomId);
  });

  socket.on("playerMove", (direction) => {
    rooms.getRoom(currentRoomId)?.move(socket.id, direction);
  });

  socket.on("setAngle", (direction) => {
    rooms.getRoom(currentRoomId)?.setAngle(socket.id, direction);
  });

  socket.on("releaseShot", (power) => {
    rooms.getRoom(currentRoomId)?.releaseShot(socket.id, power);
  });

  socket.on("restartGame", () => {
    rooms.getRoom(currentRoomId)?.restart(socket.id);
  });

  socket.on("disconnect", () => {
    rooms.removeSocket(socket.id);
  });
});

const port = Number(process.env.PORT ?? 3000);
httpServer.listen(port, "0.0.0.0", () => {
  console.log(`Fortress duel server listening on http://localhost:${port}`);
});
