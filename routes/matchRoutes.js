const express = require("express");
const { createMatchTemplate } = require("../utils/matchState");

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
    if (!userId) return res.status(400).json({ error: "Thiếu userId" });

    const id = state.generateMatchId();
    const match = createMatchTemplate({
      id,
      players: [{ id: userId, symbol: "X" }],
      status: "waiting",
    });

    state.matches.set(id, match);
    state.userStatus.set(userId, "in_match");

    res.json({ matchId: id });
  });

  router.post("/:id/join", (req, res) => {
    const matchId = Number(req.params.id);
    const { userId } = req.body;
    const match = state.matches.get(matchId);

    if (!match) return res.status(404).json({ error: "Không tìm thấy trận" });
    if (match.players.some((p) => p.id === userId))
      return res.status(400).json({ error: "Bạn đã ở trong phòng" });
    if (match.players.length >= 2)
      return res.status(400).json({ error: "Phòng đã đủ người" });

    match.players.push({ id: userId, symbol: "O" });
    match.status = "in_progress";
    state.userStatus.set(userId, "in_match");

    res.json({ ok: true });
  });

  return router;
};
