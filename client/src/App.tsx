import { useEffect, useState } from "react";
import { io } from "socket.io-client";

type Card = { suit: "S" | "H" | "D" | "C"; rank: string; id: string };
type View = any;

const socket = io("http://localhost:3001");

function prettySuit(s: string) {
  return s === "S" ? "♠" : s === "H" ? "♥" : s === "D" ? "♦" : "♣";
}

function CardPill({ c }: { c: Card }) {
  return (
    <span style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 999, marginRight: 8 }}>
      {c.rank}
      {prettySuit(c.suit)}
    </span>
  );
}

export default function App() {
  const [roomId, setRoomId] = useState("");
  const [name, setName] = useState("Player");
  const [cpuCount, setCpuCount] = useState(2);
  const [cpuDifficulty, setCpuDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [state, setState] = useState<View | null>(null);
  const [joinRoom, setJoinRoom] = useState("");

  useEffect(() => {
    socket.on("state", (v) => setState(v));
    return () => {
      socket.off("state");
    };
  }, []);

  const you = state?.you;

  const act = (action: any) =>
    socket.emit("act", { playerId, action }, (res: any) => {
      if (res?.error) alert(res.error);
    });

  const create = () =>
    socket.emit("room:create", { name, cpuCount, cpuDifficulty }, (res: any) => {
      if (res?.error) return alert(res.error);
      setRoomId(res.roomId);
      setPlayerId(res.playerId);
      setState(res.state);
    });

  const join = () =>
    socket.emit("room:join", { roomId: joinRoom.trim().toUpperCase(), name }, (res: any) => {
      if (res?.error) return alert(res.error);
      setRoomId(res.roomId);
      setPlayerId(res.playerId);
      setState(res.state);
    });

  const nextHand = () =>
    socket.emit("hand:next", { playerId }, (res: any) => {
      if (res?.error) alert(res.error);
    });

  const doRematch = () =>
    socket.emit("room:rematch", { playerId }, (res: any) => {
      if (res?.error) alert(res.error);
    });

  const canAct = !!you?.canAct;
  const phase = state?.phase;

  return (
    <div style={{ maxWidth: 980, margin: "24px auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>Scat (31)</h1>

      {!playerId && (
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <div style={{ padding: 16, border: "1px solid #eee", borderRadius: 12 }}>
            <h3>Create room</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
              <input
                type="number"
                value={cpuCount}
                onChange={(e) => setCpuCount(parseInt(e.target.value || "0", 10))}
                style={{ width: 90 }}
                min={0}
                max={8}
              />
              <select value={cpuDifficulty} onChange={(e) => setCpuDifficulty(e.target.value as any)}>
                <option value="easy">easy</option>
                <option value="medium">medium</option>
                <option value="hard">hard</option>
              </select>
              <button onClick={create}>Create</button>
            </div>
            <div style={{ marginTop: 8, color: "#666" }}>
              CPU players: 0–8 (total max 9 players).
            </div>
          </div>

          <div style={{ padding: 16, border: "1px solid #eee", borderRadius: 12 }}>
            <h3>Join room</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
              <input
                value={joinRoom}
                onChange={(e) => setJoinRoom(e.target.value)}
                placeholder="ROOMID"
                style={{ width: 120 }}
              />
              <button onClick={join}>Join</button>
            </div>
          </div>
        </div>
      )}

      {playerId && state && (
        <>
          <div style={{ marginTop: 12, padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <div>
                <b>Room:</b> {state.roomId}
              </div>
              <div>
                <b>Phase:</b> {phase}
              </div>
              <div>
                <b>Top discard:</b>{" "}
                {state.topDiscard ? `${state.topDiscard.rank}${prettySuit(state.topDiscard.suit)}` : "—"}
              </div>
              <div>
                <b>Stock:</b> {state.stockCount}
              </div>
              <div>
                <b>Rule:</b> 3-of-kind = 30.5
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <b>Players</b>
              <ul>
                {state.players.map((p: any) => (
                  <li key={p.id}>
                    {p.name} ({p.type}) — lives: {p.lives}
                    {p.eliminated ? " [OUT]" : ""}
                    {state.turnPlayerId === p.id ? " ← turn" : ""}
                    {state.knockedBy === p.id ? " (knocked)" : ""}
                    {typeof p.revealedValue === "number" ? ` — value: ${p.revealedValue}` : ""}
                    {p.revealedHand && (phase === "SHOWDOWN" || phase === "HAND_OVER" || phase === "GAME_OVER")
                      ? ` — hand: ${p.revealedHand.map((c: Card) => `${c.rank}${prettySuit(c.suit)}`).join(" ")}`
                      : ""}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div style={{ marginTop: 12, padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
            <h3>Your hand</h3>
            <div style={{ marginBottom: 10 }}>
              {you.hand.map((c: Card) => (
                <CardPill key={c.id} c={c} />
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button disabled={!canAct || you.mustDiscard} onClick={() => act({ type: "DRAW_STOCK" })}>
                Draw stock
              </button>
              <button disabled={!canAct || you.mustDiscard} onClick={() => act({ type: "DRAW_DISCARD" })}>
                Take discard
              </button>
              <button disabled={!you.canKnock || you.mustDiscard} onClick={() => act({ type: "KNOCK" })}>
                Knock
              </button>
            </div>

            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 600 }}>Discard one (after you draw):</div>
              <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {you.hand.map((c: Card) => (
                  <button key={c.id} disabled={!canAct || !you.mustDiscard} onClick={() => act({ type: "DISCARD", cardId: c.id })}>
                    Discard {c.rank}
                    {prettySuit(c.suit)}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {phase === "HAND_OVER" && <button onClick={nextHand}>Next hand</button>}
              <button onClick={doRematch}>Rematch</button>
            </div>

            {phase === "GAME_OVER" && (
              <div style={{ marginTop: 12, fontWeight: 700 }}>
                Game Over. Winner: {state.players.find((p: any) => p.id === state.winnerId)?.name}
              </div>
            )}
          </div>

          <div style={{ marginTop: 12, padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
            <h3>Log</h3>
            <ul>
              {state.log.map((l: string, i: number) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
