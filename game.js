const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const boardWidth = 360;
const boardHeight = 640;

const ASSET_PATHS = {
  background: "assets/flappybirdbg.png",
  bird: "assets/flappybird.png",
  topPipe: "assets/toppipe.png",
  bottomPipe: "assets/bottompipe.png",
  gameOver: "assets/gameover.png"
};

const images = {};
Object.entries(ASSET_PATHS).forEach(([key, path]) => {
  const img = new Image();
  img.src = path;
  img.onerror = () => console.warn(`Could not load ${path}. Using fallback drawing.`);
  images[key] = img;
});

const startOverlay = document.getElementById("startOverlay");
const gameOverOverlay = document.getElementById("gameOverOverlay");
const restartBtn = document.getElementById("restartBtn");
const finalScoreEl = document.getElementById("finalScore");
const currentScoreEl = document.getElementById("currentScore");
const bestScoreEl = document.getElementById("bestScore");
const topCurrentScoreEl = document.getElementById("topCurrentScore");
const topBestScoreEl = document.getElementById("topBestScore");
const topDifficultyEl = document.getElementById("topDifficulty");
const topRoomCodeEl = document.getElementById("topRoomCode");
const leaderboardList = document.getElementById("leaderboardList");
const nameInput = document.getElementById("nameInput");
const saveNameBtn = document.getElementById("saveNameBtn");
const playerNameEl = document.getElementById("playerName");
const livePlayerNameEl = document.getElementById("livePlayerName");
const connectionStatusEl = document.getElementById("connectionStatus");
const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const leaveRoomBtn = document.getElementById("leaveRoomBtn");
const roomCodeInput = document.getElementById("roomCodeInput");
const roomMessage = document.getElementById("roomMessage");
const activeRoomCodeEl = document.getElementById("activeRoomCode");
const livePlayersList = document.getElementById("livePlayersList");
const matchDurationInput = document.getElementById("matchDurationInput");
const difficultyMenu = document.getElementById("difficultyMenu");
const avatarUpload = document.getElementById("avatarUpload");
const avatarPreview = document.getElementById("avatarPreview");
const characterMenu = document.getElementById("characterMenu");
const roomTimerEl = document.getElementById("roomTimer");
const roomStatusEl = document.getElementById("roomStatus");
const startGameBtn = document.getElementById("startGameBtn");
const winnerModal = document.getElementById("winnerModal");
const winnerAvatarEl = document.getElementById("winnerAvatar");
const winnerNameEl = document.getElementById("winnerName");
const winnerScoreEl = document.getElementById("winnerScore");
const winnerCloseBtn = document.getElementById("winnerCloseBtn");
const copyRoomBtn = document.getElementById("copyRoomBtn");
const quickResetBtn = document.getElementById("quickResetBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");

const CHARACTER_LABELS = {
  zayn: "ZAYN",
  reid: "REID",
  levi: "LEVI",
  maya: "MAYA",
  nova: "NOVA",
  skye: "SKYE"
};

const DIFFICULTY_SETTINGS = {
  easy: {
    label: "Easy",
    pipeSpeed: -3.2,
    openingSpace: Math.round(boardHeight / 3),
    gravity: 0.82,
    flapStrength: -8.3,
    pipeIntervalMs: 1750
  },
  medium: {
    label: "Medium",
    pipeSpeed: -4,
    openingSpace: Math.round(boardHeight / 4),
    gravity: 1,
    flapStrength: -9,
    pipeIntervalMs: 1500
  },
  hard: {
    label: "Hard",
    pipeSpeed: -5.1,
    openingSpace: 132,
    gravity: 1.08,
    flapStrength: -9.6,
    pipeIntervalMs: 1225
  }
};

let playerName = localStorage.getItem("flappyPlayerName") || "Guest";
let playerAvatar = getStoredAvatar();
let bestScore = Number(localStorage.getItem("flappyBestScore") || 0);
let leaderboard = JSON.parse(localStorage.getItem("flappyLeaderboard") || "[]");
let selectedDifficulty = normalizeDifficulty(localStorage.getItem("flappyDifficulty"));

