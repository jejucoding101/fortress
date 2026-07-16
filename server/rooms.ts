import type { Server } from "socket.io";
import type { AIDifficulty, ClientToServerEvents, ServerToClientEvents } from "../src/shared/types.js";
import { GameSession } from "./gameSession.js";

export class RoomManager {
  private rooms = new Map<string, GameSession>();

  constructor(private io: Server<ClientToServerEvents, ServerToClientEvents>) {}

  createRoom(socketId: string) {
    const roomId = this.createRoomId();
    const room = new GameSession(roomId, socketId, (state) => {
      this.io.to(roomId).emit("stateSync", state);
    });
    this.rooms.set(roomId, room);
    return this.joinRoom(socketId, roomId);
  }

  joinRoom(socketId: string, roomId: string) {
    const normalizedRoomId = roomId.trim().toUpperCase();
    const room = this.rooms.get(normalizedRoomId);
    if (!room) {
      return { ok: false, message: "방을 찾을 수 없습니다." };
    }
    const playerId = room.addPlayer(socketId);
    if (playerId === undefined) {
      return { ok: false, message: "방이 가득 찼거나 이미 게임이 시작되었습니다." };
    }
    return { ok: true, roomId: normalizedRoomId, playerId, state: room.getBroadcastState() };
  }

  addComputer(socketId: string, roomId: string | undefined, difficulty?: AIDifficulty) {
    this.getRoom(roomId)?.addComputer(socketId, difficulty);
  }

  setPlayerName(socketId: string, roomId: string | undefined, name: string) {
    this.getRoom(roomId)?.setPlayerName(socketId, name);
  }

  removeComputer(socketId: string, roomId: string | undefined, playerId: number) {
    this.getRoom(roomId)?.removeComputer(socketId, playerId);
  }

  setTeam(socketId: string, roomId: string | undefined, playerId: number, teamId: "A" | "B" | "C" | "D") {
    this.getRoom(roomId)?.setTeam(socketId, playerId, teamId);
  }

  setTank(socketId: string, roomId: string | undefined, playerId: number, tankId: string) {
    this.getRoom(roomId)?.setTank(socketId, playerId, tankId);
  }

  randomizeComputerTanks(socketId: string, roomId: string | undefined) {
    const room = this.getRoom(roomId);
    if (!room) return { ok: false, message: "방을 찾을 수 없습니다." };
    return room.randomizeComputerTanks(socketId);
  }

  startMatch(socketId: string, roomId: string | undefined) {
    this.getRoom(roomId)?.startMatch(socketId);
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
