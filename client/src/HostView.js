import React, { useState, useEffect } from "react";
import socket from "./socket";

export default function HostView({ roomCode }) {
  const [players, setPlayers] = useState([]);
  const [phase, setPhase] = useState("LOBBY");
  const [question, setQuestion] = useState("");
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [revealData, setRevealData] = useState([]);
  const [timer, setTimer] = useState(0);

  useEffect(() => {
    socket.on("update_players", (list) => setPlayers(list));

    socket.on("phase_change", (data) => {
      setPhase(data.phase);
      if (data.question) setQuestion(data.question);
      if (data.timer) setTimer(data.timer);
      setProgress({ current: 0, total: players.length });
    });

    socket.on("update_progress", (data) => setProgress(data));

    socket.on("round_results", (data) => {
      setPhase("REVEAL");
      setRevealData(data.revealData);
      setPlayers(data.players);
    });

    socket.on("game_over", (finalPlayers) => {
      setPhase("GAME_OVER");
      setPlayers(finalPlayers);
    });

    return () => {
      socket.off("update_players");
      socket.off("phase_change");
      socket.off("update_progress");
      socket.off("round_results");
      socket.off("game_over");
    };
  }, [players.length]);

  useEffect(() => {
    if (timer > 0) {
      const interval = setInterval(() => setTimer((t) => t - 1), 1000);
      return () => clearInterval(interval);
    }
  }, [timer]);

  const startGame = () => socket.emit("start_game", roomCode);
  const nextRound = () => socket.emit("next_round", roomCode);

  if (phase === "LOBBY") {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h2>JOIN ON YOUR PHONE</h2>
          <h1 style={{ fontSize: "4rem", color: "#4ECDC4", margin: "10px 0" }}>
            {roomCode}
          </h1>

          <div style={styles.grid}>
            {players.map((p) => (
              <div
                key={p.id}
                style={{ ...styles.chip, backgroundColor: p.color }}
              >
                {p.name}
              </div>
            ))}
          </div>

          <div style={{ marginTop: "30px" }}>
            {players.length >= 2 ? (
              <button onClick={startGame} style={styles.btn}>
                START GAME
              </button>
            ) : (
              <p>Waiting for players...</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (phase === "WRITING" || phase === "VOTING") {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.timer}>{timer}s</div>
          <h2 style={{ fontSize: "2rem", marginBottom: "30px" }}>{question}</h2>

          <div style={styles.progressBar}>
            <div
              style={{
                ...styles.progressFill,
                width: `${
                  (progress.current / Math.max(progress.total, 1)) * 100
                }%`,
              }}
            ></div>
          </div>
          <p>
            {phase === "WRITING"
              ? "Waiting for Lies..."
              : "Waiting for Votes..."}
          </p>
          <p>
            {progress.current} / {progress.total} Answered
          </p>
        </div>
      </div>
    );
  }

  if (phase === "REVEAL") {
    return (
      <div style={styles.container}>
        <div style={{ ...styles.card, maxWidth: "800px" }}>
          <h2>RESULTS</h2>
          <div style={styles.revealList}>
            {revealData.map((item, idx) => (
              <div
                key={idx}
                style={item.type === "TRUTH" ? styles.truthBox : styles.lieBox}
              >
                <h3>"{item.text}"</h3>
                <div style={{ fontSize: "0.9rem" }}>
                  {item.type === "LIE" && (
                    <span>
                      Lie by: <strong>{item.authorName}</strong>
                    </span>
                  )}
                  {item.type === "TRUTH" && <span>★ THE TRUTH ★</span>}
                </div>
                <div style={{ marginTop: "5px" }}>
                  Votes: {item.voters.map((v) => v.name).join(", ") || "None"}
                </div>
              </div>
            ))}
          </div>
          <button onClick={nextRound} style={styles.btn}>
            NEXT ROUND
          </button>
        </div>
      </div>
    );
  }

  if (phase === "GAME_OVER") {
    const sorted = [...players].sort((a, b) => b.score - a.score);
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h1>GAME OVER</h1>
          <div style={{ fontSize: "4rem" }}>🏆 {sorted[0]?.name}</div>
          <ul style={{ listStyle: "none", padding: 0, marginTop: "20px" }}>
            {sorted.map((p, i) => (
              <li key={p.id} style={{ fontSize: "1.5rem", margin: "10px" }}>
                {i + 1}. {p.name} - {p.score} pts
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return <div>Loading...</div>;
}

const styles = {
  container: {
    minHeight: "100vh",
    backgroundColor: "#1A1A2E",
    color: "white",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    fontFamily: "sans-serif",
  },
  card: {
    backgroundColor: "#16213E",
    padding: "40px",
    borderRadius: "20px",
    textAlign: "center",
    width: "80%",
    maxWidth: "600px",
    position: "relative",
  },
  grid: {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
    justifyContent: "center",
  },
  chip: {
    padding: "10px 20px",
    borderRadius: "20px",
    color: "black",
    fontWeight: "bold",
  },
  btn: {
    padding: "15px 30px",
    fontSize: "1.2rem",
    backgroundColor: "#E94560",
    color: "white",
    border: "none",
    borderRadius: "10px",
    cursor: "pointer",
  },
  timer: {
    position: "absolute",
    top: 20,
    right: 20,
    fontSize: "1.5rem",
    color: "#4ECDC4",
    fontWeight: "bold",
  },
  progressBar: {
    width: "100%",
    height: "10px",
    backgroundColor: "#0F3460",
    borderRadius: "5px",
    margin: "20px 0",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#4ECDC4",
    transition: "width 0.3s",
  },
  revealList: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    margin: "20px 0",
    textAlign: "left",
  },
  lieBox: {
    backgroundColor: "#2D142C",
    padding: "15px",
    borderRadius: "10px",
    border: "1px solid #E94560",
    color: "#E94560",
  },
  truthBox: {
    backgroundColor: "#133B3A",
    padding: "15px",
    borderRadius: "10px",
    border: "1px solid #4ECDC4",
    color: "#4ECDC4",
  },
};
