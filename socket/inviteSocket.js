const { createMatchTemplate } = require("../utils/matchState");

module.exports = function (io, state) {
  const { matches, users, userStatus, generateMatchId } = state;

  // Lưu lời mời (targetId → [{ fromId, fromName, sentAt }])
  const invites = new Map();

  io.on("connection", (socket) => {
    /* ===================== ĐĂNG NHẬP ONLINE ===================== */
    socket.on("user_online", ({ userId, username }) => {
      users.set(userId, { socketId: socket.id, username });
      if (!userStatus.get(userId)) userStatus.set(userId, "idle");
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
      if (!target) {
        return socket.emit("invite_error", "Người chơi không online!");
      }

      if (userStatus.get(toId) === "in_match") {
        return socket.emit("invite_error", "Người này đang trong trận!");
      }

      const pending = invites.get(toId) || [];
      if (pending.some((inv) => inv.fromId === fromId)) {
        return socket.emit("invite_error", "Đã gửi lời mời cho người này rồi!");
      }

      const fromName = users.get(fromId)?.username || "Ẩn danh";
      pending.push({ fromId, fromName, sentAt: Date.now() });
      invites.set(toId, pending);

      io.to(target.socketId).emit("new_invite", { fromId, fromName });
    });

    /* ===================== LẤY DANH SÁCH LỜI MỜI ===================== */
    socket.on("get_invites", (userId) => {
      cleanupInvites(userId);
      socket.emit("invite_list", invites.get(userId) || []);
    });

    /* ===================== TỪ CHỐI LỜI MỜI ===================== */
    socket.on("decline_invite", ({ userId, fromId }) => {
      if (invites.has(userId)) {
        const filtered = (invites.get(userId) || []).filter(
          (inv) => inv.fromId !== fromId
        );
        if (filtered.length === 0) invites.delete(userId);
        else invites.set(userId, filtered);
        socket.emit("invite_list", filtered);
      }
    });

    /* ===================== TỪ CHỐI TẤT CẢ ===================== */
    socket.on("decline_all", (userId) => {
      invites.delete(userId);
      socket.emit("invite_list", []);
    });

    /* ===================== CHẤP NHẬN LỜI MỜI ===================== */
    socket.on("accept_invite", ({ userId, fromId }) => {
      if (!users.has(fromId)) {
        return socket.emit("invite_error", "Người mời đã offline!");
      }

      if (userStatus.get(fromId) === "in_match") {
        return socket.emit("invite_error", "Người mời đang trong trận!");
      }

      if (userStatus.get(userId) === "in_match") {
        return socket.emit("invite_error", "Bạn đang trong trận!");
      }

      const fromSocket = users.get(fromId).socketId;
      const matchId = generateMatchId();
      const match = createMatchTemplate({
        id: matchId,
        players: [
          { id: fromId, symbol: "X" },
          { id: userId, symbol: "O" },
        ],
        status: "in_progress",
      });

      matches.set(matchId, match);
      userStatus.set(fromId, "in_match");
      userStatus.set(userId, "in_match");

      io.to(fromSocket).emit("invite_accepted", { matchId });
      io.to(socket.id).emit("invite_accepted", { matchId });

      invites.delete(userId);
      cleanupInvites(fromId);
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
      if (!invites.has(targetId)) return;
      const fresh = (invites.get(targetId) || []).filter(
        (inv) =>
          users.has(inv.fromId) && Date.now() - inv.sentAt < 60000 // 1 phút
      );
      if (fresh.length === 0) invites.delete(targetId);
      else invites.set(targetId, fresh);
    }
  });
};
