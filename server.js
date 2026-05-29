const express = require("express");
const http = require("http");
const path = require("path");
const { WebSocketServer } = require("ws");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const EMPTY_ROOM_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MATCH_SECONDS = 60;
const MIN_MATCH_SECONDS = 15;
const MAX_MATCH_SECONDS = 300;
const MAX_AVATAR_DATA_URL_LENGTH = 120000;
const DIFFICULTY_LEVELS = new Set(["easy", "medium", "hard"]);
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname)));

const rooms = new Map();

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function uniqueRoomCode() {
  let code = makeRoomCode();
  while (rooms.has(code)) code = makeRoomCode();
  return code;
}

const CHARACTER_AVATARS = new Set(["zayn", "reid", "levi", "maya", "nova", "skye"]);

function normalizeDurationSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return DEFAULT_MATCH_SECONDS;
  return Math.max(MIN_MATCH_SECONDS, Math.min(MAX_MATCH_SECONDS, Math.round(seconds)));
}

function normalizeDifficulty(value) {
  const difficulty = String(value || "medium").toLowerCase();
  return DIFFICULTY_LEVELS.has(difficulty) ? difficulty : "medium";
}

function safeAvatar(avatar) {
  if (!avatar || typeof avatar !== "object") return { type: "character", value: "zayn" };

  if (avatar.type === "image" && typeof avatar.value === "string") {
    const value = avatar.value;
    const isAllowedImage = /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value);
    if (isAllowedImage && value.length <= MAX_AVATAR_DATA_URL_LENGTH) {
      return { type: "image", value };
    }
  }

  if (avatar.type === "character" && CHARACTER_AVATARS.has(avatar.value)) {
    return { type: "character", value: avatar.value };
  }

  return { type: "character", value: "zayn" };
}

function createRoom(roomCode, settings = {}) {
  const durationSeconds = normalizeDurationSeconds(settings.durationSeconds);
  const difficulty = normalizeDifficulty(settings.difficulty);
  const remainingMs = durationSeconds * 1000;

  rooms.set(roomCode, {
    players: new Map(),
    scores: new Map(),
    createdAt: Date.now(),
    cleanupTimer: null,
    matchTimer: null,
    durationSeconds,
    difficulty,
    remainingMs,
    endsAt: null,
    endedAt: null,
    status: "waiting",
    winner: null
  });
}

function clearMatchTimer(room) {
  if (!room || !room.matchTimer) return;
  clearTimeout(room.matchTimer);
  room.matchTimer = null;
}

function startRoomMatch(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || room.status !== "waiting") return;

  room.remainingMs = room.durationSeconds * 1000;
  if (room.remainingMs <= 0) {
    endRoomMatch(roomCode);
    return;
  }

  room.endsAt = Date.now() + room.remainingMs;
  clearMatchTimer(room);
  room.matchTimer = setTimeout(() => endRoomMatch(roomCode), room.remainingMs);
  room.status = "active";
  broadcastRoomState(roomCode);
}

function destroyRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  clearMatchTimer(room);
  rooms.delete(roomCode);
}

function scheduleRoomCleanup(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || room.players.size > 0 || room.cleanupTimer) return;

  room.cleanupTimer = setTimeout(() => {
    const latestRoom = rooms.get(roomCode);
    if (latestRoom && latestRoom.players.size === 0) destroyRoom(roomCode);
  }, EMPTY_ROOM_TTL_MS);
}

function cancelRoomCleanup(room) {
  if (!room || !room.cleanupTimer) return;
  clearTimeout(room.cleanupTimer);
  room.cleanupTimer = null;
}

function safeName(name) {
  return String(name || "Guest").trim().slice(0, 18) || "Guest";
}

function scoreKeyForName(name) {
  return safeName(name).toLocaleLowerCase();
}

function makeScoreRecord(name) {
  return {
    name,
    avatar: { type: "character", value: "zayn" },
    score: 0,
    bestScore: 0,
    alive: true,
    ready: false,
    connected: false,
    playerIds: []
  };
}

function updateScoreRecord(room, scoreKey) {
  const players = Array.from(room.players.values()).filter(player => player.scoreKey === scoreKey);
  const record = room.scores.get(scoreKey);
  if (!record) return;

  record.connected = players.length > 0;
  record.playerIds = players.map(player => player.id);

  if (players.length === 0) {
    record.alive = false;
    record.ready = false;
    record.score = 0;
    return;
  }

  const topRun = players.reduce((best, player) => (
    player.score > best.score ? player : best
  ), players[0]);

  record.name = topRun.name;
  record.avatar = topRun.avatar;
  record.score = topRun.score;
  record.bestScore = Math.max(record.bestScore || 0, ...players.map(player => player.bestScore || player.score || 0));
  record.alive = players.some(player => player.alive);
  record.ready = players.some(player => player.ready);
}

function getRoomSnapshot(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return [];
  return Array.from(room.scores.values())
    .map(record => ({
      id: record.playerIds[0] || null,
      playerIds: record.playerIds,
      name: record.name,
      avatar: record.avatar,
      score: record.score,
      bestScore: record.bestScore,
      alive: record.alive,
      ready: record.ready,
      connected: record.connected
    }))
    .sort((a, b) => b.bestScore - a.bestScore || b.score - a.score || a.name.localeCompare(b.name));
}

function getWinner(room) {
  return Array.from(room.scores.values())
    .filter(record => record.bestScore > 0 || record.score > 0 || record.connected)
    .sort((a, b) => b.bestScore - a.bestScore || b.score - a.score || a.name.localeCompare(b.name))[0] || null;
}

