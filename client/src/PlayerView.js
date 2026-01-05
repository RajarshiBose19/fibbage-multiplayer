import React, { useState, useEffect } from "react";
import socket from "./socket";

export default function PlayerView({ roomCode, playerName, settings }) {
  const [phase, setPhase] = useState("LOBBY");
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState([]);
  const [submitted, setSubmitted] = useState(false);
  const [inputValue, setInputValue] = useState("");

  const [selectedVote, setSelectedVote] = useState(null);
  const [betAmount, setBetAmount] = useState(0);
  const [myScore, setMyScore] = useState(0);

  useEffect(() => {
    socket.on("phase_change", (data) => {
      setPhase(data.phase);
      setSubmitted(false);
      setInputValue("");
      setSelectedVote(null);
      setBetAmount(0);

      if (data.question) setQuestion(data.question);
      if (data.options) setOptions(data.options);
    });

    socket.on("round_results", (data) => {
      setPhase("REVEAL");
      const me = data.players.find((p) => p.name === playerName);
      if (me) setMyScore(me.score);
    });

    socket.on("game_over", () => setPhase("GAME_OVER"));

    return () => {
      socket.off("phase_change");
      socket.off("round_results");
      socket.off("game_over");
    };
  }, [playerName]);

  const submitLie = () => {
    if (!inputValue) return;
    socket.emit("submit_lie", { roomCode, lie: inputValue });
    setSubmitted(true);
  };

  const handleOptionClick = (text) => {
    if (settings.betting) {
      setSelectedVote(text);
    } else {
      socket.emit("submit_vote", { roomCode, vote: text, bet: 0 });
      setSubmitted(true);
    }
  };

  const confirmBet = () => {
    if (!selectedVote) return;
    socket.emit("submit_vote", {
      roomCode,
      vote: selectedVote,
      bet: betAmount,
    });
    setSubmitted(true);
  };

  if (phase === "LOBBY") {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h1>YOU'RE IN!</h1>
          <p>Look at the TV screen.</p>
          <div style={styles.avatar}>{playerName}</div>
          <div style={{ marginTop: "20px", fontSize: "0.8rem", color: "#aaa" }}>
            Rounds: {settings.rounds} | Betting:{" "}
            {settings.betting ? "ON" : "OFF"}
          </div>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h2>LOCKED IN</h2>
          <p>Waiting for others...</p>
        </div>
      </div>
    );
  }

  if (phase === "WRITING") {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <p style={{ marginBottom: "10px" }}>{question}</p>
          <input
            style={styles.input}
            placeholder="Write a lie..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
          />
          <button style={styles.btn} onClick={submitLie}>
            SUBMIT
          </button>
        </div>
      </div>
    );
  }

  if (phase === "VOTING") {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <p>Find the Truth:</p>

          {settings.betting && selectedVote ? (
            <div>
              <h3>Selected: {selectedVote}</h3>
              <p>Bet Points (Max: {Math.max(0, myScore)})</p>
              <input
                type="range"
                min="0"
                max={Math.max(0, myScore)}
                value={betAmount}
                onChange={(e) => setBetAmount(parseInt(e.target.value))}
                style={{ width: "100%", margin: "20px 0" }}
              />
              <div style={{ fontSize: "2rem", color: "#FFE66D" }}>
                {betAmount}
              </div>
              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  style={styles.secondaryBtn}
                  onClick={() => setSelectedVote(null)}
                >
                  BACK
                </button>
                <button style={styles.btn} onClick={confirmBet}>
                  CONFIRM
                </button>
              </div>
            </div>
          ) : (
            <div style={styles.grid}>
              {options.map((opt, idx) => (
                <button
                  key={idx}
                  style={styles.optionBtn}
                  onClick={() => handleOptionClick(opt.text)}
                >
                  {opt.text}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (phase === "REVEAL") {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h2>Look at the TV!</h2>
          <p>Your Score: {myScore}</p>
        </div>
      </div>
    );
  }

  return <div style={styles.container}>Loading...</div>;
}

const styles = {
  container: {
    minHeight: "100dvh",
    backgroundColor: "#1A1A2E",
    color: "white",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    fontFamily: "sans-serif",
    padding: "10px",
  },
  card: {
    backgroundColor: "#16213E",
    padding: "20px",
    borderRadius: "15px",
    textAlign: "center",
    width: "100%",
    maxWidth: "400px",
  },
  avatar: {
    backgroundColor: "#4ECDC4",
    color: "black",
    padding: "10px",
    borderRadius: "20px",
    fontWeight: "bold",
    marginTop: "20px",
    display: "inline-block",
  },
  input: {
    width: "100%",
    padding: "15px",
    marginBottom: "15px",
    borderRadius: "10px",
    border: "none",
    fontSize: "16px",
    boxSizing: "border-box",
  },
  btn: {
    width: "100%",
    padding: "15px",
    backgroundColor: "#E94560",
    color: "white",
    border: "none",
    borderRadius: "10px",
    fontWeight: "bold",
    fontSize: "1.1rem",
  },
  secondaryBtn: {
    width: "100%",
    padding: "15px",
    backgroundColor: "#666",
    color: "white",
    border: "none",
    borderRadius: "10px",
    fontWeight: "bold",
    fontSize: "1.1rem",
  },
  grid: { display: "flex", flexDirection: "column", gap: "10px" },
  optionBtn: {
    padding: "15px",
    backgroundColor: "white",
    color: "#1A1A2E",
    border: "none",
    borderRadius: "10px",
    fontWeight: "bold",
    fontSize: "1rem",
  },
};
