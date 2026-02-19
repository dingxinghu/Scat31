export type Suit = "S" | "H" | "D" | "C";
export type Rank =
  | "A" | "K" | "Q" | "J"
  | "10" | "9" | "8" | "7" | "6" | "5" | "4" | "3" | "2";

export type Card = { suit: Suit; rank: Rank; id: string };

export type PlayerType = "HUMAN" | "CPU";
export type Player = {
  id: string;
  name: string;
  type: PlayerType;
  hand: Card[];
  lives: number;
  eliminated: boolean;
};

export type Phase = "PLAYING" | "KNOCKED" | "SHOWDOWN" | "HAND_OVER" | "GAME_OVER";

export type Rules = {
  startingLives: number;            // 3
  allowKnockAnyScore: boolean;      // true
  knockMinScore: number | null;     // unused
  threeOfKindValue: number | null;  // 30.5
};

export type GameState = {
  roomId: string;
  rules: Rules;
  players: Player[];
  dealerIndex: number;
  turnIndex: number;
  phase: Phase;
  knockedBy: string | null;
  finalTurnsLeft: number;
  stock: Card[];
  discard: Card[]; // top is last
  lastActionLog: string[];
  winnerId: string | null;
  seed: number;
};

export type ClientView = {
  roomId: string;
  rules: Rules;
  players: Array<{
    id: string;
    name: string;
    type: PlayerType;
    lives: number;
    eliminated: boolean;
    handCount: number;
    revealedHand?: Card[];
    revealedValue?: number;
  }>;
  dealerIndex: number;
  turnPlayerId: string;
  phase: Phase;
  knockedBy: string | null;
  stockCount: number;
  topDiscard: Card | null;
  you: {
    id: string;
    name: string;
    hand: Card[];
    canAct: boolean;
    canKnock: boolean;
    mustDiscard: boolean;
  } | null;
  log: string[];
};

export type Action =
  | { type: "DRAW_STOCK" }
  | { type: "DRAW_DISCARD" }
  | { type: "DISCARD"; cardId: string }
  | { type: "KNOCK" };

export function rankValue(rank: Rank): number {
  if (rank === "A") return 11;
  if (rank === "K" || rank === "Q" || rank === "J") return 10;
  return parseInt(rank, 10);
}

export function handValue(hand: Card[], rules: Rules): number {
  if (hand.length !== 3) return 0;

  // 3-of-a-kind special
  if (rules.threeOfKindValue != null) {
    const [a, b, c] = hand;
    if (a.rank === b.rank && b.rank === c.rank) return rules.threeOfKindValue;
  }

  const sumsBySuit: Record<Suit, number> = { S: 0, H: 0, D: 0, C: 0 };
  for (const c of hand) sumsBySuit[c.suit] += rankValue(c.rank);

  const bestSuitSum = Math.max(...Object.values(sumsBySuit));
  const bestSingle = Math.max(...hand.map(c => rankValue(c.rank)));
  return Math.max(bestSuitSum, bestSingle);
}

export function hasExact31(hand: Card[], rules: Rules): boolean {
  return handValue(hand, rules) === 31;
}

