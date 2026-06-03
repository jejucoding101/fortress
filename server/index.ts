import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "../src/shared/types.js";
import { RoomManager } from "./rooms.js";

const app = express();
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
