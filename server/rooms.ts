import type { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "../src/shared/types.js";
import { GameSession } from "./gameSession.js";

export class RoomManager {
  private rooms = new Map<string, GameSession>();

  constructor(private io: Server<ClientToServerEvents, ServerToClientEvents>) {}

  createRoom(socketId: string) {
    const roomId = this.createRoomId();
    const room = new GameSession(roomId, (state) => {
      this.io.to(roomId).emit("stateSync", state);
    });
    this.rooms.set(roomId, room);
    return this.joinRoom(socketId, roomId);
  }

  joinRoom(socketId: string, roomId: string) {
    const normalizedRoomId = roomId.trim().toUpperCase();
    const room = this.rooms.get(normalizedRoomId);
    if (!room) {
      return { ok: false, message: "Room not found" };
    }
    const playerId = room.addPlayer(socketId);
    if (playerId === undefined) {
      return { ok: false, message: "Room is full" };
    }
    return { ok: true, roomId: normalizedRoomId, playerId, state: room.state };
  }

  getRoom(roomId?: string) {
    if (!roomId) return undefined;
    return this.rooms.get(roomId);
  }

  removeSocket(socketId: string) {
    for (const room of this.rooms.values()) {
      room.removePlayer(socketId);
    }
  }

  private createRoomId() {
    let roomId = "";
    do {
      roomId = Math.random().toString(36).slice(2, 6).toUpperCase();
    } while (this.rooms.has(roomId));
    return roomId;
  }
}
