// ================== CÁC IMPORT CHÍNH ==================
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");

// ================== ROUTES ==================
const authRoutes = require("./routes/authRoutes");
const createMatchRoutes = require("./routes/matchRoutes");
const historyRoutes = require("./routes/historyRoutes");

// ================== KHỞI TẠO APP ==================
const app = express();
app.use(cors());
app.use(express.json());

// ⚠️ Serve file tĩnh từ thư mục public/
app.use(express.static(path.join(__dirname, "public")));

// ================== BỘ NHỚ TẠM ==================
let nextMatchId = 1;
const sharedState = {
  matches: new Map(), // matchId -> thông tin trận
  users: new Map(), // userId  -> { username, socketId }
  userStatus: new Map(), // userId  -> "idle" | "in_match"
  generateMatchId() {
    return nextMatchId++;
  },
};

// ================== ROUTE HANDLERS ==================
app.use("/api", authRoutes);
app.use("/api/matches", createMatchRoutes(sharedState));
app.use("/api/history", historyRoutes);

// ================== HTTP + SOCKET SERVER ==================
const server = http.createServer(app);

// ⚙️ Socket.io cấu hình cross-origin (rất quan trọng khi test nhiều trình duyệt)
const io = new Server(server, {
  cors: {
    origin: "*", // hoặc cụ thể hơn: ["http://localhost:3000"]
    methods: ["GET", "POST"],
  },
});

// ================== MODULE SOCKET ==================
// ⚠️ Phải import SAU khi tạo io, và truyền cùng 1 instance io để đồng bộ
require("./socket/inviteSocket")(io, sharedState);
require("./socket/gameSocket")(io, sharedState);

// ================== CHẠY SERVER ==================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server chạy tại: http://localhost:${PORT}`);
});
