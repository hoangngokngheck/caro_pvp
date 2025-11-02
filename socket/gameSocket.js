const {
  getPlayerSymbol,
  toRoomInfo,
} = require("../utils/matchState");

module.exports = function (io, state) {
  const { matches, users, userStatus } = state;

  io.on("connection", (socket) => {
    socket.on("join_match", ({ matchId, userId }) => {
      const match = matches.get(matchId);
      if (!match) {
        return socket.emit("join_error", "Không tìm thấy trận đấu");
      }

      socket.join(String(matchId));
      socket.data.matchId = matchId;
      socket.data.userId = userId;

      const symbol = getPlayerSymbol(match, userId);
      socket.emit("assign_symbol", { symbol });

      if (symbol) userStatus.set(userId, "in_match");

      const roomInfo = toRoomInfo(match, users);
      socket.emit("room_info", roomInfo);
      socket.to(String(matchId)).emit("room_info", roomInfo);
    });

    socket.on("player_move", ({ matchId, r, c, symbol }) => {
      const match = matches.get(matchId);
      if (!match) return;

      if (!Number.isInteger(r) || !Number.isInteger(c)) return;
      if (!match.board?.[r] || match.board[r][c]) return;

      const playerId = socket.data.userId;
      const playerSymbol = playerId ? getPlayerSymbol(match, playerId) : null;
      if (!playerSymbol || playerSymbol !== symbol) return;
      if (match.turn && match.turn !== symbol) return;

      match.board[r][c] = symbol;
      match.lastMove = { r, c, symbol, userId: playerId };
      match.turn = symbol === "X" ? "O" : "X";

      io.to(String(matchId)).emit("update_board", { r, c, symbol });
      io.to(String(matchId)).emit("room_info", toRoomInfo(match, users));
    });

    socket.on("leave_match", () => {
      const { matchId, userId } = socket.data;
      if (!matchId) return;
      socket.leave(String(matchId));
      if (userId && userStatus.get(userId) === "in_match") {
        userStatus.set(userId, "idle");
      }
    });

    socket.on("disconnect", () => {
      const { matchId, userId } = socket.data;
      if (matchId) {
        socket.leave(String(matchId));
      }
      if (userId && userStatus.get(userId) === "in_match") {
        userStatus.set(userId, "idle");
      }
    });
  });
};
