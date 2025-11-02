const BOARD_SIZE = 20;

function createEmptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(""));
}

function createMatchTemplate({ id, players, status = "waiting" }) {
  return {
    id,
    type: "pvp",
    status,
    players,
    board: createEmptyBoard(),
    turn: "X",
    createdAt: new Date().toISOString(),
    lastMove: null,
  };
}

function getPlayerSymbol(match, userId) {
  const player = match.players.find((p) => p.id === userId);
  return player ? player.symbol : null;
}

function toRoomInfo(match, users) {
  return {
    id: match.id,
    status: match.status,
    turn: match.turn,
    lastMove: match.lastMove,
    players: match.players.map((p) => ({
      id: p.id,
      username: users.get(p.id)?.username || `User#${p.id}`,
      symbol: p.symbol,
    })),
    board: match.board,
  };
}

function createAndStoreMatch(state, { players, status = "waiting" }) {
  if (!state || typeof state.generateMatchId !== "function") {
    throw new Error("Missing shared state helpers for match creation");
  }

  const id = state.generateMatchId();
  const match = createMatchTemplate({ id, players, status });
  state.matches.set(id, match);

  if (Array.isArray(players)) {
    players.forEach((player) => {
      if (player && typeof player.id !== "undefined") {
        state.userStatus.set(player.id, "in_match");
      }
    });
  }

  return match;
}

module.exports = {
  BOARD_SIZE,
  createEmptyBoard,
  createMatchTemplate,
  createAndStoreMatch,
  getPlayerSymbol,
  toRoomInfo,
};