// Deterministic RNG (LCG)
export function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function shuffleInPlace<T>(arr: T[], seed: number) {
  const rng = makeRng(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export function makeDeck(seed: number): Card[] {
  const suits: Suit[] = ["S", "H", "D", "C"];
  const ranks: Rank[] = ["A","K","Q","J","10","9","8","7","6","5","4","3","2"];
  const deck: Card[] = [];
  let n = 0;
  for (const suit of suits) for (const rank of ranks) deck.push({ suit, rank, id: `${suit}${rank}-${n++}` });

  shuffleInPlace(deck, seed);
  return deck;
}

function refillStockFromDiscard(state: GameState): boolean {
  // Keep top discard. Recycle the rest into stock.
  if (state.discard.length <= 1) return false;

  const top = state.discard[state.discard.length - 1];
  const recycle = state.discard.slice(0, -1);

  shuffleInPlace(recycle, state.seed++);
  state.stock = recycle;
  state.discard = [top];

  state.lastActionLog.push(`Stock exhausted → reshuffled discard pile into stock.`);
  return true;
}

export function nextActiveIndex(state: GameState, fromIndex: number): number {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (fromIndex + step) % n;
    const p = state.players[idx];
    if (!p.eliminated) return idx;
  }
  return fromIndex;
}

export function activePlayers(state: GameState): Player[] {
  return state.players.filter(p => !p.eliminated);
}

export function loseLives(p: Player, n: number) {
  if (p.eliminated) return;
  p.lives -= n;
  if (p.lives <= 0) {
    p.lives = 0;
    p.eliminated = true;
  }
}

export function finishElimsAndMaybeGameOver(state: GameState) {
  const alive = state.players.filter(p => !p.eliminated);
  if (alive.length === 1) {
    state.winnerId = alive[0].id;
    state.phase = "GAME_OVER";
  } else {
    state.winnerId = null;
  }
}

export function startHand(state: GameState) {
  state.phase = "PLAYING";
  state.knockedBy = null;
  state.finalTurnsLeft = 0;
  state.stock = makeDeck(state.seed++);
  state.discard = [];
  state.lastActionLog = [];

  for (const p of state.players) p.hand = [];

  // deal 3 each starting left of dealer
  const order: number[] = [];
  let idx = state.dealerIndex;
  for (let i = 0; i < state.players.length; i++) {
    idx = nextActiveIndex(state, idx);
    order.push(idx);
  }

  for (let round = 0; round < 3; round++) {
    for (const pi of order) {
      const card = state.stock.pop();
      if (!card) throw new Error("Stock empty during deal");
      state.players[pi].hand.push(card);
    }
  }

  // start discard pile
  const up = state.stock.pop();
  if (!up) throw new Error("Stock empty starting discard");
  state.discard.push(up);

  // first turn is left of dealer
  state.turnIndex = nextActiveIndex(state, state.dealerIndex);

  // Dealt 31 auto-declare
  const winners = state.players.filter(p => !p.eliminated && hasExact31(p.hand, state.rules));
  if (winners.length > 0) {
    state.lastActionLog.push(`Dealt 31! ${winners.map(w => w.name).join(", ")} declare immediately.`);
    for (const p of state.players) {
      if (p.eliminated) continue;
      if (winners.some(w => w.id === p.id)) continue;
      loseLives(p, 1);
    }
    finishElimsAndMaybeGameOver(state);
    state.phase = state.winnerId ? "GAME_OVER" : "HAND_OVER";
  }
}

export function canKnock(state: GameState, playerId: string): boolean {
  if (state.phase !== "PLAYING") return false;
  const current = state.players[state.turnIndex];
  if (!current || current.id !== playerId) return false;
  if (state.knockedBy) return false;
  if (state.rules.allowKnockAnyScore) return true;
  const v = handValue(current.hand, state.rules);
  return state.rules.knockMinScore != null && v >= state.rules.knockMinScore;
}

export function applyAction(
  state: GameState,
  playerId: string,
  action: Action
): { ok: true } | { ok: false; error: string } {
  if (state.phase !== "PLAYING" && state.phase !== "KNOCKED") return { ok: false, error: "Hand is not active." };

  const p = state.players[state.turnIndex];
  if (!p || p.id !== playerId) return { ok: false, error: "Not your turn." };
  if (p.eliminated) return { ok: false, error: "You are eliminated." };

  // Track per-turn stage on the player (server-only)
  const anyP = p as any;
  if (anyP.turnStage == null) anyP.turnStage = "START"; // START | DREW

  if (action.type === "KNOCK") {
    if (anyP.turnStage !== "START") return { ok: false, error: "You can only knock at the start of your turn." };
    if (!canKnock(state, playerId)) return { ok: false, error: "Knock not allowed." };
    state.knockedBy = playerId;
    state.phase = "KNOCKED";
    state.finalTurnsLeft = activePlayers(state).length - 1;
    state.lastActionLog.push(`${p.name} knocks.`);
    advanceTurn(state);
    return { ok: true };
  }

  if (action.type === "DRAW_STOCK") {
    if (anyP.turnStage !== "START") return { ok: false, error: "You already drew." };

    if (state.stock.length === 0) {
      const ok = refillStockFromDiscard(state);
      if (!ok) return { ok: false, error: "No cards left to draw." };
    }

    const c = state.stock.pop();
    if (!c) return { ok: false, error: "No cards left to draw." };

    p.hand.push(c);
    anyP.drawnCardId = c.id;
    anyP.turnStage = "DREW";
    state.lastActionLog.push(`${p.name} draws from stock.`);
    return { ok: true };
  }

  if (action.type === "DRAW_DISCARD") {
    if (anyP.turnStage !== "START") return { ok: false, error: "You already drew." };
    const c = state.discard.pop();
    if (!c) return { ok: false, error: "Discard is empty." };
    p.hand.push(c);
    anyP.tookDiscardId = c.id;
    anyP.turnStage = "DREW";
    state.lastActionLog.push(`${p.name} takes the top discard.`);
    return { ok: true };
  }

  if (action.type === "DISCARD") {
    if (anyP.turnStage !== "DREW") return { ok: false, error: "You must draw first." };

    const idx = p.hand.findIndex(x => x.id === action.cardId);
    if (idx === -1) return { ok: false, error: "You don't have that card." };

    // Illegal: take discard then discard same card
    if (anyP.tookDiscardId && anyP.tookDiscardId === action.cardId) {
      return { ok: false, error: "Illegal: cannot discard the same card you took from discard." };
    }

    const [c] = p.hand.splice(idx, 1);
    state.discard.push(c);

    if (p.hand.length !== 3) return { ok: false, error: "Internal error: hand size not 3." };

    // Immediate 31 declaration after discard
    if (hasExact31(p.hand, state.rules)) {
      state.lastActionLog.push(`${p.name} declares 31! Everyone else loses 1 life.`);
      for (const op of state.players) {
        if (op.eliminated) continue;
        if (op.id === p.id) continue;
        loseLives(op, 1);
      }
      finishElimsAndMaybeGameOver(state);
      state.phase = state.winnerId ? "GAME_OVER" : "HAND_OVER";
      resetTurnStages(state);
      return { ok: true };
    }

    state.lastActionLog.push(`${p.name} discards.`);

    if (state.phase === "KNOCKED") {
      state.finalTurnsLeft -= 1;
      if (state.finalTurnsLeft <= 0) {
        state.phase = "SHOWDOWN";
        scoreShowdown(state);
        resetTurnStages(state);
        return { ok: true };
      }
    }

    advanceTurn(state);
    return { ok: true };
  }

  return { ok: false, error: "Unknown action." };
}

function resetTurnStages(state: GameState) {
  for (const p of state.players) {
    const anyP = p as any;
    anyP.turnStage = null;
    anyP.drawnCardId = null;
    anyP.tookDiscardId = null;
  }
}

function advanceTurn(state: GameState) {
  const current = state.players[state.turnIndex] as any;
  current.turnStage = null;
  current.drawnCardId = null;
  current.tookDiscardId = null;

  state.turnIndex = nextActiveIndex(state, state.turnIndex);
}

export function scoreShowdown(state: GameState) {
  const knockerId = state.knockedBy;
  const active = state.players.filter(p => !p.eliminated);
  const scores = active.map(p => ({ id: p.id, v: handValue(p.hand, state.rules) }));
  const min = Math.min(...scores.map(s => s.v));
  const lowest = scores.filter(s => s.v === min).map(s => s.id);

  const knockerIsLowest = knockerId != null && lowest.length === 1 && lowest[0] === knockerId;
  const includesKnocker = knockerId != null && lowest.includes(knockerId);

  state.lastActionLog.push(
    `Showdown. ` + scores.map(s => `${state.players.find(p => p.id === s.id)!.name}:${s.v}`).join(", ")
  );

  // Your base rule behavior from the text:
  // - lowest loses 1
  // - tie involving knocker: others lose 1, knocker safe
  // - knocker sole lowest: knocker loses 2
  if (knockerIsLowest) {
    const k = state.players.find(p => p.id === knockerId)!;
    state.lastActionLog.push(`${k.name} knocked and is the sole lowest: loses 2 lives.`);
    loseLives(k, 2);
  } else if (includesKnocker) {
    for (const pid of lowest) {
      if (pid === knockerId) continue;
      const lp = state.players.find(p => p.id === pid)!;
      state.lastActionLog.push(`${lp.name} ties lowest with knocker: loses 1 life.`);
      loseLives(lp, 1);
    }
  } else {
    for (const pid of lowest) {
      const lp = state.players.find(p => p.id === pid)!;
      state.lastActionLog.push(`${lp.name} is lowest: loses 1 life.`);
      loseLives(lp, 1);
    }
  }

  finishElimsAndMaybeGameOver(state);
  state.phase = state.winnerId ? "GAME_OVER" : "HAND_OVER";
}

export function makeClientView(state: GameState, viewerId: string | null): ClientView {
  const turnPlayer = state.players[state.turnIndex];
  const you = viewerId ? state.players.find(p => p.id === viewerId) : null;

  const revealAll = state.phase === "SHOWDOWN" || state.phase === "HAND_OVER" || state.phase === "GAME_OVER";

  const youAny = you ? (you as any) : null;
  const mustDiscard = !!(youAny && youAny.turnStage === "DREW");

  return {
    roomId: state.roomId,
    rules: state.rules,
    players: state.players.map(p => {
      const revealThis = revealAll || (viewerId && p.id === viewerId);
      return {
        id: p.id,
        name: p.name,
        type: p.type,
        lives: p.lives,
        eliminated: p.eliminated,
        handCount: p.hand.length,
        revealedHand: revealThis ? p.hand : undefined,
        revealedValue: revealAll ? handValue(p.hand, state.rules) : undefined
      };
    }),
    dealerIndex: state.dealerIndex,
    turnPlayerId: turnPlayer?.id ?? "",
    phase: state.phase,
    knockedBy: state.knockedBy,
    stockCount: state.stock.length,
    topDiscard: state.discard.length ? state.discard[state.discard.length - 1] : null,
    you: you
      ? {
          id: you.id,
          name: you.name,
          hand: you.hand,
          canAct: (state.phase === "PLAYING" || state.phase === "KNOCKED") && turnPlayer?.id === you.id,
          canKnock: canKnock(state, you.id),
          mustDiscard
        }
      : null,
    log: state.lastActionLog.slice(-12)
  };
}
