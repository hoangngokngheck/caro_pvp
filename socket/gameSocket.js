module.exports = function (io, matches, users, userStatus) {
  io.on("connection", (socket) => {
    socket.on("join_match", ({ matchId, userId }) => {
      const m = matches.get(matchId);
      if (!m) return;
      socket.join(String(matchId));
      const symbol = m.players[0] === userId ? "X" : "O";
      socket.emit("assign_symbol", { symbol });
    });

    socket.on("player_move", ({ matchId, r, c, symbol }) => {
      io.to(String(matchId)).emit("update_board", { r, c, symbol });
    });
  });
};
