const express = require("express");
const { createAndStoreMatch } = require("../utils/matchState");

module.exports = function createMatchRoutes(state) {
  const router = express.Router();

  router.get("/", (req, res) => {
    const list = Array.from(state.matches.values()).map((match) => ({
      id: match.id,
      status: match.status,
      players: match.players.map((p) =>
        state.users.get(p.id)?.username || `User#${p.id}`
      ),
    }));
    res.json(list);
  });

  router.post("/", (req, res) => {
    const { userId } = req.body;
    const hostId = Number(userId);

    if (!Number.isInteger(hostId)) {
      return res.status(400).json({ error: "Thiếu userId" });
    }

    if (state.userStatus.get(hostId) === "in_match") {
      return res.status(400).json({ error: "Bạn đang trong trận khác" });
    }

    const match = createAndStoreMatch(state, {
      players: [{ id: hostId, symbol: "X" }],
      status: "waiting",
    });

    res.json({ matchId: match.id });
  });

  router.post("/:id/join", (req, res) => {
    const matchId = Number(req.params.id);
    const { userId } = req.body;
    const playerId = Number(userId);

    if (!Number.isInteger(matchId)) {
      return res.status(400).json({ error: "Mã trận không hợp lệ" });
    }

    if (!Number.isInteger(playerId)) {
      return res.status(400).json({ error: "Thiếu userId" });
    }

    const match = state.matches.get(matchId);

    if (!match) return res.status(404).json({ error: "Không tìm thấy trận" });
    if (match.players.some((p) => p.id === playerId))
      return res.status(400).json({ error: "Bạn đã ở trong phòng" });
    if (match.players.length >= 2)
      return res.status(400).json({ error: "Phòng đã đủ người" });

    if (state.userStatus.get(playerId) === "in_match") {
      return res.status(400).json({ error: "Bạn đang trong trận khác" });
    }

    match.players.push({ id: playerId, symbol: "O" });
    match.status = "in_progress";
    state.userStatus.set(playerId, "in_match");

    res.json({ ok: true });
  });

  return router;
};
