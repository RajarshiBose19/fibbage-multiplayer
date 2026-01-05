const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const questions = require("./questions");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

const POINTS_CORRECT = 1000;
const POINTS_FOOL = 500;
const TIME_LIMIT = 45;
const PENALTY_PER_SEC = 20;
const AVATAR_COLORS = [
  "#FF6B6B",
  "#4ECDC4",
  "#FFE66D",
  "#FF9F1C",
  "#C7F464",
  "#EF476F",
];

const rooms = {};

const generateRoomCode = () => {
  let result = "";
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (let i = 0; i < 4; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return rooms[result] ? generateRoomCode() : result;
};

const shuffle = (array) => array.sort(() => Math.random() - 0.5);
const getAvatarColor = (index) => AVATAR_COLORS[index % AVATAR_COLORS.length];

const calculatePenalty = (startTime) => {
  if (!startTime) return 0;
  const now = Date.now();
  const elapsedSeconds = (now - startTime) / 1000;
  const overtime = elapsedSeconds - TIME_LIMIT;

  if (overtime > 0) {
    return Math.ceil(overtime) * PENALTY_PER_SEC;
  }
  return 0;
};

io.on("connection", (socket) => {
  console.log(`User Connected: ${socket.id}`);

  socket.on("create_room", ({ playerName, settings }) => {
    const roomCode = generateRoomCode();

    rooms[roomCode] = {
      hostId: socket.id,
      players: [],
      settings: settings,
      gameQueue: [],
      currentQuestion: null,
      phase: "LOBBY",
      lies: {},
      votes: {},
      bets: {},
      penalties: {},
      shuffledOptions: [],
      phaseStartTime: 0,
    };

    const newPlayer = {
      id: socket.id,
      name: playerName,
      score: 0,
      color: getAvatarColor(0),
    };

    rooms[roomCode].players.push(newPlayer);
    socket.join(roomCode);

    socket.emit("joined_success", {
      roomCode,
      playerId: socket.id,
      isHost: true,
      settings: rooms[roomCode].settings,
    });

    io.to(roomCode).emit("update_players", rooms[roomCode].players);
  });

  socket.on("join_room", ({ roomCode, playerName }) => {
    const room = rooms[roomCode];
    if (!room) return socket.emit("error_message", "Room not found.");
    if (room.phase !== "LOBBY")
      return socket.emit("error_message", "Game started.");
    if (
      room.players.some(
        (p) => p.name.toLowerCase() === playerName.toLowerCase()
      )
    ) {
      return socket.emit("error_message", "Name taken.");
    }

    const newPlayer = {
      id: socket.id,
      name: playerName,
      score: 0,
      color: getAvatarColor(room.players.length),
    };

    room.players.push(newPlayer);
    socket.join(roomCode);

    socket.emit("joined_success", {
      roomCode,
      playerId: socket.id,
      isHost: false,
      settings: room.settings,
    });

    io.to(roomCode).emit("update_players", room.players);
  });

  socket.on("start_game", (roomCode) => {
    const room = rooms[roomCode];
    if (!room || room.hostId !== socket.id) return;

    let qList = [...questions];
    if (room.settings.shuffle) qList = shuffle(qList);
    room.gameQueue = qList.slice(0, room.settings.rounds);

    startRound(roomCode);
  });

  socket.on("submit_lie", ({ roomCode, lie }) => {
    const room = rooms[roomCode];
    if (!room || room.phase !== "WRITING") return;

    const penalty = calculatePenalty(room.phaseStartTime);
    if (penalty > 0) {
      room.penalties[socket.id] = (room.penalties[socket.id] || 0) + penalty;
    }

    room.lies[socket.id] = lie;

    if (Object.keys(room.lies).length === room.players.length) {
      startVotingPhase(roomCode);
    } else {
      io.to(roomCode).emit("update_progress", {
        current: Object.keys(room.lies).length,
        total: room.players.length,
      });
    }
  });

  socket.on("submit_vote", ({ roomCode, vote, bet }) => {
    const room = rooms[roomCode];
    if (!room || room.phase !== "VOTING") return;

    const penalty = calculatePenalty(room.phaseStartTime);
    if (penalty > 0) {
      room.penalties[socket.id] = (room.penalties[socket.id] || 0) + penalty;
    }

    room.votes[socket.id] = vote;
    if (room.settings.betting) room.bets[socket.id] = bet || 0;

    if (Object.keys(room.votes).length === room.players.length) {
      calculateScores(roomCode);
    } else {
      io.to(roomCode).emit("update_progress", {
        current: Object.keys(room.votes).length,
        total: room.players.length,
      });
    }
  });

  socket.on("next_round", (roomCode) => {
    const room = rooms[roomCode];
    if (!room || room.hostId !== socket.id) return;

    if (room.gameQueue.length > 0) {
      startRound(roomCode);
    } else {
      room.phase = "GAME_OVER";
      io.to(roomCode).emit("game_over", room.players);
    }
  });

  socket.on("trigger_next_reveal", (roomCode) => {
    io.to(roomCode).emit("next_reveal_card");
  });

  socket.on("disconnect", () => {
    console.log(`User Disconnected: ${socket.id}`);

    for (const roomCode in rooms) {
      const room = rooms[roomCode];
      const playerIndex = room.players.findIndex((p) => p.id === socket.id);

      if (playerIndex !== -1) {
        const player = room.players[playerIndex];

        if (room.hostId === socket.id) {
          console.log(`Host left room ${roomCode}. Destroying room.`);
          io.to(roomCode).emit(
            "error_message",
            "Host disconnected. Game ended."
          );
          io.to(roomCode).emit("game_over", []);
          delete rooms[roomCode];
          return;
        }

        console.log(`Player ${player.name} left room ${roomCode}`);

        room.players.splice(playerIndex, 1);

        delete room.lies[socket.id];
        delete room.votes[socket.id];
        delete room.bets[socket.id];

        io.to(roomCode).emit("update_players", room.players);

        if (room.players.length === 0) {
          delete rooms[roomCode];
          return;
        }

        checkPhaseProgression(roomCode);

        break;
      }
    }
  });
});

function checkPhaseProgression(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  if (room.phase === "WRITING") {
    const submittedCount = Object.keys(room.lies).length;
    const totalPlayers = room.players.length;

    io.to(roomCode).emit("update_progress", {
      current: submittedCount,
      total: totalPlayers,
    });

    if (submittedCount >= totalPlayers) {
      startVotingPhase(roomCode);
    }
  }

  if (room.phase === "VOTING") {
    const votedCount = Object.keys(room.votes).length;
    const totalPlayers = room.players.length;

    io.to(roomCode).emit("update_progress", {
      current: votedCount,
      total: totalPlayers,
    });

    if (votedCount >= totalPlayers) {
      calculateScores(roomCode);
    }
  }
}

function startRound(roomCode) {
  const room = rooms[roomCode];
  const question = room.gameQueue.pop();

  room.currentQuestion = question;
  room.lies = {};
  room.votes = {};
  room.bets = {};
  room.penalties = {};
  room.phase = "WRITING";
  room.phaseStartTime = Date.now();

  io.to(roomCode).emit("phase_change", {
    phase: "WRITING",
    question: question.text,
    timer: TIME_LIMIT,
  });
}

function startVotingPhase(roomCode) {
  const room = rooms[roomCode];
  room.phase = "VOTING";
  room.phaseStartTime = Date.now();

  const allOptions = [
    {
      text: room.currentQuestion.answer.toLowerCase(),
      type: "TRUTH",
      authorId: null,
    },
    ...room.players.map((p) => ({
      text: (room.lies[p.id] || "No Answer").toLowerCase(),
      type: "LIE",
      authorId: p.id,
    })),
  ];

  room.shuffledOptions = shuffle(allOptions);

  io.to(roomCode).emit("phase_change", {
    phase: "VOTING",
    question: room.currentQuestion.text,
    options: room.shuffledOptions,
    timer: TIME_LIMIT,
  });
}

function calculateScores(roomCode) {
  const room = rooms[roomCode];
  const truth = room.currentQuestion.answer.toLowerCase();

  const roundBreakdown = {};

  room.players.forEach((p) => {
    roundBreakdown[p.id] = {
      correct: 0,
      fooling: 0,
      bet: 0,
      penalty: 0,
      total: 0,
    };
  });

  room.players.forEach((player) => {
    const voteText = room.votes[player.id];
    const betAmount = room.bets[player.id] || 0;
    const penalty = room.penalties[player.id] || 0;
    const stats = roundBreakdown[player.id];

    if (penalty > 0) {
      player.score -= penalty;
      stats.penalty -= penalty;
      stats.total -= penalty;
    }

    if (voteText === truth) {
      player.score += POINTS_CORRECT;
      stats.correct += POINTS_CORRECT;

      if (betAmount > 0) {
        player.score += betAmount;
        stats.bet += betAmount;
      }
      stats.total += POINTS_CORRECT + betAmount;
    } else {
      if (betAmount > 0) {
        player.score -= betAmount;
        stats.bet -= betAmount;
        stats.total -= betAmount;
      }
    }

    room.players.forEach((otherPlayer) => {
      if (player.id !== otherPlayer.id) {
        const otherVote = room.votes[otherPlayer.id];
        const myLie = (room.lies[player.id] || "").toLowerCase();
        if (otherVote === myLie && myLie !== "") {
          player.score += POINTS_FOOL;
          stats.fooling += POINTS_FOOL;
          stats.total += POINTS_FOOL;
        }
      }
    });
  });

  const revealData = room.shuffledOptions.map((option) => {
    const voters = room.players
      .filter((p) => room.votes[p.id] === option.text)
      .map((p) => ({
        name: p.name,
        bet: room.bets[p.id] || 0,
        penalty: room.penalties[p.id] || 0,
      }));

    let authorName = null;
    if (option.type === "LIE") {
      const author = room.players.find((p) => p.id === option.authorId);
      authorName = author ? author.name : "Unknown";
    }

    return { text: option.text, type: option.type, authorName, voters };
  });

  revealData.sort((a, b) =>
    a.type === "TRUTH" ? 1 : b.type === "TRUTH" ? -1 : 0
  );

  room.phase = "REVEAL";
  io.to(roomCode).emit("round_results", {
    phase: "REVEAL",
    revealData,
    players: room.players,
    roundBreakdown,
    truth: room.currentQuestion.answer,
    questionText: room.currentQuestion.text,
  });
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`SERVER RUNNING ON ${PORT}`));
