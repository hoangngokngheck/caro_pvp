const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const mysql = require("mysql2/promise");
const path = require("path");

const app = express();

// Serve file tĩnh (lobby, game, history)
app.use(express.static(path.join(__dirname)));

app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server);

/* ===================== KẾT NỐI MYSQL ===================== */
const pool = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "552004",
  database: "caro_pvp",
});

// Chuyển Date/ISO -> "YYYY-MM-DD HH:MM:SS"
function toMySQLDateTime(jsDate) {
  if (!jsDate) return null;
  const d = new Date(jsDate);
  const pad = (n) => (n < 10 ? "0" + n : n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/* ===================== BỘ NHỚ TẠM ===================== */
let nextUserId = 1;
let nextMatchId = 1;
const users = new Map();    // id -> { id, username }
const matches = new Map();  // id -> match state

// Online presence + Invites
const onlineUsers = new Map();       // userId -> { socketId, username }
const userStatus  = new Map();       // userId -> "idle" | "in_match"
const invites     = {};              // targetId -> [{ fromId, fromName, sentAt }]

/* ===================== REST API ===================== */

// Login giả
app.post("/api/login", (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: "Thiếu username" });
  const user = { id: nextUserId++, username, createdAt: new Date().toISOString() };
  users.set(user.id, user);
  res.json(user);
});

// Trang mặc định → lobby
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "lobby.html")));

// Danh sách trận đang mở / đang chơi (từ RAM)
app.get("/api/matches", (req, res) => {
  const list = Array.from(matches.values()).map((m) => ({
    id: m.id,
    status: m.status,
    players: m.players.map((id) => users.get(id)?.username || "unknown"),
  }));
  res.json(list);
});

// Tạo trận (user X) — set in_match + xóa lời mời liên quan
app.post("/api/matches", (req, res) => {
  const { userId } = req.body || {};
  if (!userId || !users.get(userId)) return res.status(400).json({ error: "Sai userId" });

  const m = {
    id: nextMatchId++,
    type: "pvp",
    status: "waiting",
    startedAt: null,
    endedAt: null,
    players: [userId],                // [X, O]
    sockets: { X: null, O: null },    // socket.id
    turn: "X",
    timer: null,
    _saved: false,                    // đã lưu DB chưa
    _votes: new Set(),                // rematch votes (socket.id)
  };
  matches.set(m.id, m);

  // user vào trận -> set in_match & dọn lời mời
  userStatus.set(userId, "in_match");
  delete invites[userId];                 // xóa lời mời đến user
  removeInvitesBySender(userId);         // xóa lời mời user đã gửi
  broadcastOnlineUsers();

  res.json({ matchId: m.id });
});

// Tham gia trận (user O) — set in_match + xóa lời mời liên quan
app.post("/api/matches/:id/join", (req, res) => {
  const matchId = Number(req.params.id);
  const { userId } = req.body || {};
  const m = matches.get(matchId);
  if (!m) return res.status(404).json({ error: "Không tìm thấy trận" });
  if (!userId || !users.get(userId)) return res.status(400).json({ error: "Sai userId" });
  if (m.players.length >= 2) return res.status(400).json({ error: "Phòng đã đủ người" });

  if (!m.players.includes(userId)) m.players.push(userId);

  // user vào trận -> set in_match & dọn lời mời
  userStatus.set(userId, "in_match");
  delete invites[userId];
  removeInvitesBySender(userId);
  broadcastOnlineUsers();

  res.json({ ok: true });
});

/* ======== API Lịch sử (đọc từ DB) ======== */

// 10 trận gần nhất
app.get("/api/history", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, type, startedAt, endedAt, status, result FROM match_game ORDER BY id DESC LIMIT 10"
    );
    res.json(rows);
  } catch (err) {
    console.error("❌ Lỗi đọc lịch sử:", err);
    res.status(500).json({ error: "Lỗi đọc dữ liệu" });
  }
});

// Chi tiết một trận (board cuối)
app.get("/api/history/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [rows] = await pool.query("SELECT * FROM board_state WHERE matchId = ?", [id]);
    if (rows.length === 0) return res.status(404).json({ error: "Không có dữ liệu bàn cờ" });
    const boardData = JSON.parse(rows[0].boardData || "[]");
    res.json({ matchId: id, boardData });
  } catch (err) {
    console.error("❌ Lỗi đọc chi tiết:", err);
    res.status(500).json({ error: "Lỗi đọc dữ liệu chi tiết" });
  }
});

