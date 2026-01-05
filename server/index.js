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
      shuffledOptions: [],
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

  socket.on("disconnect", () => {});
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
      player.score += POINTS_CORRECT + betAmount;
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
      .map((p) => ({ name: p.name, bet: room.bets[p.id] || 0 }));

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
    truth: room.currentQuestion.answer,
  });
}

server.listen(3001, () => console.log("SERVER RUNNING ON 3001"));
