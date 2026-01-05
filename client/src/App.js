import React, { useState, useEffect, useRef } from "react";
import socket from "./socket";

const TIME_LIMIT = 45;
const PENALTY_PER_SEC = 20;
const POINTS_FOOL = 500;

const fillBlank = (questionText, answerText) => {
  if (!questionText) return answerText;
  const parts = questionText.split("____");
  if (parts.length < 2) return questionText + " " + answerText;
  return (
    <span>
      {parts[0]}
      <span
        style={{
          color: "#FFE66D",
          textDecoration: "underline",
          fontWeight: "bold",
        }}
      >
        {answerText.toUpperCase()}
      </span>
      {parts[1]}
    </span>
  );
};

export default function App() {
  const [view, setView] = useState("MENU");
  const [roomCode, setRoomCode] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState("");

  const [phase, setPhase] = useState("LOBBY");
  const [players, setPlayers] = useState([]);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const [revealData, setRevealData] = useState([]);
  const [roundBreakdown, setRoundBreakdown] = useState({});
  const [revealIndex, setRevealIndex] = useState(-1);
  const [revealStep, setRevealStep] = useState(0);

  const [inputValue, setInputValue] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [selectedVote, setSelectedVote] = useState(null);
  const [betAmount, setBetAmount] = useState(0);
  const [timeLeft, setTimeLeft] = useState(TIME_LIMIT);

  const [menuTab, setMenuTab] = useState("JOIN");
  const [hostConfig, setHostConfig] = useState({
    rounds: 5,
    betting: false,
    shuffle: true,
  });

  useEffect(() => {
    socket.on("joined_success", (data) => {
      setRoomCode(data.roomCode);
      setIsHost(data.isHost);
      setSettings(data.settings);
      setView("GAME");
      setPhase("LOBBY");
    });

    socket.on("update_players", (list) => setPlayers(list));

    socket.on("phase_change", (data) => {
      setPhase(data.phase);
      setQuestion(data.question || "");
      setOptions(data.options || []);
      setSubmitted(false);
      setInputValue("");
      setSelectedVote(null);
      setBetAmount(0);
      setProgress({ current: 0, total: players.length });
      setTimeLeft(TIME_LIMIT);
      setRevealIndex(-1);
      setRevealStep(0);
    });

    socket.on("update_progress", (data) => setProgress(data));

    socket.on("round_results", (data) => {
      setPhase("REVEAL");
      setRevealData(data.revealData);
      setPlayers(data.players);
      setRoundBreakdown(data.roundBreakdown);
      setQuestion(data.questionText);
      setRevealIndex(0);
      setRevealStep(0);
    });

    socket.on("next_reveal_card", () => {
      setRevealIndex((prev) => {
        return prev + 1;
      });
      setRevealStep(0);
    });

    socket.on("game_over", (finalPlayers) => {
      setPhase("GAME_OVER");
      setPlayers(finalPlayers);
    });

    socket.on("error_message", (msg) => {
      setError(msg);
      setTimeout(() => setError(""), 3000);
    });

    return () => {
      socket.off("joined_success");
      socket.off("update_players");
      socket.off("phase_change");
      socket.off("update_progress");
      socket.off("round_results");
      socket.off("next_reveal_card");
      socket.off("game_over");
      socket.off("error_message");
    };
  }, [players.length]);

  useEffect(() => {
    let interval = null;
    if ((phase === "WRITING" || phase === "VOTING") && !submitted) {
      interval = setInterval(() => setTimeLeft((prev) => prev - 1), 1000);
    }
    return () => clearInterval(interval);
  }, [phase, submitted]);

  useEffect(() => {
    if (phase !== "REVEAL" || revealIndex === -1 || revealIndex === 999) return;

    if (revealIndex >= revealData.length) {
      setRevealIndex(999);
      return;
    }

    const currentItem = revealData[revealIndex];

    if (currentItem.type === "LIE" && currentItem.voters.length === 0) {
      if (isHost) socket.emit("trigger_next_reveal", roomCode);
      return;
    }

    let timer;

    if (revealStep === 0) {
      timer = setTimeout(() => setRevealStep(1), 1000);
    } else if (revealStep === 1) {
      timer = setTimeout(() => setRevealStep(2), 1000);
    } else if (revealStep === 2) {
      timer = setTimeout(() => setRevealStep(3), 1000);
    }

    return () => clearTimeout(timer);
  }, [phase, revealIndex, revealStep, revealData, isHost, roomCode]);

  const handleCreate = () => {
    if (!playerName) return setError("Enter your name!");
    socket.emit("create_room", { playerName, settings: hostConfig });
  };

  const handleJoin = () => {
    if (!playerName || !roomCode) return setError("Enter name and code!");
    socket.emit("join_room", { roomCode: roomCode.toUpperCase(), playerName });
  };

  const startGame = () => socket.emit("start_game", roomCode);
  const nextRound = () => socket.emit("next_round", roomCode);

  const triggerNextReveal = () => {
    socket.emit("trigger_next_reveal", roomCode);
  };

  const submitLie = () => {
    if (!inputValue) return;
    socket.emit("submit_lie", { roomCode, lie: inputValue });
    setSubmitted(true);
  };

  const handleVoteClick = (text) => {
    if (settings.betting) {
      setSelectedVote(text);
    } else {
      socket.emit("submit_vote", { roomCode, vote: text, bet: 0 });
      setSubmitted(true);
    }
  };

  const confirmBet = () => {
    socket.emit("submit_vote", {
      roomCode,
      vote: selectedVote,
      bet: betAmount,
    });
    setSubmitted(true);
  };

  const renderTimer = () => {
    if (phase !== "WRITING" && phase !== "VOTING") return null;
    if (submitted) return null;

    const isOvertime = timeLeft < 0;
    const penalty = isOvertime ? Math.abs(timeLeft) * PENALTY_PER_SEC : 0;

    return (
      <div style={isOvertime ? styles.timerOvertime : styles.timerNormal}>
        {isOvertime ? <span>-{penalty}</span> : <span>{timeLeft}s</span>}
      </div>
    );
  };

  if (view === "MENU") {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.logo}>
            FIBBAGE<span style={{ color: "#4ECDC4" }}>LIVE</span>
          </h1>
          {error && <div style={styles.error}>{error}</div>}
          <div style={styles.tabs}>
            <button
              style={menuTab === "JOIN" ? styles.tabActive : styles.tab}
              onClick={() => setMenuTab("JOIN")}
            >
              JOIN
            </button>
            <button
              style={menuTab === "CREATE" ? styles.tabActive : styles.tab}
              onClick={() => setMenuTab("CREATE")}
            >
              CREATE
            </button>
          </div>
          <input
            style={styles.input}
            placeholder="YOUR NAME"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            maxLength={12}
          />
          {menuTab === "JOIN" ? (
            <>
              <input
                style={styles.input}
                placeholder="ROOM CODE"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value)}
                maxLength={4}
              />
              <button style={styles.primaryBtn} onClick={handleJoin}>
                JOIN GAME
              </button>
            </>
          ) : (
            <>
              <div style={styles.settingsBox}>
                <div style={styles.settingRow}>
                  <label>Rounds: {hostConfig.rounds}</label>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={hostConfig.rounds}
                    onChange={(e) =>
                      setHostConfig({
                        ...hostConfig,
                        rounds: parseInt(e.target.value),
                      })
                    }
                  />
                </div>
                <div style={styles.settingRow}>
                  <label
                    style={{ color: hostConfig.betting ? "#FFE66D" : "white" }}
                  >
                    Betting?
                  </label>
                  <input
                    type="checkbox"
                    checked={hostConfig.betting}
                    onChange={(e) =>
                      setHostConfig({
                        ...hostConfig,
                        betting: e.target.checked,
                      })
                    }
                    style={{ transform: "scale(1.5)" }}
                  />
                </div>
              </div>
              <button style={styles.primaryBtn} onClick={handleCreate}>
                CREATE & JOIN
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.gameCard}>
        <div style={styles.header}>
          <div style={styles.roomCode}>ROOM: {roomCode}</div>

          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            {phase !== "LOBBY" && <div style={styles.phaseBadge}>{phase}</div>}
            {renderTimer()}
          </div>
        </div>

        {phase === "LOBBY" && (
          <>
            <h2>WAITING FOR PLAYERS...</h2>
            <div style={styles.playerGrid}>
              {players.map((p) => (
                <div
                  key={p.id}
                  style={{ ...styles.chip, backgroundColor: p.color }}
                >
                  {p.name} {p.id === socket.id && "(YOU)"}
                </div>
              ))}
            </div>
            {isHost && players.length >= 2 && (
              <button style={styles.primaryBtn} onClick={startGame}>
                START GAME
              </button>
            )}
            {isHost && players.length < 2 && (
              <p style={{ color: "#666" }}>Need 2+ players to start</p>
            )}
          </>
        )}

        {phase === "WRITING" && (
          <>
            {renderTimer()}
            <h3 style={styles.question}>{question}</h3>
            {submitted ? (
              <div style={styles.waitingBox}>
                <h3>LIE SUBMITTED!</h3>
                <p>
                  Waiting for others... ({progress.current}/{progress.total})
                </p>
              </div>
            ) : (
              <>
                <input
                  style={styles.input}
                  placeholder="Write a believable lie..."
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                />
                <button style={styles.primaryBtn} onClick={submitLie}>
                  SUBMIT LIE
                </button>
              </>
            )}
          </>
        )}

        {phase === "VOTING" && (
          <>
            {renderTimer()}
            <h3 style={styles.question}>{question}</h3>
            {submitted ? (
              <div style={styles.waitingBox}>
                <h3>VOTE LOCKED!</h3>
                <p>
                  Waiting for others... ({progress.current}/{progress.total})
                </p>
              </div>
            ) : (
              <>
                {settings.betting && selectedVote ? (
                  <div style={styles.bettingBox}>
                    <h4>Bet on: "{selectedVote}"</h4>
                    <p>
                      Available Points:{" "}
                      {Math.max(
                        0,
                        players.find((p) => p.id === socket.id)?.score || 0
                      )}
                    </p>
                    <input
                      type="range"
                      min="0"
                      max={Math.max(
                        0,
                        players.find((p) => p.id === socket.id)?.score || 0
                      )}
                      value={betAmount}
                      onChange={(e) => setBetAmount(parseInt(e.target.value))}
                      style={{ width: "100%", margin: "15px 0" }}
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
                      <button style={styles.primaryBtn} onClick={confirmBet}>
                        CONFIRM
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={styles.optionsGrid}>
                    {options.map((opt, idx) => {
                      const isMyLie = opt.authorId === socket.id;
                      return (
                        <button
                          key={idx}
                          style={
                            isMyLie ? styles.disabledOption : styles.optionBtn
                          }
                          onClick={() => !isMyLie && handleVoteClick(opt.text)}
                          disabled={isMyLie}
                        >
                          {opt.text}{" "}
                          {isMyLie && (
                            <span style={{ fontSize: "0.7em" }}>
                              (YOUR LIE)
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {phase === "REVEAL" && (
          <>
            {revealIndex !== 999 && revealData[revealIndex] ? (
              <div style={styles.revealContainer}>
                <div style={styles.revealSentence}>
                  {fillBlank(question, revealData[revealIndex]?.text)}
                </div>

                <div
                  style={{
                    ...styles.stamp,
                    opacity: revealStep >= 1 ? 1 : 0,
                    transform:
                      revealStep >= 1
                        ? "scale(1) rotate(-10deg)"
                        : "scale(3) rotate(0deg)",
                    color:
                      revealData[revealIndex]?.type === "TRUTH"
                        ? "#4ECDC4"
                        : "#E94560",
                    borderColor:
                      revealData[revealIndex]?.type === "TRUTH"
                        ? "#4ECDC4"
                        : "#E94560",
                  }}
                >
                  {revealData[revealIndex]?.type === "TRUTH" ? "TRUTH" : "LIE"}
                </div>

                {revealData[revealIndex]?.type === "LIE" && (
                  <div
                    style={{
                      ...styles.authorReveal,
                      opacity: revealStep >= 2 ? 1 : 0,
                      transform:
                        revealStep >= 2 ? "translateY(0)" : "translateY(20px)",
                    }}
                  >
                    Written by:{" "}
                    <strong>{revealData[revealIndex]?.authorName}</strong>
                    {revealData[revealIndex]?.voters.length > 0 && (
                      <div style={styles.pointsBubble}>
                        +{revealData[revealIndex].voters.length * POINTS_FOOL}{" "}
                        pts
                      </div>
                    )}
                  </div>
                )}

                <div
                  style={{
                    ...styles.votersReveal,
                    opacity: revealStep >= 3 ? 1 : 0,
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      fontSize: "0.9rem",
                      color: "#aaa",
                      marginBottom: "5px",
                    }}
                  >
                    {revealData[revealIndex]?.type === "TRUTH"
                      ? "People who knew it:"
                      : "People who fell for it:"}
                  </div>

                  {revealData[revealIndex]?.voters.length > 0 ? (
                    revealData[revealIndex]?.voters.map((v, i) => (
                      <div key={i} style={styles.voterChip}>
                        {v.name}
                        {settings.betting && v.bet > 0 && (
                          <span
                            style={{
                              fontSize: "0.8em",
                              marginLeft: "5px",
                              color:
                                revealData[revealIndex]?.type === "TRUTH"
                                  ? "#4ECDC4"
                                  : "#E94560",
                            }}
                          >
                            {revealData[revealIndex]?.type === "TRUTH"
                              ? `+${v.bet}`
                              : `-${v.bet}`}
                          </span>
                        )}
                      </div>
                    ))
                  ) : (
                    <div style={{ fontStyle: "italic", color: "#666" }}>
                      No one.
                    </div>
                  )}
                </div>

                {isHost && revealStep >= 3 && (
                  <button style={styles.nextBtn} onClick={triggerNextReveal}>
                    NEXT &rarr;
                  </button>
                )}
                {!isHost && revealStep >= 3 && (
                  <p
                    style={{
                      marginTop: "20px",
                      color: "#666",
                      fontSize: "0.8rem",
                    }}
                  >
                    Waiting for Host...
                  </p>
                )}
              </div>
            ) : (
              <div style={styles.scoreboard}>
                <h3>ROUND SUMMARY</h3>
                <div style={styles.breakdownList}>
                  {players
                    .sort((a, b) => b.score - a.score)
                    .map((p, i) => {
                      const stats = roundBreakdown[p.id] || {};
                      return (
                        <div key={p.id} style={styles.breakdownRow}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                            }}
                          >
                            <span
                              style={{ fontWeight: "bold", fontSize: "1.1rem" }}
                            >
                              {i + 1}. {p.name}
                            </span>
                            <span
                              style={{ color: "#4ECDC4", fontSize: "1.2rem" }}
                            >
                              {p.score}
                            </span>
                          </div>
                          <div
                            style={{
                              fontSize: "0.8rem",
                              color: "#aaa",
                              display: "flex",
                              gap: "10px",
                              marginTop: "5px",
                            }}
                          >
                            {stats.correct > 0 && (
                              <span style={{ color: "#4ECDC4" }}>
                                Correct: +{stats.correct}
                              </span>
                            )}
                            {stats.fooling > 0 && (
                              <span style={{ color: "#FFE66D" }}>
                                Fooled: +{stats.fooling}
                              </span>
                            )}
                            {stats.bet !== 0 && (
                              <span
                                style={{
                                  color: stats.bet > 0 ? "#4ECDC4" : "#E94560",
                                }}
                              >
                                Bet: {stats.bet > 0 ? "+" : ""}
                                {stats.bet}
                              </span>
                            )}
                            {stats.penalty > 0 && (
                              <span style={{ color: "#E94560" }}>
                                Late: -{stats.penalty}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
                {isHost ? (
                  <button style={styles.primaryBtn} onClick={nextRound}>
                    NEXT ROUND
                  </button>
                ) : (
                  <p>Waiting for Host...</p>
                )}
              </div>
            )}
          </>
        )}

        {phase === "GAME_OVER" && (
          <>
            <h1>GAME OVER</h1>
            <div style={{ fontSize: "4rem" }}>🏆</div>
            <h2 style={{ color: players[0].color }}>{players[0].name} WINS!</h2>
            <button
              style={styles.primaryBtn}
              onClick={() => window.location.reload()}
            >
              EXIT
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: "100dvh",
    backgroundColor: "#1A1A2E",
    color: "white",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    fontFamily: '"Inter", sans-serif',
    padding: "10px",
  },
  card: {
    backgroundColor: "#16213E",
    padding: "30px",
    borderRadius: "20px",
    textAlign: "center",
    width: "100%",
    maxWidth: "400px",
    boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
  },
  gameCard: {
    backgroundColor: "#16213E",
    padding: "20px",
    borderRadius: "20px",
    textAlign: "center",
    width: "100%",
    maxWidth: "600px",
    minHeight: "80vh",
    display: "flex",
    flexDirection: "column",
    position: "relative",
  },
  logo: { fontSize: "2.5rem", fontWeight: "900", marginBottom: "20px" },
  tabs: {
    display: "flex",
    marginBottom: "20px",
    backgroundColor: "#0F3460",
    borderRadius: "10px",
    padding: "5px",
  },
  tab: {
    flex: 1,
    padding: "10px",
    background: "transparent",
    border: "none",
    color: "#aaa",
    cursor: "pointer",
    fontWeight: "bold",
  },
  tabActive: {
    flex: 1,
    padding: "10px",
    backgroundColor: "#4ECDC4",
    borderRadius: "8px",
    border: "none",
    color: "black",
    cursor: "pointer",
    fontWeight: "bold",
  },
  input: {
    width: "100%",
    padding: "15px",
    marginBottom: "15px",
    backgroundColor: "#0F3460",
    border: "2px solid #1F4068",
    color: "white",
    borderRadius: "10px",
    fontSize: "1.1rem",
    textAlign: "center",
    boxSizing: "border-box",
  },
  primaryBtn: {
    width: "100%",
    padding: "15px",
    backgroundColor: "#E94560",
    color: "white",
    border: "none",
    borderRadius: "10px",
    fontWeight: "bold",
    fontSize: "1.1rem",
    cursor: "pointer",
    marginTop: "10px",
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
    cursor: "pointer",
    marginTop: "10px",
  },
  nextBtn: {
    padding: "15px 40px",
    backgroundColor: "#4ECDC4",
    color: "black",
    border: "none",
    borderRadius: "30px",
    fontWeight: "bold",
    fontSize: "1.2rem",
    cursor: "pointer",
    marginTop: "30px",
    boxShadow: "0 5px 15px rgba(78, 205, 196, 0.4)",
  },
  settingsBox: {
    backgroundColor: "rgba(0,0,0,0.2)",
    padding: "15px",
    borderRadius: "10px",
    marginBottom: "15px",
    textAlign: "left",
  },
  settingRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "10px",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "20px",
    borderBottom: "1px solid #333",
    paddingBottom: "10px",
  },
  roomCode: { fontWeight: "bold", color: "#4ECDC4" },
  phaseBadge: {
    backgroundColor: "#E94560",
    padding: "2px 8px",
    borderRadius: "5px",
    fontSize: "0.8rem",
    fontWeight: "bold",
  },
  playerGrid: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    justifyContent: "center",
    marginBottom: "20px",
  },
  chip: {
    padding: "8px 15px",
    borderRadius: "20px",
    color: "black",
    fontWeight: "bold",
    fontSize: "0.9rem",
  },
  question: { fontSize: "1.4rem", marginBottom: "20px", lineHeight: "1.4" },
  waitingBox: {
    padding: "30px",
    border: "2px dashed #4ECDC4",
    borderRadius: "15px",
    color: "#4ECDC4",
  },
  optionsGrid: { display: "flex", flexDirection: "column", gap: "10px" },
  optionBtn: {
    padding: "15px",
    backgroundColor: "white",
    color: "#1A1A2E",
    border: "none",
    borderRadius: "10px",
    fontWeight: "bold",
    fontSize: "1.1rem",
    cursor: "pointer",
  },
  disabledOption: {
    padding: "15px",
    backgroundColor: "rgba(255,255,255,0.1)",
    color: "#aaa",
    border: "2px dashed #555",
    borderRadius: "10px",
    fontSize: "1.1rem",
  },
  bettingBox: {
    backgroundColor: "#0F3460",
    padding: "20px",
    borderRadius: "15px",
    border: "2px solid #4ECDC4",
  },
  timerNormal: {
    backgroundColor: "rgba(0,0,0,0.3)",
    padding: "5px 10px",
    borderRadius: "15px",
    fontWeight: "bold",
    color: "#4ECDC4",
    fontSize: "0.9rem",
    minWidth: "40px",
  },
  timerOvertime: {
    backgroundColor: "#E94560",
    padding: "5px 10px",
    borderRadius: "15px",
    fontWeight: "bold",
    color: "white",
    fontSize: "0.9rem",
    animation: "pulse 0.5s infinite",
    minWidth: "40px",
  },
  revealContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "50vh",
  },
  revealSentence: {
    fontSize: "1.5rem",
    lineHeight: "1.5",
    marginBottom: "30px",
  },
  stamp: {
    fontSize: "3rem",
    fontWeight: "900",
    border: "5px solid",
    padding: "10px 20px",
    borderRadius: "10px",
    textTransform: "uppercase",
    transition: "all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
    marginBottom: "20px",
  },
  authorReveal: {
    fontSize: "1.2rem",
    color: "#aaa",
    marginBottom: "20px",
    transition: "all 0.5s ease",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "5px",
  },
  pointsBubble: {
    backgroundColor: "#FFE66D",
    color: "black",
    padding: "5px 10px",
    borderRadius: "15px",
    fontWeight: "bold",
    fontSize: "0.9rem",
    animation: "bounce 0.5s",
  },
  votersReveal: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    justifyContent: "center",
    transition: "opacity 0.5s ease",
    flexDirection: "column",
    alignItems: "center",
  },
  voterChip: {
    backgroundColor: "#fff",
    color: "#1A1A2E",
    padding: "8px 15px",
    borderRadius: "20px",
    fontWeight: "bold",
  },
  scoreboard: {
    textAlign: "left",
    width: "100%",
  },
  breakdownList: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    marginBottom: "20px",
  },
  breakdownRow: {
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: "15px",
    borderRadius: "10px",
  },
};
