import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import { applyAction } from "../../shared/src/game";
import {
  createRoom,
  addHuman,
  maybeRunCpuTurn,
  nextHand,
  rematch,
  viewFor,
  CpuDifficulty
} from "./gameRoom";

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const rooms = new Map<string, ReturnType<typeof createRoom>>();
const playerToRoom = new Map<string, string>();

io.on("connection", (socket) => {
  socket.on("room:create", (payload: any, cb: any) => {
    const name = (payload?.name ?? "Host").toString();
    const cpuCount = Math.max(0, Math.min(parseInt(payload?.cpuCount ?? 0, 10), 8));
    const diff: CpuDifficulty =
      payload?.cpuDifficulty === "easy" || payload?.cpuDifficulty === "medium" || payload?.cpuDifficulty === "hard"
        ? payload.cpuDifficulty
        : "medium";

    const room = createRoom(name, cpuCount, diff);
    rooms.set(room.id, room);

    const host = room.state.players[0];
    room.socketsByPlayerId.set(host.id, socket.id);
    playerToRoom.set(host.id, room.id);

    socket.join(room.id);
    cb?.({ roomId: room.id, playerId: host.id, state: viewFor(room, host.id) });

    broadcast(room);
    runCpuLoop(room);
  });

  socket.on("room:join", (payload: any, cb: any) => {
    const roomId = (payload?.roomId ?? "").toString().trim().toUpperCase();
    const name = (payload?.name ?? "Player").toString();

    const room = rooms.get(roomId);
    if (!room) return cb?.({ error: "Room not found." });

    const p = addHuman(room, name);

    room.socketsByPlayerId.set(p.id, socket.id);
    playerToRoom.set(p.id, roomId);

    socket.join(roomId);
    cb?.({ roomId, playerId: p.id, state: viewFor(room, p.id) });

    broadcast(room);
    runCpuLoop(room);
  });

  socket.on("act", (payload: any, cb: any) => {
    const playerId = payload?.playerId;
    const action = payload?.action;

    const roomId = playerToRoom.get(playerId);
    if (!roomId) return cb?.({ error: "Unknown player." });
    const room = rooms.get(roomId);
    if (!room) return cb?.({ error: "Room missing." });

    const res = applyAction(room.state, playerId, action);
    if (!res.ok) return cb?.({ error: res.error });

    broadcast(room);
    runCpuLoop(room);
    cb?.({ ok: true });
  });

  socket.on("hand:next", (payload: any, cb: any) => {
    const playerId = payload?.playerId;

    const roomId = playerToRoom.get(playerId);
    if (!roomId) return cb?.({ error: "Unknown player." });
    const room = rooms.get(roomId);
    if (!room) return cb?.({ error: "Room missing." });

    nextHand(room);
    broadcast(room);
    runCpuLoop(room);
    cb?.({ ok: true });
  });

  socket.on("room:rematch", (payload: any, cb: any) => {
    const playerId = payload?.playerId;

    const roomId = playerToRoom.get(playerId);
    if (!roomId) return cb?.({ error: "Unknown player." });
    const room = rooms.get(roomId);
    if (!room) return cb?.({ error: "Room missing." });

    rematch(room);
    broadcast(room);
    runCpuLoop(room);
    cb?.({ ok: true });
  });

  socket.on("disconnect", () => {
    // Minimal version: no reconnect logic
  });
});

function broadcast(room: any) {
  for (const p of room.state.players) {
    const sid = room.socketsByPlayerId.get(p.id);
    if (!sid) continue;
    io.to(sid).emit("state", viewFor(room, p.id));
  }
  io.to(room.id).emit("state:spectator", viewFor(room, null));
}

function runCpuLoop(room: any) {
  let guard = 0;
  while (guard++ < 50) {
    if (room.state.phase === "HAND_OVER" || room.state.phase === "GAME_OVER" || room.state.phase === "SHOWDOWN") break;

    const current = room.state.players[room.state.turnIndex];
    if (!current) break;
    if (current.eliminated) {
      room.state.turnIndex = require("../../shared/src/game").nextActiveIndex(room.state, room.state.turnIndex);
      continue;
    }
    if (current.type === "HUMAN") break;

    const before = room.state.turnIndex;
    maybeRunCpuTurn(room, () => {});
    if (room.state.turnIndex === before) break;
  }
  broadcast(room);
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
