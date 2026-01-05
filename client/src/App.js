import React, { useState, useEffect } from "react";
import socket from "./socket";
import HostView from "./HostView";
import PlayerView from "./PlayerView";

function App() {
  const [role, setRole] = useState(null);
  const [roomCode, setRoomCode] = useState(null);
  const [playerName, setPlayerName] = useState("");
  const [error, setError] = useState("");

  const [roomSettings, setRoomSettings] = useState(null);

  const [hostSettings, setHostSettings] = useState({
    rounds: 5,
    betting: false,
    shuffle: true,
  });

  useEffect(() => {
    socket.on("room_created", (code) => {
      setRoomCode(code);
      setRole("HOST");
    });

    socket.on("joined_success", (data) => {
      setRoomCode(data.roomCode);
      setRoomSettings(data.settings);
      setRole("PLAYER");
    });

    socket.on("error_message", (msg) => {
      setError(msg);
      setTimeout(() => setError(""), 3000);
    });

    return () => {
      socket.off("room_created");
      socket.off("joined_success");
      socket.off("error_message");
    };
  }, []);

  const createGame = () => {
    socket.emit("create_room", hostSettings);
  };

  const joinGame = () => {
    const code = document.getElementById("roomInput").value.toUpperCase();
    const name = document.getElementById("nameInput").value;
    if (!code || !name) return setError("Please fill in all fields");
    setPlayerName(name);
    socket.emit("join_room", { roomCode: code, playerName: name });
  };

  if (role === "HOST") {
    return <HostView roomCode={roomCode} />;
  }

  if (role === "PLAYER") {
    return (
      <PlayerView
        roomCode={roomCode}
        playerName={playerName}
        settings={roomSettings}
      />
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.logo}>
          FIBBAGE
          <span style={{ color: hostSettings.betting ? "#FFE66D" : "#4ECDC4" }}>
            {hostSettings.betting ? "BET" : "MULTI"}
          </span>
        </h1>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.settingsArea}>
          <div style={styles.settingRow}>
            <label>Rounds: {hostSettings.rounds}</label>
            <input
              type="range"
              min="1"
              max="20"
              value={hostSettings.rounds}
              onChange={(e) =>
                setHostSettings({
                  ...hostSettings,
                  rounds: parseInt(e.target.value),
                })
              }
            />
          </div>
          <div style={styles.settingRow}>
            <label
              style={{ color: hostSettings.betting ? "#FFE66D" : "white" }}
            >
              Enable Betting?
            </label>
            <input
              type="checkbox"
              checked={hostSettings.betting}
              onChange={(e) =>
                setHostSettings({ ...hostSettings, betting: e.target.checked })
              }
              style={{ transform: "scale(1.5)" }}
            />
          </div>
        </div>

        <div style={styles.section}>
          <button onClick={createGame} style={styles.primaryButton}>
            CREATE GAME (HOST)
          </button>
        </div>

        <div style={styles.divider}>OR</div>

        <div style={styles.section}>
          <input
            id="roomInput"
            placeholder="ROOM CODE"
            style={styles.input}
            maxLength={4}
          />
          <input
            id="nameInput"
            placeholder="YOUR NAME"
            style={styles.input}
            maxLength={12}
          />
          <button onClick={joinGame} style={styles.secondaryButton}>
            JOIN GAME
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    fontFamily: '"Inter", sans-serif',
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    minHeight: "100vh",
    backgroundColor: "#1A1A2E",
    color: "white",
  },
  card: {
    backgroundColor: "#16213E",
    padding: "2rem",
    borderRadius: "20px",
    textAlign: "center",
    width: "90%",
    maxWidth: "400px",
    boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
  },
  logo: { fontSize: "2.5rem", fontWeight: "900", marginBottom: "20px" },
  settingsArea: {
    backgroundColor: "rgba(0,0,0,0.2)",
    padding: "15px",
    borderRadius: "10px",
    marginBottom: "20px",
    textAlign: "left",
  },
  settingRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "10px",
  },
  input: {
    width: "100%",
    padding: "15px",
    marginBottom: "10px",
    backgroundColor: "#0F3460",
    border: "none",
    color: "white",
    borderRadius: "8px",
    fontSize: "1.1rem",
    textAlign: "center",
    textTransform: "uppercase",
    boxSizing: "border-box",
  },
  primaryButton: {
    width: "100%",
    padding: "15px",
    backgroundColor: "#E94560",
    border: "none",
    borderRadius: "8px",
    color: "white",
    fontWeight: "bold",
    cursor: "pointer",
    fontSize: "1.1rem",
  },
  secondaryButton: {
    width: "100%",
    padding: "15px",
    backgroundColor: "#4ECDC4",
    border: "none",
    borderRadius: "8px",
    color: "black",
    fontWeight: "bold",
    cursor: "pointer",
    fontSize: "1.1rem",
  },
  divider: { margin: "20px 0", color: "#666", fontWeight: "bold" },
  error: { color: "#FF6B6B", marginBottom: "10px", fontWeight: "bold" },
};

export default App;
