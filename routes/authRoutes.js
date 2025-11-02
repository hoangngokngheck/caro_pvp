const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db");
const router = express.Router();

// Đăng ký
router.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: "Thiếu thông tin" });

    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      "INSERT INTO user (username, password, createdAt) VALUES (?, ?, NOW())",
      [username, hash]
    );
    res.json({ ok: true, msg: "Đăng ký thành công" });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY")
      res.status(400).json({ error: "Tên đăng nhập đã tồn tại" });
    else res.status(500).json({ error: "Lỗi server" });
  }
});

// Đăng nhập
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: "Thiếu thông tin" });

    const [rows] = await pool.query("SELECT * FROM user WHERE username = ?", [
      username,
    ]);
    if (rows.length === 0)
      return res.status(400).json({ error: "Sai tài khoản hoặc mật khẩu" });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(400).json({ error: "Sai tài khoản hoặc mật khẩu" });

    res.json({ id: user.id, username: user.username });
  } catch (err) {
    res.status(500).json({ error: "Lỗi server" });
  }
});

module.exports = router;
