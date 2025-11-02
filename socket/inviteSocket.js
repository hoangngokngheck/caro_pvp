const { createAndStoreMatch } = require("../utils/matchState");

module.exports = function (io, state) {
  const { users, userStatus } = state;

  // Lưu lời mời (targetId → [{ fromId, fromName, sentAt }])
  const invites = new Map();

  function normalizeUserId(value) {
    const id = Number(value);
    return Number.isInteger(id) ? id : null;
  }

  function getActiveInvites(userId) {
    cleanupInvites(userId);
    return invites.get(userId) || [];
  }

  function emitInviteList(userId, targetSocket) {
    const list = getActiveInvites(userId);
    if (targetSocket) {
      targetSocket.emit("invite_list", list);
    } else {
      const socketId = users.get(userId)?.socketId;
      if (socketId) {
        io.to(socketId).emit("invite_list", list);
      }
    }
  }

  function removeInvite(targetId, fromId) {
    const pending = invites.get(targetId);
    if (!pending) return false;

    const filtered = pending.filter((inv) => inv.fromId !== fromId);
    if (filtered.length === 0) {
      invites.delete(targetId);
    } else if (filtered.length !== pending.length) {
      invites.set(targetId, filtered);
    }
    return filtered.length !== pending.length;
  }

  io.on("connection", (socket) => {
    /* ===================== ĐĂNG NHẬP ONLINE ===================== */
    socket.on("user_online", ({ userId, username }) => {
      const normalizedId = normalizeUserId(userId);
      if (normalizedId === null) return;

      users.set(normalizedId, { socketId: socket.id, username });
      if (!userStatus.get(normalizedId)) userStatus.set(normalizedId, "idle");
      socket.data.userId = normalizedId;
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
      const senderId = normalizeUserId(fromId);
      const targetId = normalizeUserId(toId);

      if (senderId === null || targetId === null) {
        return socket.emit("invite_error", "Lời mời không hợp lệ!");
      }

      if (senderId === targetId) {
        return socket.emit("invite_error", "Không thể tự mời chính mình!");
      }

      const target = users.get(targetId);
      if (!target) {
        return socket.emit("invite_error", "Người chơi không online!");
      }

      if (userStatus.get(senderId) === "in_match") {
        return socket.emit("invite_error", "Bạn đang trong trận!");
      }

      if (userStatus.get(targetId) === "in_match") {
        return socket.emit("invite_error", "Người này đang trong trận!");
      }

      const pending = invites.get(targetId) || [];
      if (pending.some((inv) => inv.fromId === senderId)) {
        return socket.emit("invite_error", "Đã gửi lời mời cho người này rồi!");
      }

      const fromName = users.get(senderId)?.username || "Ẩn danh";
      pending.push({ fromId: senderId, fromName, sentAt: Date.now() });
      invites.set(targetId, pending);

      io.to(target.socketId).emit("new_invite", { fromId: senderId, fromName });
    });

    /* ===================== LẤY DANH SÁCH LỜI MỜI ===================== */
    socket.on("get_invites", (userId) => {
      const normalizedId = normalizeUserId(userId);
      if (normalizedId === null) return;
      emitInviteList(normalizedId, socket);
    });

    /* ===================== TỪ CHỐI LỜI MỜI ===================== */
    socket.on("decline_invite", ({ userId, fromId }) => {
      const targetId = normalizeUserId(userId);
      const senderId = normalizeUserId(fromId);
      if (targetId === null || senderId === null) return;

      const changed = removeInvite(targetId, senderId);
      if (changed) emitInviteList(targetId, socket);
    });

    /* ===================== TỪ CHỐI TẤT CẢ ===================== */
    socket.on("decline_all", (userId) => {
      const targetId = normalizeUserId(userId);
      if (targetId === null) return;
      invites.delete(targetId);
      socket.emit("invite_list", []);
    });

    /* ===================== CHẤP NHẬN LỜI MỜI ===================== */
    socket.on("accept_invite", ({ userId, fromId }) => {
      const targetId = normalizeUserId(userId);
      const senderId = normalizeUserId(fromId);
      if (targetId === null || senderId === null) {
        return socket.emit("invite_error", "Lời mời không hợp lệ!");
      }

      cleanupInvites(targetId);

      if (!users.has(senderId)) {
        removeInvite(targetId, senderId);
        emitInviteList(targetId, socket);
        return socket.emit("invite_error", "Người mời đã offline!");
      }

      if (userStatus.get(senderId) === "in_match") {
        removeInvite(targetId, senderId);
        emitInviteList(targetId, socket);
        return socket.emit("invite_error", "Người mời đang trong trận!");
      }

      if (userStatus.get(targetId) === "in_match") {
        removeInvite(targetId, senderId);
        emitInviteList(targetId, socket);
        return socket.emit("invite_error", "Bạn đang trong trận!");
      }

      const removed = removeInvite(targetId, senderId);
      if (!removed) {
        emitInviteList(targetId, socket);
        return socket.emit("invite_error", "Lời mời đã hết hạn!");
      }

      const fromSocket = users.get(senderId).socketId;
      const match = createAndStoreMatch(state, {
        players: [
          { id: senderId, symbol: "X" },
          { id: targetId, symbol: "O" },
        ],
        status: "in_progress",
      });

      const payload = { matchId: match.id };
      io.to(fromSocket).emit("invite_accepted", payload);
      io.to(socket.id).emit("invite_accepted", payload);

      emitInviteList(targetId, socket);
      cleanupInvites(senderId);
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
