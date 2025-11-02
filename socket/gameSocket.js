const {
  getPlayerSymbol,
  toRoomInfo,
} = require("../utils/matchState");

module.exports = function (io, state) {
  const { matches, users, userStatus } = state;

  io.on("connection", (socket) => {
    socket.on("join_match", ({ matchId, userId }) => {
      const numericMatchId = Number(matchId);
      const playerId = Number(userId);

      if (!Number.isInteger(numericMatchId) || !Number.isInteger(playerId)) {
        return socket.emit("join_error", "Thông tin trận không hợp lệ");
      }

      const match = matches.get(numericMatchId);
      if (!match) {
        return socket.emit("join_error", "Không tìm thấy trận đấu");
      }

      const symbol = getPlayerSymbol(match, playerId);
      if (!symbol) {
        return socket.emit("join_error", "Bạn không ở trong trận này");
      }

      socket.join(String(numericMatchId));
      socket.data.matchId = numericMatchId;
      socket.data.userId = playerId;

      socket.emit("assign_symbol", { symbol });

      userStatus.set(playerId, "in_match");

      const roomInfo = toRoomInfo(match, users);
      socket.emit("room_info", roomInfo);
      socket.to(String(numericMatchId)).emit("room_info", roomInfo);
    });

    socket.on("player_move", ({ matchId, r, c, symbol }) => {
      const numericMatchId = Number(matchId);
      const match = matches.get(numericMatchId);
      if (!match) return;

      if (!Number.isInteger(r) || !Number.isInteger(c)) return;
      if (!match.board?.[r] || match.board[r][c]) return;

      const playerId = socket.data.userId;
      const playerSymbol =
        Number.isInteger(playerId) && match ? getPlayerSymbol(match, playerId) : null;
      if (!playerSymbol || playerSymbol !== symbol) return;
      if (match.turn && match.turn !== symbol) return;

      match.board[r][c] = symbol;
      match.lastMove = { r, c, symbol, userId: playerId };
      match.turn = symbol === "X" ? "O" : "X";

      io.to(String(numericMatchId)).emit("update_board", { r, c, symbol });
      io.to(String(numericMatchId)).emit("room_info", toRoomInfo(match, users));
    });

    socket.on("leave_match", () => {
      const { matchId, userId } = socket.data;
      if (!Number.isInteger(matchId)) return;
      socket.leave(String(matchId));
      if (userId && userStatus.get(userId) === "in_match") {
        userStatus.set(userId, "idle");
      }
    });

    socket.on("disconnect", () => {
      const { matchId, userId } = socket.data;
      if (Number.isInteger(matchId)) {
        socket.leave(String(matchId));
      }
      if (userId && userStatus.get(userId) === "in_match") {
        userStatus.set(userId, "idle");
      }
    });
  });
};