let socket = null;
let connected = false;
let activeRoomCode = null;
let activeMatch = null;
let playerId = null;
let lastSentScore = -1;
let roomClockInterval = null;
let shownWinnerKey = null;

const birdStartX = boardWidth / 8;
const birdStartY = boardHeight / 2;
const bird = { x: birdStartX, y: birdStartY, width: 34, height: 24 };

const pipeConfig = {
  x: boardWidth,
  y: 0,
  width: 64,
  height: 512,
  velocityX: -4,
  openingSpace: boardHeight / 4
};

let pipes = [];
let velocityY = 0;
let gravity = 1;
let flapStrength = -9;
let pipeIntervalMs = 1500;
let score = 0;
let gameOver = false;
let started = false;
let lastPipeTime = 0;
let animationId = null;

function getWebSocketUrl() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${location.host}`;
}

function connectSocket() {
  socket = new WebSocket(getWebSocketUrl());

  socket.addEventListener("open", () => {
    connected = true;
    updateConnectionUI();
    roomMessage.textContent = "Connected. Create a room or join using a code.";
  });

  socket.addEventListener("close", () => {
    connected = false;
    activeRoomCode = null;
    activeMatch = null;
    playerId = null;
    updateTopRoomCode();
    applyDifficulty(selectedDifficulty);
    updateDifficultyUI();
    updateConnectionUI();
    renderLivePlayers([]);
    roomMessage.textContent = "Server disconnected. Refresh after starting the server.";
  });

  socket.addEventListener("message", event => {
    const data = JSON.parse(event.data);

    if (data.type === "joined_room") {
      activeRoomCode = data.roomCode;
      playerId = data.playerId;
      roomCodeInput.value = data.roomCode;
      roomMessage.textContent = `Joined room ${data.roomCode}. Share this code with friends.`;
      activeRoomCodeEl.textContent = data.roomCode;
      updateTopRoomCode();
      shownWinnerKey = null;
      setActiveMatch(data.match);
      sendPlayerStatus();
    }

    if (data.type === "room_state") {
      activeRoomCode = data.roomCode;
      activeRoomCodeEl.textContent = data.roomCode;
      updateTopRoomCode();
      setActiveMatch(data.match);
      renderLivePlayers(data.players || []);
      if (data.match && data.match.status === "ended") showWinnerPopup(data.match.winner);
    }

    if (data.type === "match_ended") {
      setActiveMatch(data.match);
      renderLivePlayers(data.players || []);
      finishTimedMatch();
      showWinnerPopup(data.match && data.match.winner);
    }

    if (data.type === "error") {
      roomMessage.textContent = data.message || "Something went wrong.";
    }
  });
}

function sendSocket(type, payload = {}) {
  if (!connected || !socket || socket.readyState !== WebSocket.OPEN) {
    roomMessage.textContent = "Start the Node server first, then open the game using http://localhost:3000";
    return;
  }
  socket.send(JSON.stringify({ type, ...payload }));
}

function createRoom() {
  saveName();
  hideWinnerPopup();
  sendSocket("create_room", {
    name: playerName,
    avatar: playerAvatar,
    settings: {
      durationSeconds: Number(matchDurationInput.value) || 60,
      difficulty: selectedDifficulty
    }
  });
}

function joinRoom() {
  saveName();
  const roomCode = roomCodeInput.value.trim().toUpperCase();
  if (!roomCode) {
    roomMessage.textContent = "Enter a room code first.";
    return;
  }
  hideWinnerPopup();
  sendSocket("join_room", { roomCode, name: playerName, avatar: playerAvatar });
}

function leaveRoom() {
  sendSocket("leave_room");
  activeRoomCode = null;
  activeMatch = null;
  activeRoomCodeEl.textContent = "SOLO";
  updateTopRoomCode();
  applyDifficulty(selectedDifficulty);
  updateDifficultyUI();
  renderLivePlayers([]);
  updateTimerUI();
  roomMessage.textContent = "Left room. You are playing solo.";
}

function sendScoreUpdate(force = false) {
  if (!activeRoomCode) return;
  if (isRoomMatchOver()) return;
  const current = Math.floor(score);
  if (!force && current === lastSentScore) return;
  lastSentScore = current;
  sendSocket("score_update", { score: current, alive: !gameOver });
}

function sendPlayerStatus() {
  if (!activeRoomCode) return;
  if (activeMatch && activeMatch.status === "waiting") return;
  sendSocket("player_status", {
    score: Math.floor(score),
    alive: !gameOver,
    ready: started
  });
}

function updateConnectionUI() {
  connectionStatusEl.textContent = connected ? "Online" : "Offline";
  connectionStatusEl.classList.toggle("online", connected);
  connectionStatusEl.classList.toggle("offline", !connected);
}

function updateTopRoomCode() {
  topRoomCodeEl.textContent = activeRoomCode || "SOLO";
  copyRoomBtn.disabled = !activeRoomCode;
}

function normalizeDifficulty(value) {
  const difficulty = String(value || "medium").toLowerCase();
  return DIFFICULTY_SETTINGS[difficulty] ? difficulty : "medium";
}

function applyDifficulty(value) {
  const difficulty = normalizeDifficulty(value);
  const settings = DIFFICULTY_SETTINGS[difficulty];

  pipeConfig.velocityX = settings.pipeSpeed;
  pipeConfig.openingSpace = settings.openingSpace;
  gravity = settings.gravity;
  flapStrength = settings.flapStrength;
  pipeIntervalMs = settings.pipeIntervalMs;
  topDifficultyEl.textContent = settings.label;
}

function canChangeDifficulty() {
  return !activeRoomCode || !activeMatch || activeMatch.status === "ended";
}

function updateDifficultyUI() {
  const activeDifficulty = normalizeDifficulty((activeMatch && activeMatch.difficulty) || selectedDifficulty);
  const locked = !canChangeDifficulty();

  difficultyMenu.querySelectorAll("[data-difficulty]").forEach(button => {
    button.classList.toggle("selected", button.dataset.difficulty === activeDifficulty);
    button.disabled = locked;
  });
  topDifficultyEl.textContent = DIFFICULTY_SETTINGS[activeDifficulty].label;
}

function chooseDifficulty(value) {
  if (!canChangeDifficulty()) {
    roomMessage.textContent = "Level is locked for this room. Create a new room to change it.";
    return;
  }

  selectedDifficulty = normalizeDifficulty(value);
  localStorage.setItem("flappyDifficulty", selectedDifficulty);
  applyDifficulty(selectedDifficulty);
  updateDifficultyUI();
  roomMessage.textContent = `Level set to ${DIFFICULTY_SETTINGS[selectedDifficulty].label}.`;
}

async function copyRoomCode() {
  if (!activeRoomCode) {
    roomMessage.textContent = "Create or join a room first.";
    return;
  }

  try {
    await navigator.clipboard.writeText(activeRoomCode);
    roomMessage.textContent = `Room code ${activeRoomCode} copied.`;
  } catch {
    roomCodeInput.select();
    document.execCommand("copy");
    roomMessage.textContent = `Room code ${activeRoomCode} copied.`;
  }
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen();
    return;
  }

  document.documentElement.requestFullscreen().catch(() => {
    roomMessage.textContent = "Fullscreen is not available in this browser.";
  });
}

function getStoredAvatar() {
  try {
    return safeLocalAvatar(JSON.parse(localStorage.getItem("flappyPlayerAvatar") || "{}"));
  } catch {
    return { type: "character", value: "zayn" };
  }
}

function safeLocalAvatar(avatar) {
  if (!avatar || typeof avatar !== "object") return { type: "character", value: "zayn" };
  if (avatar.type === "image" && typeof avatar.value === "string" && avatar.value.startsWith("data:image/")) {
    return { type: "image", value: avatar.value };
  }
  if (avatar.type === "character" && CHARACTER_LABELS[avatar.value]) {
    return { type: "character", value: avatar.value };
  }
  return { type: "character", value: "zayn" };
}

function characterImagePath(value) {
  return `assets/${value}.png`;
}

function addCharacterImage(element, value, name) {
  const img = document.createElement("img");
  img.src = characterImagePath(value);
  img.alt = "";
  img.addEventListener("error", () => {
    img.remove();
    element.textContent = CHARACTER_LABELS[value] || initialsForName(name);
  }, { once: true });
  element.appendChild(img);
}

function saveAvatar(avatar) {
  playerAvatar = safeLocalAvatar(avatar);
  localStorage.setItem("flappyPlayerAvatar", JSON.stringify(playerAvatar));
  updateAvatarUI();
}

function updateAvatarUI() {
  const avatar = safeLocalAvatar(playerAvatar);
  avatarPreview.className = "avatar-preview";
  avatarPreview.innerHTML = "";

  if (avatar.type === "image") {
    const img = document.createElement("img");
    img.src = avatar.value;
    img.alt = "";
    avatarPreview.appendChild(img);
  } else {
    avatarPreview.classList.add("character-avatar", `avatar-${avatar.value}`);
    addCharacterImage(avatarPreview, avatar.value, playerName);
  }

  characterMenu.querySelectorAll("[data-character]").forEach(button => {
    button.classList.toggle("selected", avatar.type === "character" && button.dataset.character === avatar.value);
  });
}

function renderAvatarHtml(avatar, name, className = "player-avatar") {
  const safeAvatar = safeLocalAvatar(avatar);
  if (safeAvatar.type === "image") {
    return `<span class="${className}"><img src="${escapeHtml(safeAvatar.value)}" alt=""></span>`;
  }

  const value = safeAvatar.value;
  const label = CHARACTER_LABELS[value] || initialsForName(name);
  return `<span class="${className} character-avatar avatar-${value}"><img src="${escapeHtml(characterImagePath(value))}" alt="" onerror="this.remove();this.parentElement.textContent='${escapeHtml(label)}';"></span>`;
}

function initialsForName(name) {
  return String(name || "Guest").trim().slice(0, 4).toUpperCase() || "ZAYN";
}

function resizeAvatarFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Choose a PNG, JPG, or WebP image."));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 128;
        const sourceSize = Math.min(img.width, img.height);
        const sourceX = (img.width - sourceSize) / 2;
        const sourceY = (img.height - sourceSize) / 2;
        const avatarCanvas = document.createElement("canvas");
        const avatarCtx = avatarCanvas.getContext("2d");
        avatarCanvas.width = size;
        avatarCanvas.height = size;
        avatarCtx.drawImage(img, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
        resolve(avatarCanvas.toDataURL("image/webp", 0.82));
      };
      img.onerror = () => reject(new Error("Could not read that image."));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.readAsDataURL(file);
  });
}

function renderLivePlayers(players) {
  livePlayersList.innerHTML = "";

  if (!players.length) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="player-row">${renderAvatarHtml(playerAvatar, playerName)}<span>${escapeHtml(playerName)}</span></span><b data-live-player-score>${Math.floor(score)}</b>`;
    livePlayersList.appendChild(li);
    return;
  }

  players.forEach(player => {
    const li = document.createElement("li");
    if (!player.alive) li.classList.add("dead");
    const ids = Array.isArray(player.playerIds) ? player.playerIds : [player.id];
    const you = ids.includes(playerId) ? " <small>(you)</small>" : "";
    const status = player.connected ? (player.alive ? "" : " <small>out</small>") : " <small>left</small>";
    li.innerHTML = `<span class="player-row">${renderAvatarHtml(player.avatar, player.name)}<span>${escapeHtml(player.name)}${you}${status}</span></span><b>${player.bestScore}</b>`;
    livePlayersList.appendChild(li);
  });
}

