const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "552004",
  database: "caro_pvp",
});

module.exports = pool;