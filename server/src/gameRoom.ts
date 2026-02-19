import { v4 as uuid } from "uuid";
import {
  Action,
  GameState,
  Player,
  Rules,
  applyAction,
  handValue,
  makeClientView,
  startHand,
  nextActiveIndex
} from "../../shared/src/game";

export type CpuDifficulty = "easy" | "medium" | "hard";

export type Room = {
  id: string;
  state: GameState;
  socketsByPlayerId: Map<string, string>; // playerId -> socketId
  cpuDifficulty: CpuDifficulty;
};

function shortId() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

function makePlayer(name: string, type: "HUMAN" | "CPU"): Player {
  return { id: uuid(), name, type, hand: [], lives: 3, eliminated: false };
}

export function createRoom(hostName: string, cpuCount: number, cpuDifficulty: CpuDifficulty, rules?: Partial<Rules>): Room {
  const roomId = shortId();
  const baseRules: Rules = {
    startingLives: 3,
    allowKnockAnyScore: true,
    knockMinScore: null,
    threeOfKindValue: 30.5,
    ...rules
  };

  const players: Player[] = [];
  players.push(makePlayer(hostName, "HUMAN"));

  for (let i = 0; i < cpuCount; i++) players.push(makePlayer(`CPU ${i + 1}`, "CPU"));

  for (const p of players) {
    p.lives = baseRules.startingLives;
    p.eliminated = false;
    p.hand = [];
  }

  const state: GameState = {
    roomId,
    rules: baseRules,
    players,
    dealerIndex: 0,
    turnIndex: 0,
    phase: "PLAYING",
    knockedBy: null,
    finalTurnsLeft: 0,
    stock: [],
    discard: [],
    lastActionLog: [],
    winnerId: null,
    seed: Math.floor(Math.random() * 1e9)
  };

  startHand(state);

  return {
    id: roomId,
    state,
    socketsByPlayerId: new Map(),
    cpuDifficulty
  };
}

export function addHuman(room: Room, name: string): Player {
  const p = makePlayer(name, "HUMAN");
  p.lives = room.state.rules.startingLives;
  p.eliminated = false;
  p.hand = [];

  room.state.players.push(p);

  // Simple: restart hand on join
  room.state.lastActionLog.push(`${name} joined. Restarting hand.`);
  room.state.dealerIndex = 0;
  startHand(room.state);

  return p;
}

export function viewFor(room: Room, playerId: string | null) {
  return makeClientView(room.state, playerId);
}

export function nextHand(room: Room) {
  const s = room.state;
  if (s.phase !== "HAND_OVER") return;
  s.dealerIndex = nextActiveIndex(s, s.dealerIndex);
  startHand(s);
}

export function rematch(room: Room) {
  const s = room.state;

  for (const p of s.players) {
    p.lives = s.rules.startingLives;
    p.eliminated = false;
    p.hand = [];
  }

  s.winnerId = null;
  s.phase = "PLAYING";
  s.knockedBy = null;
  s.finalTurnsLeft = 0;

  s.dealerIndex = 0;
  s.turnIndex = 0;
  s.lastActionLog = ["Rematch started. Lives reset."];
  startHand(s);
}

// ---------------- CPU logic ----------------

export function maybeRunCpuTurn(room: Room, onAction: (a: Action) => void) {
  const s = room.state;
  if (s.phase !== "PLAYING" && s.phase !== "KNOCKED") return;

  const p = s.players[s.turnIndex];
  if (!p || p.eliminated || p.type !== "CPU") return;

  const diff = room.cpuDifficulty;

  const knockThreshold =
    diff === "easy" ? 28 :
    diff === "medium" ? 27 :
    25;

  const takeDiscardBias =
    diff === "easy" ? 0.2 :
    diff === "medium" ? 0.6 :
    0.9;

  const currentValue = handValue(p.hand, s.rules);

  // Knock decision
  if (currentValue >= knockThreshold) {
    const res = applyAction(s, p.id, { type: "KNOCK" });
    if (res.ok) onAction({ type: "KNOCK" });
    return;
  }

  const top = s.discard.length ? s.discard[s.discard.length - 1] : null;

  let takeDiscard = false;
  if (top) {
    const bestAfter = bestValueAfterAdding(p.hand, top, s.rules);
    const improves = bestAfter > currentValue;

    if (diff === "hard") {
      takeDiscard = improves;
    } else {
      takeDiscard = improves && Math.random() < takeDiscardBias;
    }
  }

  const drawAction: Action = takeDiscard ? { type: "DRAW_DISCARD" } : { type: "DRAW_STOCK" };
  const r1 = applyAction(s, p.id, drawAction);
  if (!r1.ok) return;
  onAction(drawAction);

  // pick discard
  const discardId =
    diff === "easy"
      ? chooseDiscardEasy(p.hand, s.rules)
      : diff === "medium"
        ? chooseBestDiscard(p.hand, s.rules)
        : chooseBestDiscardHard(p.hand, s.rules);

  const r2 = applyAction(s, p.id, { type: "DISCARD", cardId: discardId });
  if (!r2.ok) return;
  onAction({ type: "DISCARD", cardId: discardId });
}

function bestValueAfterAdding(hand: any[], add: any, rules: any): number {
  const cards = [...hand, add];
  let best = -1;
  for (const c of cards) {
    const three = cards.filter(x => x.id !== c.id);
    const v = require("../../shared/src/game").handValue(three, rules);
    if (v > best) best = v;
  }
  return best;
}

function chooseBestDiscard(hand4: any[], rules: any): string {
  let bestValue = -1;
  let bestDiscard = hand4[0].id;

  for (const c of hand4) {
    const three = hand4.filter((x: any) => x.id !== c.id);
    const v = require("../../shared/src/game").handValue(three, rules);
    if (v > bestValue) {
      bestValue = v;
      bestDiscard = c.id;
    }
  }
  return bestDiscard;
}

function chooseDiscardEasy(hand4: any[], rules: any): string {
  if (Math.random() < 0.6) {
    return hand4[Math.floor(Math.random() * hand4.length)].id;
  }
  return chooseBestDiscard(hand4, rules);
}

function chooseBestDiscardHard(hand4: any[], rules: any): string {
  let bestScore = -1e9;
  let bestDiscard = hand4[0].id;

  for (const c of hand4) {
    const three = hand4.filter((x: any) => x.id !== c.id);
    const v = require("../../shared/src/game").handValue(three, rules);

    const suitCounts: Record<string, number> = {};
    for (const t of three) suitCounts[t.suit] = (suitCounts[t.suit] ?? 0) + 1;
    const maxSuit = Math.max(...Object.values(suitCounts));

    const suitedBonus = maxSuit >= 2 ? 0.15 : 0;
    const score = v + suitedBonus;

    if (score > bestScore) {
      bestScore = score;
      bestDiscard = c.id;
    }
  }

  return bestDiscard;
}
