const express = require("express");
const router = express.Router();

const matches = new Map();
const users = new Map();
let nextMatchId = 1;

router.get("/", (req, res) => {
  const list = Array.from(matches.values()).map((m) => ({
    id: m.id,
    status: m.status,
    players: m.players.map((id) => users.get(id)?.username || "unknown"),
  }));
  res.json(list);
});

router.post("/", (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "Thiếu userId" });
  const m = {
    id: nextMatchId++,
    status: "waiting",
    players: [userId],
  };
  matches.set(m.id, m);
  res.json({ matchId: m.id });
});

router.post("/:id/join", (req, res) => {
  const matchId = Number(req.params.id);
  const { userId } = req.body;
  const m = matches.get(matchId);
  if (!m) return res.status(404).json({ error: "Không tìm thấy trận" });
  if (m.players.length >= 2)
    return res.status(400).json({ error: "Phòng đã đủ người" });
  m.players.push(userId);
  res.json({ ok: true });
});

module.exports = router;