// Route file lịch sử
app.get("/history.html", (req, res) => res.sendFile(path.join(__dirname, "history.html")));

/* ===================== HELPER ===================== */

async function saveMatchResultToDB(matchId, winner, board = null) {
  const m = matches.get(matchId);
  if (!m || m._saved) return; // chống ghi trùng
  m._saved = true;

  try {
    const [res] = await pool.query(
      "INSERT INTO match_game (type, startedAt, endedAt, status, result) VALUES (?, ?, ?, ?, ?)",
      ["pvp", toMySQLDateTime(m.startedAt), toMySQLDateTime(m.endedAt), m.status, winner]
    );
    m.dbId = res.insertId;

    if (board) {
      await pool.query("INSERT INTO board_state (matchId, boardData) VALUES (?, ?)", [
        m.dbId,
        JSON.stringify(board),
      ]);
    }
    console.log("✅ Lưu DB thành công:", m.dbId);
  } catch (err) {
    console.error("❌ Lỗi lưu DB:", err);
  }
}

function broadcastMatchEnd(matchId, winner, reason = "normal") {
  io.to(String(matchId)).emit("match_end_broadcast", { matchId, winner, reason });
}

function resetForRematch(m) {
  m.status = "playing";
  m.startedAt = new Date().toISOString();
  m.endedAt = null;
  m.turn = "X";
  m._saved = false;
  m._votes.clear();
}

// Dọn lời mời do 1 user đã gửi (lọc across tất cả target)
function removeInvitesBySender(senderId) {
  for (const key of Object.keys(invites)) {
    invites[key] = (invites[key] || []).filter(inv => inv.fromId !== senderId);
    if (invites[key].length === 0) delete invites[key];
  }
}

// Xóa lời mời hết hạn / người gửi offline
function cleanupInvites(targetId) {
  if (!invites[targetId]) return;
  invites[targetId] = invites[targetId].filter(
    (inv) => onlineUsers.has(inv.fromId) && Date.now() - inv.sentAt < 60000 // 1 phút
  );
  if (invites[targetId].length === 0) delete invites[targetId];
}

function broadcastOnlineUsers() {
  const list = Array.from(onlineUsers.entries()).map(([id, u]) => ({
    id,
    username: u.username,
    status: userStatus.get(id) || "idle",
  }));
  io.emit("update_online_users", list);
}

/* ===================== SOCKET.IO (DUY NHẤT) ===================== */

