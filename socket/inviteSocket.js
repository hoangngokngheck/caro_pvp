// socket/inviteSocket.js
module.exports = function (io, matches, users, userStatus) {
  // Danh sách người online được chia sẻ qua tham số `users`
  users.clear();

  // Lưu lời mời (targetId → [{ fromId, fromName, sentAt }])
  const invites = {};

  io.on("connection", (socket) => {
    console.log("🔗 Kết nối mới:", socket.id);

    /* ===================== ĐĂNG NHẬP ONLINE ===================== */
    socket.on("user_online", ({ userId, username }) => {
      users.set(userId, { socketId: socket.id, username });
      userStatus.set(userId, "idle");
      socket.data.userId = userId;
      socket.data.username = username;
      broadcastOnlineUsers();
    });

    /* ===================== NGẮT KẾT NỐI ===================== */
    socket.on("disconnect", () => {
      const uid = socket.data.userId;
      if (uid) {
        users.delete(uid);
        cleanupInvites(uid);
        userStatus.delete(uid);
        broadcastOnlineUsers();
      }
    });

    /* ===================== GỬI LỜI MỜI ===================== */
    socket.on("send_invite", ({ fromId, toId }) => {
      const target = users.get(toId);
      if (!target)
        return socket.emit("invite_error", "Người chơi không online!");

      if (userStatus.get(toId) === "in_match")
        return socket.emit("invite_error", "Người này đang trong trận!");

      if (!invites[toId]) invites[toId] = [];
      if (invites[toId].some((inv) => inv.fromId === fromId))
        return socket.emit("invite_error", "Đã gửi lời mời cho người này rồi!");

      const fromName = users.get(fromId)?.username || "Ẩn danh";
      invites[toId].push({ fromId, fromName, sentAt: Date.now() });

      io.to(target.socketId).emit("new_invite", { fromId, fromName });
    });

    /* ===================== LẤY DANH SÁCH LỜI MỜI ===================== */
    socket.on("get_invites", (userId) => {
      cleanupInvites(userId);
      socket.emit("invite_list", invites[userId] || []);
    });

    /* ===================== TỪ CHỐI LỜI MỜI ===================== */
    socket.on("decline_invite", ({ userId, fromId }) => {
      if (invites[userId]) {
        invites[userId] = invites[userId].filter(
          (inv) => inv.fromId !== fromId
        );
        socket.emit("invite_list", invites[userId]);
      }
    });

    /* ===================== TỪ CHỐI TẤT CẢ ===================== */
    socket.on("decline_all", (userId) => {
      invites[userId] = [];
      socket.emit("invite_list", []);
    });

    /* ===================== CHẤP NHẬN LỜI MỜI ===================== */
    socket.on("accept_invite", ({ userId, fromId }) => {
      if (!users.has(fromId))
        return socket.emit("invite_error", "Người mời đã offline!");

      if (userStatus.get(fromId) === "in_match")
        return socket.emit("invite_error", "Người mời đang trong trận!");

      if (userStatus.get(userId) === "in_match")
        return socket.emit("invite_error", "Bạn đang trong trận!");

      const fromSocket = users.get(fromId).socketId;
      const matchId = Date.now(); // dùng timestamp làm id nhanh
      const m = {
        id: matchId,
        type: "pvp",
        status: "waiting",
        players: [fromId, userId],
        sockets: { X: fromSocket, O: socket.id },
        turn: "X",
        startedAt: new Date().toISOString(),
        _saved: false,
      };

      matches.set(matchId, m);
      userStatus.set(fromId, "in_match");
      userStatus.set(userId, "in_match");

      io.to(fromSocket).emit("invite_accepted", { matchId });
      io.to(socket.id).emit("invite_accepted", { matchId });

      delete invites[userId];
      broadcastOnlineUsers(); // cập nhật trạng thái toàn hệ thống
    });

    /* ===================== HÀM HỖ TRỢ ===================== */
    function broadcastOnlineUsers() {
      const list = Array.from(users.entries()).map(([id, u]) => ({
        id,
        username: u.username,
        status: userStatus.get(id) || "offline",
      }));
      io.emit("update_online_users", list);
    }

    function cleanupInvites(targetId) {
      if (!invites[targetId]) return;
      invites[targetId] = invites[targetId].filter(
        (inv) =>
          users.has(inv.fromId) && Date.now() - inv.sentAt < 60000 // 1 phút
      );
    }
  });
};
