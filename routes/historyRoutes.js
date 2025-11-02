const express = require("express");
const pool = require("../db");
const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, type, startedAt, endedAt, status, result FROM match_game ORDER BY id DESC LIMIT 10"
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Lỗi đọc dữ liệu" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [rows] = await pool.query(
      "SELECT * FROM board_state WHERE matchId = ?",
      [id]
    );
    if (rows.length === 0)
      return res.status(404).json({ error: "Không có dữ liệu bàn cờ" });
    res.json({ matchId: id, boardData: JSON.parse(rows[0].boardData) });
  } catch {
    res.status(500).json({ error: "Lỗi đọc chi tiết" });
  }
});

module.exports = router;