io.on("connection", (socket) => {
  console.log("🔗", socket.id);

  /* ===== Online presence + Invites ===== */

  // user online
  socket.on("user_online", ({ userId, username }) => {
    onlineUsers.set(userId, { socketId: socket.id, username });
    userStatus.set(userId, userStatus.get(userId) || "idle"); // mặc định idle nếu chưa có
    socket.data.userId = userId;
    socket.data.username = username;
    broadcastOnlineUsers();
  });

  // gửi lời mời
  socket.on("send_invite", ({ fromId, toId }) => {
    const target = onlineUsers.get(toId);
    if (!target) return socket.emit("invite_error", "Người chơi không online!");

    // Nếu người nhận đang trong trận thì báo ngay
    if (userStatus.get(toId) === "in_match") {
      return socket.emit("invite_error", "Người này đang trong trận!");
    }
    // Nếu người gửi đang trong trận thì chặn
    if (userStatus.get(fromId) === "in_match") {
      return socket.emit("invite_error", "Bạn đang trong trận!");
    }

    if (!invites[toId]) invites[toId] = [];
    if (invites[toId].some((inv) => inv.fromId === fromId)) {
      return socket.emit("invite_error", "Bạn đã gửi lời mời cho người này rồi!");
    }

    const fromName = onlineUsers.get(fromId)?.username || "Ẩn danh";
    invites[toId].push({ fromId, fromName, sentAt: Date.now() });
    io.to(target.socketId).emit("new_invite", { fromId, fromName });
  });

  // người nhận yêu cầu danh sách lời mời
  socket.on("get_invites", (userId) => {
    cleanupInvites(userId);
    socket.emit("invite_list", invites[userId] || []);
  });

  // từ chối 1 lời mời
  socket.on("decline_invite", ({ userId, fromId }) => {
    if (invites[userId]) {
      invites[userId] = invites[userId].filter((inv) => inv.fromId !== fromId);
      if (invites[userId].length === 0) delete invites[userId];
      socket.emit("invite_list", invites[userId] || []);
    }
  });

  // từ chối tất cả
  socket.on("decline_all", (userId) => {
    delete invites[userId];
    socket.emit("invite_list", []);
  });

  // chấp nhận lời mời → tạo match
  socket.on("accept_invite", ({ userId, fromId }) => {
    // Kiểm tra hợp lệ
    if (!onlineUsers.has(fromId)) {
      // Người mời đã offline
      if (invites[userId]) {
        invites[userId] = invites[userId].filter((inv) => inv.fromId !== fromId);
      }
      socket.emit("invite_error", "Đối thủ đã offline! Lời mời bị hủy.");
      socket.emit("invite_list", invites[userId] || []);
      return;
    }
    if (userStatus.get(fromId) === "in_match") {
      // Người mời đã vào trận khác
      if (invites[userId]) {
        invites[userId] = invites[userId].filter((inv) => inv.fromId !== fromId);
      }
      socket.emit("invite_error", "Đối thủ đã trong trận! Lời mời bị hủy.");
      socket.emit("invite_list", invites[userId] || []);
      return;
    }
    if (userStatus.get(userId) === "in_match") {
      // Người nhận cũng đang trong trận
      socket.emit("invite_error", "Bạn đang trong trận!");
      return;
    }

    const fromSocketId = onlineUsers.get(fromId).socketId;

    // Tạo trận
    const matchId = nextMatchId++;
    const m = {
      id: matchId,
      type: "pvp",
      status: "waiting",
      players: [fromId, userId],
      sockets: { X: fromSocketId, O: socket.id },
      turn: "X",
      startedAt: new Date().toISOString(),
      endedAt: null,
      timer: null,
      _saved: false,
      _votes: new Set(),
    };
    matches.set(matchId, m);

    // Set trạng thái in_match cho cả 2 + dọn lời mời của cả 2
    userStatus.set(fromId, "in_match");
    userStatus.set(userId, "in_match");
    delete invites[userId];
    delete invites[fromId];
    removeInvitesBySender(fromId);
    removeInvitesBySender(userId);
    broadcastOnlineUsers();

    // Báo cho 2 bên để chuyển trang
    io.to(fromSocketId).emit("invite_accepted", { matchId });
    io.to(socket.id).emit("invite_accepted", { matchId });
  });

  /* ===== Match gameplay ===== */

  // Client join vào trận (từ game.html)
  socket.on("join_match", ({ matchId, userId }) => {
    const m = matches.get(matchId);
    if (!m) return socket.emit("error_msg", "Không tìm thấy trận");
    if (!m.players.includes(userId)) return socket.emit("error_msg", "Bạn không thuộc trận này");

    socket.join(String(matchId));

    const symbol = m.players[0] === userId ? "X" : "O";
    if (symbol === "X") m.sockets.X = socket.id;
    else m.sockets.O = socket.id;

    // Vào trận (đảm bảo trạng thái đúng & dọn lời mời)
    userStatus.set(userId, "in_match");
    delete invites[userId];
    removeInvitesBySender(userId);
    broadcastOnlineUsers();

    // Nếu đủ 2 người → bắt đầu
    if (m.players.length === 2 && m.status !== "playing") {
      m.status = "playing";
      m.startedAt = new Date().toISOString();
      m.turn = "X";
      startTurnTimer(matchId);
      io.to(String(matchId)).emit("status_msg", "Trận đã bắt đầu!");
    }

    socket.data.matchId = matchId;
    socket.data.userId = userId;
    socket.data.symbol = symbol;

    socket.emit("assign_symbol", { symbol, turn: m.turn });
    io.to(String(matchId)).emit("room_info", {
      players: m.players.map((id) => users.get(id)?.username || "unknown"),
      turn: m.turn,
      status: m.status,
    });
  });

  // Nước đi
  socket.on("player_move", ({ matchId, r, c, symbol }) => {
    const m = matches.get(matchId);
    if (!m || m.status !== "playing") return;

    const isOwner =
      (symbol === "X" && m.sockets.X === socket.id) ||
      (symbol === "O" && m.sockets.O === socket.id);
    if (!isOwner || symbol !== m.turn) return;

    // Đổi lượt
    m.turn = symbol === "X" ? "O" : "X";

    // Reset timer
    clearTimeout(m.timer);
    startTurnTimer(matchId);

    // Phát nước đi
    io.to(String(matchId)).emit("update_board", { r, c, symbol, nextTurn: m.turn });
  });

  // Client báo thắng (kết thúc bình thường)
  socket.on("match_end", async ({ matchId, winner, board }) => {
    const m = matches.get(matchId);
    if (!m) return;

    m.status = "ended";
    m.endedAt = new Date().toISOString();
    clearTimeout(m.timer);

    await saveMatchResultToDB(matchId, winner, board);
    broadcastMatchEnd(matchId, winner, "win");

    // Trở về idle
    if (m.players[0]) userStatus.set(m.players[0], "idle");
    if (m.players[1]) userStatus.set(m.players[1], "idle");
    broadcastOnlineUsers();
  });

  // Rematch
  socket.on("rematch_request", (matchId) => {
    const m = matches.get(matchId);
    if (!m) return;

    m._votes.add(socket.id);
    const need = Math.min(m.players.length, 2);
    if (m._votes.size >= need && m.sockets.X && m.sockets.O) {
      resetForRematch(m);
      startTurnTimer(matchId);
      io.to(String(matchId)).emit("rematch_start");
    } else {
      socket.emit("rematch_wait", "Đã gửi yêu cầu, chờ đối thủ…");
    }
  });

  // Ngắt kết nối
  socket.on("disconnect", async () => {
    const { matchId, userId } = socket.data || {};

    // rời online
    if (userId) {
      onlineUsers.delete(userId);
      userStatus.delete(userId);
      cleanupInvites(userId);
      broadcastOnlineUsers();
    }

    if (!matchId) return;
    const m = matches.get(matchId);
    if (!m) return;

    clearTimeout(m.timer);
    m.status = "ended";
    m.endedAt = new Date().toISOString();

    // Xác định winner theo lượt còn lại (người còn online)
    let winner = "X";
    if (m.sockets.X === socket.id) winner = "O";
    else if (m.sockets.O === socket.id) winner = "X";

    await saveMatchResultToDB(matchId, winner);
    broadcastMatchEnd(matchId, winner, "disconnect");

    // Trả 2 bên về idle (bên còn online cũng về idle)
    if (m.players[0]) userStatus.set(m.players[0], "idle");
    if (m.players[1]) userStatus.set(m.players[1], "idle");
    broadcastOnlineUsers();
  });

  // Timer 20s/lượt
  function startTurnTimer(matchId) {
    const m = matches.get(matchId);
    if (!m) return;

    let sec = 20;
    io.to(String(matchId)).emit("timer_start", { turn: m.turn, time: sec });
    clearTimeout(m.timer);

    const tick = async () => {
      sec--;
      if (!matches.get(matchId) || m.status !== "playing") return;

      if (sec <= 0) {
        const loser = m.turn;
        const winner = loser === "X" ? "O" : "X";

        m.status = "ended";
        m.endedAt = new Date().toISOString();
        clearTimeout(m.timer);

        await saveMatchResultToDB(matchId, winner);
        broadcastMatchEnd(matchId, winner, "timeout");

        // Trở về idle
        if (m.players[0]) userStatus.set(m.players[0], "idle");
        if (m.players[1]) userStatus.set(m.players[1], "idle");
        broadcastOnlineUsers();
        return;
      }

      io.to(String(matchId)).emit("timer_tick", { turn: m.turn, time: sec });
      m.timer = setTimeout(tick, 1000);
    };

    m.timer = setTimeout(tick, 1000);
  }
});

/* ===================== CHẠY SERVER ===================== */
server.listen(3000, () => console.log("✅ Server chạy tại: http://localhost:3000"));
