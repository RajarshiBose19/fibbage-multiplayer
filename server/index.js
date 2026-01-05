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

// --- CONSTANTS ---
const POINTS_CORRECT = 1000;
const POINTS_FOOL = 500;
const TIME_LIMIT = 45; // Seconds
const PENALTY_PER_SEC = 10; // Points lost per second overtime
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

// --- HELPER: Calculate Penalty ---
const calculatePenalty = (startTime) => {
  if (!startTime) return 0;
  const now = Date.now();
  const elapsedSeconds = (now - startTime) / 1000;
  const overtime = elapsedSeconds - TIME_LIMIT;

  if (overtime > 0) {
    // Ceiling to ensure even 0.1s late gets a penalty
    return Math.ceil(overtime) * PENALTY_PER_SEC;
  }
  return 0;
};

io.on("connection", (socket) => {
  console.log(`User Connected: ${socket.id}`);

  // 1. CREATE ROOM
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
      penalties: {}, // NEW: Track penalties for this round
      shuffledOptions: [],
      phaseStartTime: 0, // NEW: Track when phase started
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

  // 2. JOIN ROOM
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

  // 3. START GAME
  socket.on("start_game", (roomCode) => {
    const room = rooms[roomCode];
    if (!room || room.hostId !== socket.id) return;

    let qList = [...questions];
    if (room.settings.shuffle) qList = shuffle(qList);
    room.gameQueue = qList.slice(0, room.settings.rounds);

    startRound(roomCode);
  });

  // 4. SUBMIT LIE
  socket.on("submit_lie", ({ roomCode, lie }) => {
    const room = rooms[roomCode];
    if (!room || room.phase !== "WRITING") return;

    // Calculate Penalty
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

  // 5. SUBMIT VOTE
  socket.on("submit_vote", ({ roomCode, vote, bet }) => {
    const room = rooms[roomCode];
    if (!room || room.phase !== "VOTING") return;

    // Calculate Penalty
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

  // 6. NEXT ROUND
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

  socket.on("disconnect", () => {
    // Cleanup logic
  });
});

// --- LOGIC HELPERS ---
function startRound(roomCode) {
  const room = rooms[roomCode];
  const question = room.gameQueue.pop();

  room.currentQuestion = question;
  room.lies = {};
  room.votes = {};
  room.bets = {};
  room.penalties = {}; // Reset penalties for new round
  room.phase = "WRITING";
  room.phaseStartTime = Date.now(); // Start Timer

  io.to(roomCode).emit("phase_change", {
    phase: "WRITING",
    question: question.text,
    timer: TIME_LIMIT,
  });
}

function startVotingPhase(roomCode) {
  const room = rooms[roomCode];
  room.phase = "VOTING";
  room.phaseStartTime = Date.now(); // Start Timer for Voting

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

  // 1. Reset/Init Round Breakdown
  // We store how many points each player gained THIS round for the UI
  const roundBreakdown = {}; // { playerId: { correct: 0, fooling: 0, bet: 0, penalty: 0, total: 0 } }

  room.players.forEach((p) => {
    roundBreakdown[p.id] = {
      correct: 0,
      fooling: 0,
      bet: 0,
      penalty: 0,
      total: 0,
    };
  });

  // 2. Calculate Points
  room.players.forEach((player) => {
    const voteText = room.votes[player.id];
    const betAmount = room.bets[player.id] || 0;
    const penalty = room.penalties[player.id] || 0;
    const stats = roundBreakdown[player.id];

    // A. Penalty
    if (penalty > 0) {
      player.score -= penalty;
      stats.penalty -= penalty;
      stats.total -= penalty;
    }

    // B. Correct Answer & Betting
    if (voteText === truth) {
      player.score += POINTS_CORRECT;
      stats.correct += POINTS_CORRECT;

      if (betAmount > 0) {
        player.score += betAmount;
        stats.bet += betAmount;
      }
      stats.total += POINTS_CORRECT + betAmount;
    } else {
      // Wrong Answer - Lose Bet
      if (betAmount > 0) {
        player.score -= betAmount;
        stats.bet -= betAmount;
        stats.total -= betAmount;
      }
    }

    // C. Fooling Others
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

  // 3. Prepare Reveal Data
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

  // Sort: Lies first, Truth last
  revealData.sort((a, b) =>
    a.type === "TRUTH" ? 1 : b.type === "TRUTH" ? -1 : 0
  );

  room.phase = "REVEAL";
  io.to(roomCode).emit("round_results", {
    phase: "REVEAL",
    revealData,
    players: room.players,
    roundBreakdown, // Send the specific point details
    truth: room.currentQuestion.answer,
    questionText: room.currentQuestion.text, // Send question text for context
  });
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`SERVER RUNNING ON ${PORT}`));