function updateProfileUI() {
  playerNameEl.textContent = playerName;
  livePlayerNameEl.textContent = playerName;
  nameInput.value = playerName === "Guest" ? "" : playerName;
  bestScoreEl.textContent = bestScore;
  topBestScoreEl.textContent = bestScore;
  updateAvatarUI();
  renderLeaderboard();
  if (!activeRoomCode) renderLivePlayers([]);
}

function saveName() {
  const value = nameInput.value.trim();
  playerName = value || "Guest";
  localStorage.setItem("flappyPlayerName", playerName);
  updateProfileUI();
}

function renderLeaderboard() {
  leaderboardList.innerHTML = "";
  const entries = leaderboard.slice(0, 8);

  if (entries.length === 0) {
    const li = document.createElement("li");
    li.innerHTML = "<span>No runs yet</span><b>0</b>";
    leaderboardList.appendChild(li);
    return;
  }

  entries.forEach(entry => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${escapeHtml(entry.name)}</span><b>${entry.score}</b>`;
    leaderboardList.appendChild(li);
  });
}

function leaderboardKey(name) {
  return String(name || "Guest").trim().toLocaleLowerCase() || "guest";
}

function normalizeLeaderboard(entries) {
  const byName = new Map();

  entries.forEach(entry => {
    const name = String(entry.name || "Guest").trim() || "Guest";
    const score = Number(entry.score) || 0;
    const key = leaderboardKey(name);
    const existing = byName.get(key);

    if (!existing || score > existing.score) {
      byName.set(key, {
        name,
        score,
        date: entry.date || new Date().toISOString()
      });
    }
  });

  return Array.from(byName.values())
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 20);
}

function saveLeaderboardScore(name, newScore) {
  const key = leaderboardKey(name);
  const existing = leaderboard.find(entry => leaderboardKey(entry.name) === key);

  if (existing) {
    existing.name = name;
    existing.score = Math.max(Number(existing.score) || 0, newScore);
    existing.date = new Date().toISOString();
  } else {
    leaderboard.push({ name, score: newScore, date: new Date().toISOString() });
  }

  leaderboard.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  leaderboard = leaderboard.slice(0, 20);
  localStorage.setItem("flappyLeaderboard", JSON.stringify(leaderboard));
}

function setActiveMatch(match) {
  activeMatch = match || null;
  if (activeMatch && Number.isFinite(activeMatch.durationSeconds)) {
    matchDurationInput.value = activeMatch.durationSeconds;
  }
  if (activeMatch && activeMatch.difficulty) {
    selectedDifficulty = normalizeDifficulty(activeMatch.difficulty);
    localStorage.setItem("flappyDifficulty", selectedDifficulty);
    applyDifficulty(selectedDifficulty);
  } else {
    applyDifficulty(selectedDifficulty);
  }
  startRoomClock();
  updateTimerUI();
  updateDifficultyUI();
}

function startRoomClock() {
  if (roomClockInterval) return;
  roomClockInterval = setInterval(updateTimerUI, 250);
}

function isRoomMatchOver() {
  if (!activeRoomCode || !activeMatch) return false;
  return activeMatch.status === "ended" ||
    (activeMatch.status === "active" && Date.now() >= Number(activeMatch.endsAt || 0));
}

function isRoomMatchWaiting() {
  return Boolean(activeRoomCode && activeMatch && activeMatch.status === "waiting");
}

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function updateTimerUI() {
  if (!activeRoomCode) {
    roomStatusEl.textContent = "Solo run";
    roomTimerEl.textContent = "--:--";
    updateStartGameButton();
    return;
  }

  if (!activeMatch) {
    roomStatusEl.textContent = "Waiting";
    roomTimerEl.textContent = "--:--";
    updateStartGameButton();
    return;
  }

  if (activeMatch.status === "ended") {
    roomStatusEl.textContent = "Finished";
    roomTimerEl.textContent = "00:00";
    updateStartGameButton();
    return;
  }

  if (activeMatch.status === "waiting") {
    roomStatusEl.textContent = "Ready";
    roomTimerEl.textContent = formatTime(Number(activeMatch.remainingMs || 0));
    updateStartGameButton();
    return;
  }

  const remaining = Number(activeMatch.endsAt || 0) - Date.now();
  roomStatusEl.textContent = remaining <= 0 ? "Finishing" : "Live timer";
  roomTimerEl.textContent = formatTime(remaining);
  updateStartGameButton();

  if (remaining <= 0 && started && !gameOver) {
    finishTimedMatch();
  }
}

function updateStartGameButton() {
  const hasActiveRoom = Boolean(activeRoomCode && activeMatch);
  const status = activeMatch && activeMatch.status;

  startGameBtn.disabled = !hasActiveRoom || status !== "waiting";
  if (status === "active") {
    startGameBtn.textContent = "GAME STARTED";
  } else if (status === "ended") {
    startGameBtn.textContent = "FINISHED";
  } else {
    startGameBtn.textContent = "START GAME";
  }
}

function startGame() {
  if (!activeRoomCode) return;
  sendSocket("start_game");
}

function recordFinalScore(final) {
  finalScoreEl.textContent = final;

  if (final > bestScore) {
    bestScore = final;
    localStorage.setItem("flappyBestScore", bestScore);
  }

  saveLeaderboardScore(playerName, final);
  updateProfileUI();
}

function resetLocalRun({ notifyRoom = true } = {}) {
  cancelAnimationFrame(animationId);
  bird.x = birdStartX;
  bird.y = birdStartY;
  velocityY = 0;
  pipes = [];
  score = 0;
  gameOver = false;
  started = false;
  lastPipeTime = 0;
  lastSentScore = -1;
  updateScoreUI();
  gameOverOverlay.classList.add("hidden");
  startOverlay.classList.remove("hidden");
  restartBtn.textContent = "Play Again";
  draw();
  if (notifyRoom) sendPlayerStatus();
}

function finishTimedMatch() {
  if (!activeRoomCode) return;

  const final = Math.floor(score);
  gameOverOverlay.classList.remove("hidden");
  restartBtn.textContent = "Challenge Again";

  if (!gameOver) {
    gameOver = true;
    cancelAnimationFrame(animationId);
    recordFinalScore(final);
  }
}

function showWinnerPopup(winner) {
  if (!activeRoomCode || !activeMatch || activeMatch.status !== "ended") return;

  const winnerKey = `${activeRoomCode}:${winner ? `${winner.name}:${winner.score}` : "none"}`;
  if (shownWinnerKey === winnerKey && !winnerModal.classList.contains("hidden")) return;
  shownWinnerKey = winnerKey;

  winnerAvatarEl.className = "winner-avatar";
  winnerAvatarEl.innerHTML = "";

  if (winner) {
    const safeAvatar = safeLocalAvatar(winner.avatar);
    if (safeAvatar.type === "image") {
      const img = document.createElement("img");
      img.src = safeAvatar.value;
      img.alt = "";
      winnerAvatarEl.appendChild(img);
    } else {
      winnerAvatarEl.classList.add("character-avatar", `avatar-${safeAvatar.value}`);
      addCharacterImage(winnerAvatarEl, safeAvatar.value, winner.name);
    }
    winnerNameEl.textContent = winner.name;
    winnerScoreEl.textContent = winner.score;
  } else {
    winnerAvatarEl.classList.add("character-avatar", "avatar-zayn");
    winnerAvatarEl.textContent = "ZAYN";
    winnerNameEl.textContent = "No winner";
    winnerScoreEl.textContent = "0";
  }

  winnerModal.classList.remove("hidden");
}

function hideWinnerPopup() {
  winnerModal.classList.add("hidden");
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;"
  }[char]));
}

function drawImageOrFallback(img, fallback, x, y, width, height) {
  if (img && img.complete && img.naturalWidth > 0) ctx.drawImage(img, x, y, width, height);
  else fallback(x, y, width, height);
}

function drawBackground() {
  drawImageOrFallback(images.background, (x, y, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, boardHeight);
    gradient.addColorStop(0, "#70c5ce");
    gradient.addColorStop(1, "#d9f99d");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.beginPath();
    ctx.arc(70, 95, 24, 0, Math.PI * 2);
    ctx.arc(96, 92, 32, 0, Math.PI * 2);
    ctx.arc(126, 99, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#86efac";
    ctx.fillRect(0, boardHeight - 60, boardWidth, 60);
  }, 0, 0, boardWidth, boardHeight);
}

function drawBird() {
  drawImageOrFallback(images.bird, (x, y, w, h) => {
    ctx.fillStyle = "#facc15";
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x + w - 10, y + 8, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#111827";
    ctx.beginPath();
    ctx.arc(x + w - 8, y + 8, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fb923c";
    ctx.fillRect(x + w - 1, y + 10, 10, 6);
  }, bird.x, bird.y, bird.width, bird.height);
}

function drawPipe(pipe) {
  const img = pipe.isTop ? images.topPipe : images.bottomPipe;
  drawImageOrFallback(img, (x, y, w, h) => {
    ctx.fillStyle = "#22c55e";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#16a34a";
    ctx.fillRect(x + 8, y, w - 16, h);
    ctx.strokeStyle = "#14532d";
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);
  }, pipe.x, pipe.y, pipe.width, pipe.height);
}

function drawScore() {
  ctx.fillStyle = "white";
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 4;
  ctx.font = "900 28px 'Courier New', monospace";
  const text = String(Math.floor(score));
  ctx.strokeText(text, 10, 35);
  ctx.fillText(text, 10, 35);
}

function draw() {
  ctx.clearRect(0, 0, boardWidth, boardHeight);
  drawBackground();
  drawBird();
  pipes.forEach(drawPipe);
  drawScore();
}

function placePipes() {
  const randomPipeY = Math.floor(pipeConfig.y - pipeConfig.height / 4 - Math.random() * (pipeConfig.height / 2));
  pipes.push({ x: pipeConfig.x, y: randomPipeY, width: pipeConfig.width, height: pipeConfig.height, passed: false, isTop: true });
  pipes.push({ x: pipeConfig.x, y: randomPipeY + pipeConfig.height + pipeConfig.openingSpace, width: pipeConfig.width, height: pipeConfig.height, passed: false, isTop: false });
}

function move(timestamp) {
  velocityY += gravity;
  bird.y += velocityY;
  bird.y = Math.max(bird.y, 0);

  if (!lastPipeTime || timestamp - lastPipeTime > pipeIntervalMs) {
    placePipes();
    lastPipeTime = timestamp;
  }

  pipes.forEach(pipe => {
    pipe.x += pipeConfig.velocityX;
    if (!pipe.passed && bird.x > pipe.x + pipe.width) {
      pipe.passed = true;
      score += 0.5;
    }
    if (collision(bird, pipe)) endGame();
  });

  pipes = pipes.filter(pipe => pipe.x + pipe.width > -20);
  if (bird.y > boardHeight) endGame();
}

function collision(a, b) {
  return a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y;
}

function loop(timestamp) {
  if (isRoomMatchWaiting()) {
    draw();
    if (!gameOver) animationId = requestAnimationFrame(loop);
    return;
  }

  if (isRoomMatchOver() && started && !gameOver) {
    finishTimedMatch();
    draw();
    return;
  }

  if (!gameOver && started) {
    move(timestamp);
    updateScoreUI();
    sendScoreUpdate();
  }
  draw();
  if (!gameOver) animationId = requestAnimationFrame(loop);
}

function updateScoreUI() {
  const current = Math.floor(score);
  currentScoreEl.textContent = current;
  topCurrentScoreEl.textContent = current;
  const liveScoreEl = document.querySelector("[data-live-player-score]");
  if (liveScoreEl) liveScoreEl.textContent = current;
}

function flap() {
  if (isRoomMatchWaiting()) {
    roomMessage.textContent = "Press START GAME to begin the timed match.";
    return;
  }

  if (isRoomMatchOver()) {
    roomMessage.textContent = "This timed match is finished. Press Challenge Again for a new room.";
    return;
  }

  if (!started) {
    started = true;
    startOverlay.classList.add("hidden");
    sendPlayerStatus();
    animationId = requestAnimationFrame(loop);
  }
  if (!gameOver) velocityY = flapStrength;
}

function endGame() {
  if (gameOver) return;

  gameOver = true;
  const final = Math.floor(score);
  gameOverOverlay.classList.remove("hidden");
  restartBtn.textContent = isRoomMatchOver() ? "Challenge Again" : "Play Again";
  recordFinalScore(final);
  sendScoreUpdate(true);
  sendPlayerStatus();
}

function challengeAgain() {
  if (!activeRoomCode || !isRoomMatchOver()) {
    resetGame();
    return;
  }

  resetLocalRun({ notifyRoom: false });
  hideWinnerPopup();
  createRoom();
  roomMessage.textContent = "Creating a fresh challenge room...";
}

function resetGame() {
  if (isRoomMatchWaiting()) {
    roomMessage.textContent = "Press START GAME to begin the timed match.";
    return;
  }

  if (isRoomMatchOver()) {
    roomMessage.textContent = "This timed match is finished. Press Challenge Again for a new room.";
    return;
  }

  resetLocalRun();
}

window.addEventListener("keydown", event => {
  if (event.code === "Space") {
    event.preventDefault();
    flap();
  }
  if (event.code === "KeyR" && gameOver) resetGame();
});

canvas.addEventListener("click", flap);
canvas.addEventListener("touchstart", event => {
  event.preventDefault();
  flap();
}, { passive: false });

restartBtn.addEventListener("click", challengeAgain);
copyRoomBtn.addEventListener("click", copyRoomCode);
quickResetBtn.addEventListener("click", challengeAgain);
fullscreenBtn.addEventListener("click", toggleFullscreen);
saveNameBtn.addEventListener("click", saveName);
nameInput.addEventListener("keydown", event => {
  if (event.key === "Enter") saveName();
});
characterMenu.addEventListener("click", event => {
  const button = event.target.closest("[data-character]");
  if (!button) return;
  saveAvatar({ type: "character", value: button.dataset.character });
  avatarUpload.value = "";
});
difficultyMenu.addEventListener("click", event => {
  const button = event.target.closest("[data-difficulty]");
  if (!button) return;
  chooseDifficulty(button.dataset.difficulty);
});
avatarUpload.addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const value = await resizeAvatarFile(file);
    saveAvatar({ type: "image", value });
    roomMessage.textContent = "Profile image ready for your next room.";
  } catch (error) {
    roomMessage.textContent = error.message || "Could not load that profile image.";
  }
});
createRoomBtn.addEventListener("click", createRoom);
joinRoomBtn.addEventListener("click", joinRoom);
leaveRoomBtn.addEventListener("click", leaveRoom);
startGameBtn.addEventListener("click", startGame);
matchDurationInput.addEventListener("change", () => {
  const seconds = Number(matchDurationInput.value) || 60;
  matchDurationInput.value = Math.max(15, Math.min(300, Math.round(seconds / 15) * 15));
});
roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});
roomCodeInput.addEventListener("keydown", event => {
  if (event.key === "Enter") joinRoom();
});
winnerCloseBtn.addEventListener("click", hideWinnerPopup);
winnerModal.addEventListener("click", event => {
  if (event.target === winnerModal) hideWinnerPopup();
});

leaderboard = normalizeLeaderboard(leaderboard);
localStorage.setItem("flappyLeaderboard", JSON.stringify(leaderboard));
applyDifficulty(selectedDifficulty);
updateProfileUI();
updateConnectionUI();
updateTopRoomCode();
updateDifficultyUI();
updateTimerUI();
connectSocket();
draw();
