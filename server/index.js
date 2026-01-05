const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const questions = require("./questions");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const POINTS_CORRECT = 1000;
const POINTS_FOOL = 500;
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

const shuffle = (array) => {
  const newArr = [...array];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
};

const getAvatarColor = (index) => AVATAR_COLORS[index % AVATAR_COLORS.length];

io.on("connection", (socket) => {
  console.log(`User Connected: ${socket.id}`);

  socket.on("create_room", (settings) => {
    const roomCode = generateRoomCode();

    rooms[roomCode] = {
      hostId: socket.id,
      players: [],
      settings: settings || { rounds: 5, betting: false, shuffle: true },
      gameQueue: [],
      currentQuestion: null,
      phase: "LOBBY",
      lies: {},
      votes: {},
      bets: {},
      shuffledOptions: [],
    };

    socket.join(roomCode);
    socket.emit("room_created", roomCode);
    console.log(`Room ${roomCode} created by ${socket.id}`);
  });

  socket.on("join_room", ({ roomCode, playerName }) => {
    const room = rooms[roomCode];

    if (!room) {
      socket.emit("error_message", "Room not found.");
      return;
    }
    if (room.phase !== "LOBBY") {
      socket.emit("error_message", "Game already in progress.");
      return;
    }
    if (
      room.players.some(
        (p) => p.name.toLowerCase() === playerName.toLowerCase()
      )
    ) {
      socket.emit("error_message", "Name already taken.");
      return;
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
      color: newPlayer.color,
      settings: room.settings,
    });

    io.to(roomCode).emit("update_players", room.players);
  });

  socket.on("start_game", (roomCode) => {
    const room = rooms[roomCode];
    if (!room) return;

    let qList = [...questions];
    if (room.settings.shuffle) {
      qList = shuffle(qList);
    }
    room.gameQueue = qList.slice(0, room.settings.rounds);

    startRound(roomCode);
  });

  socket.on("submit_lie", ({ roomCode, lie }) => {
    const room = rooms[roomCode];
    if (!room || room.phase !== "WRITING") return;

    room.lies[socket.id] = lie;

    io.to(roomCode).emit("update_progress", {
      current: Object.keys(room.lies).length,
      total: room.players.length,
    });

    if (Object.keys(room.lies).length === room.players.length) {
      startVotingPhase(roomCode);
    }
  });

  socket.on("submit_vote", ({ roomCode, vote, bet }) => {
    const room = rooms[roomCode];
    if (!room || room.phase !== "VOTING") return;

    room.votes[socket.id] = vote;
    if (room.settings.betting) {
      room.bets[socket.id] = bet || 0;
    }

    io.to(roomCode).emit("update_progress", {
      current: Object.keys(room.votes).length,
      total: room.players.length,
    });

    if (Object.keys(room.votes).length === room.players.length) {
      calculateScores(roomCode);
    }
  });

  socket.on("next_round", (roomCode) => {
    const room = rooms[roomCode];
    if (!room) return;

    if (room.gameQueue.length > 0) {
      startRound(roomCode);
    } else {
      room.phase = "GAME_OVER";
      io.to(roomCode).emit("game_over", room.players);
    }
  });

  socket.on("disconnect", () => {
    for (const code in rooms) {
      const room = rooms[code];
      const playerIndex = room.players.findIndex((p) => p.id === socket.id);

      if (playerIndex !== -1) {
        room.players.splice(playerIndex, 1);
        io.to(code).emit("update_players", room.players);

        if (room.players.length === 0 && room.hostId !== socket.id) {
          // Keep room if host is still there, otherwise maybe delete?
          // For simplicity, we leave it for now.
        }
        break;
      }

      if (room.hostId === socket.id) {
        io.to(code).emit("host_disconnected");
        delete rooms[code];
        break;
      }
    }
  });
});

function startRound(roomCode) {
  const room = rooms[roomCode];
  const question = room.gameQueue.pop();

  room.currentQuestion = question;
  room.lies = {};
  room.votes = {};
  room.bets = {};
  room.phase = "WRITING";

  io.to(roomCode).emit("phase_change", {
    phase: "WRITING",
    question: question.text,
    timer: 45,
  });
}

function startVotingPhase(roomCode) {
  const room = rooms[roomCode];
  room.phase = "VOTING";

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
    timer: 45,
  });
}

function calculateScores(roomCode) {
  const room = rooms[roomCode];
  const truth = room.currentQuestion.answer.toLowerCase();

  room.players.forEach((player) => {
    const voteText = room.votes[player.id];
    const betAmount = room.bets[player.id] || 0;

    if (voteText === truth) {
      player.score += POINTS_CORRECT;
      player.score += betAmount;
    } else {
      player.score -= betAmount;
    }

    room.players.forEach((otherPlayer) => {
      if (player.id !== otherPlayer.id) {
        const otherVote = room.votes[otherPlayer.id];
        const myLie = (room.lies[player.id] || "").toLowerCase();
        if (otherVote === myLie && myLie !== "") {
          player.score += POINTS_FOOL;
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
      }));

    let authorName = null;
    if (option.type === "LIE") {
      const author = room.players.find((p) => p.id === option.authorId);
      authorName = author ? author.name : "Unknown";
    }

    return {
      text: option.text,
      type: option.type,
      authorName: authorName,
      voters: voters,
    };
  });

  revealData.sort((a, b) => {
    if (a.type === "TRUTH") return 1;
    if (b.type === "TRUTH") return -1;
    return 0;
  });

  room.phase = "REVEAL";

  io.to(roomCode).emit("round_results", {
    phase: "REVEAL",
    revealData: revealData,
    players: room.players,
    truth: room.currentQuestion.answer,
  });
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`SERVER RUNNING ON PORT ${PORT}`);
});