function getMatchSnapshot(room) {
  const remainingMs = room.status === "active"
    ? Math.max(0, room.endsAt - Date.now())
    : Math.max(0, room.remainingMs || 0);

  return {
    durationSeconds: room.durationSeconds,
    difficulty: room.difficulty,
    endsAt: room.endsAt,
    remainingMs,
    endedAt: room.endedAt,
    status: room.status,
    winner: room.winner
  };
}

function send(ws, type, payload = {}) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type, ...payload }));
  }
}

function broadcast(roomCode, type, payload = {}) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const message = JSON.stringify({ type, ...payload });
  for (const player of room.players.values()) {
    if (player.ws.readyState === player.ws.OPEN) player.ws.send(message);
  }
}

function broadcastRoomState(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  broadcast(roomCode, "room_state", {
    roomCode,
    players: getRoomSnapshot(roomCode),
    playerCount: room.players.size,
    match: getMatchSnapshot(room)
  });
}

function endRoomMatch(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || room.status === "ended") return;

  clearMatchTimer(room);

  const winner = getWinner(room);
  room.status = "ended";
  room.endedAt = Date.now();
  room.remainingMs = 0;
  room.winner = winner ? {
    name: winner.name,
    avatar: winner.avatar,
    score: winner.bestScore
  } : null;

  broadcastRoomState(roomCode);
  broadcast(roomCode, "match_ended", {
    roomCode,
    match: getMatchSnapshot(room),
    players: getRoomSnapshot(roomCode)
  });
}

wss.on("connection", ws => {
  const id = crypto.randomUUID();
  ws.playerId = id;
  ws.roomCode = null;

  ws.on("message", raw => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      send(ws, "error", { message: "Invalid message format." });
      return;
    }

    if (data.type === "create_room") {
      const roomCode = uniqueRoomCode();
      createRoom(roomCode, data.settings);
      joinRoom(ws, roomCode, data.name, data.avatar);
      return;
    }

    if (data.type === "join_room") {
      const roomCode = String(data.roomCode || "").trim().toUpperCase();
      if (!rooms.has(roomCode)) {
        send(ws, "error", { message: "Room not found. Check the code or create a new room." });
        return;
      }
      joinRoom(ws, roomCode, data.name, data.avatar);
      return;
    }

    if (data.type === "leave_room") {
      leaveRoom(ws);
      return;
    }

    if (data.type === "start_game") {
      startRoomMatch(ws.roomCode);
      return;
    }

    if (data.type === "score_update") {
      const room = rooms.get(ws.roomCode);
      if (!room || !room.players.has(ws.playerId)) return;
      if (room.status === "waiting") {
        broadcastRoomState(ws.roomCode);
        return;
      }
      if (room.status === "ended" || Date.now() >= room.endsAt) {
        endRoomMatch(ws.roomCode);
        return;
      }
      const player = room.players.get(ws.playerId);
      player.score = Number(data.score) || 0;
      player.bestScore = Math.max(player.bestScore || 0, player.score);
      player.alive = data.alive !== false;
      updateScoreRecord(room, player.scoreKey);
      broadcastRoomState(ws.roomCode);
      return;
    }

    if (data.type === "player_status") {
      const room = rooms.get(ws.roomCode);
      if (!room || !room.players.has(ws.playerId)) return;
      if (room.status === "ended") {
        broadcastRoomState(ws.roomCode);
        return;
      }
      const player = room.players.get(ws.playerId);
      if (typeof data.alive === "boolean") player.alive = data.alive;
      if (typeof data.ready === "boolean") player.ready = data.ready;
      if (Number.isFinite(data.score)) player.score = data.score;
      player.bestScore = Math.max(player.bestScore || 0, player.score || 0);
      updateScoreRecord(room, player.scoreKey);
      broadcastRoomState(ws.roomCode);
    }
  });

  ws.on("close", () => leaveRoom(ws));
});

function joinRoom(ws, roomCode, name, avatar) {
  leaveRoom(ws);

  const room = rooms.get(roomCode);
  if (!room) return;
  cancelRoomCleanup(room);

  const playerName = safeName(name);
  const scoreKey = scoreKeyForName(playerName);
  const playerAvatar = safeAvatar(avatar);
  if (!room.scores.has(scoreKey)) {
    room.scores.set(scoreKey, makeScoreRecord(playerName));
  }

  const scoreRecord = room.scores.get(scoreKey);
  scoreRecord.avatar = playerAvatar;
  ws.roomCode = roomCode;
  room.players.set(ws.playerId, {
    id: ws.playerId,
    name: playerName,
    avatar: playerAvatar,
    scoreKey,
    score: 0,
    bestScore: scoreRecord.bestScore || 0,
    alive: true,
    ready: false,
    ws
  });
  updateScoreRecord(room, scoreKey);

  send(ws, "joined_room", { roomCode, playerId: ws.playerId, match: getMatchSnapshot(room) });
  broadcastRoomState(roomCode);
}

function leaveRoom(ws) {
  const roomCode = ws.roomCode;
  if (!roomCode || !rooms.has(roomCode)) return;

  const room = rooms.get(roomCode);
  const player = room.players.get(ws.playerId);
  room.players.delete(ws.playerId);
  ws.roomCode = null;
  if (player) updateScoreRecord(room, player.scoreKey);

  if (room.players.size === 0) {
    scheduleRoomCleanup(roomCode);
  } else {
    broadcastRoomState(roomCode);
  }
}

server.listen(PORT, HOST, () => {
  console.log(`Flappy Arena running at http://localhost:${PORT}`);
  console.log(`Listening on ${HOST}:${PORT}. Use your public server URL for worldwide rooms.`);
});
