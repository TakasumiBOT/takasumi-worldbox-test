export type Suit = "spade" | "heart" | "diamond" | "club";

export type Card = {
  suit: Suit;
  rank: number;
};

export type BjPhase = "betting" | "player" | "settled";

export type BjOutcome = "blackjack" | "dealer_blackjack" | "win" | "lose" | "push" | "bust";

export type BjResult = {
  outcome: BjOutcome;
  delta: number;
  message: string;
};

export type BjState = {
  chips: number;
  bet: number;
  doubled: boolean;
  deck: Card[];
  playerHand: Card[];
  dealerHand: Card[];
  phase: BjPhase;
  result: BjResult | null;
  rng: number;
  round: number;
};

export const BJ_INITIAL_CHIPS = 1000;
export const BJ_MIN_BET = 10;

const SUITS: Suit[] = ["spade", "heart", "diamond", "club"];

function nextRandom(rng: number): { value: number; rng: number } {
  let t = (rng + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, rng: t | 0 };
}

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 13; rank++) deck.push({ suit, rank });
  }
  return deck;
}

function shuffle(deck: Card[], rng: number): { deck: Card[]; rng: number } {
  const out = [...deck];
  let r = rng;
  for (let i = out.length - 1; i > 0; i--) {
    const n = nextRandom(r);
    r = n.rng;
    const j = Math.floor(n.value * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return { deck: out, rng: r };
}

export function createBlackjackGame(seed: number, chips: number = BJ_INITIAL_CHIPS): BjState {
  const { deck, rng } = shuffle(createDeck(), seed | 0);
  return {
    chips: Math.max(0, Math.floor(chips)),
    bet: 0,
    doubled: false,
    deck,
    playerHand: [],
    dealerHand: [],
    phase: "betting",
    result: null,
    rng,
    round: 0,
  };
}

export function handValue(hand: Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    if (card.rank === 1) {
      aces++;
      total += 11;
    } else {
      total += Math.min(card.rank, 10);
    }
  }
  let softAces = aces;
  while (total > 21 && softAces > 0) {
    total -= 10;
    softAces--;
  }
  return { total, soft: softAces > 0 };
}

export function isBlackjack(hand: Card[]): boolean {
  return hand.length === 2 && handValue(hand).total === 21;
}

function settle(state: BjState, outcome: BjOutcome, message: string): BjState {
  const bet = state.bet;
  let returned = 0;
  if (outcome === "blackjack") returned = bet + Math.floor((bet * 3) / 2);
  else if (outcome === "win") returned = bet * 2;
  else if (outcome === "push") returned = bet;
  return {
    ...state,
    chips: state.chips + returned,
    phase: "settled",
    result: { outcome, delta: returned - bet, message },
  };
}

function dealerPlayAndSettle(state: BjState): BjState {
  let deck = state.deck;
  let dealerHand = state.dealerHand;
  while (handValue(dealerHand).total < 17 && deck.length > 0) {
    dealerHand = [...dealerHand, deck[0]];
    deck = deck.slice(1);
  }
  const s: BjState = { ...state, deck, dealerHand };
  const player = handValue(s.playerHand).total;
  const dealer = handValue(dealerHand).total;
  if (dealer > 21) return settle(s, "win", `ディーラーが ${dealer} でバースト。あなたの勝ちです。`);
  if (player > dealer) return settle(s, "win", `${player} 対 ${dealer}。あなたの勝ちです。`);
  if (player < dealer) return settle(s, "lose", `${player} 対 ${dealer}。ディーラーの勝ちです。`);
  return settle(s, "push", `${player} 対 ${dealer}。引き分け（プッシュ）で賭け金が戻ります。`);
}

export function startRound(state: BjState, bet: number): BjState {
  if (state.phase === "player") return state;
  const amount = Math.floor(bet);
  if (!Number.isFinite(amount) || amount < BJ_MIN_BET) return state;
  if (amount > state.chips) return state;
  let deck = state.deck;
  let rng = state.rng;
  if (deck.length < 15) {
    const shuffled = shuffle(createDeck(), rng);
    deck = shuffled.deck;
    rng = shuffled.rng;
  }
  const playerHand = [deck[0], deck[2]];
  const dealerHand = [deck[1], deck[3]];
  const s: BjState = {
    ...state,
    chips: state.chips - amount,
    bet: amount,
    doubled: false,
    deck: deck.slice(4),
    playerHand,
    dealerHand,
    phase: "player",
    result: null,
    rng,
    round: state.round + 1,
  };
  const playerBj = isBlackjack(playerHand);
  const dealerBj = isBlackjack(dealerHand);
  if (playerBj && dealerBj)
    return settle(s, "push", "両方ブラックジャック。引き分けで賭け金が戻ります。");
  if (playerBj) return settle(s, "blackjack", "ブラックジャック！ 配当 3:2 です。");
  if (dealerBj)
    return settle(s, "dealer_blackjack", "ディーラーのブラックジャック。あなたの負けです。");
  return s;
}

export function hit(state: BjState): BjState {
  if (state.phase !== "player" || state.deck.length === 0) return state;
  const playerHand = [...state.playerHand, state.deck[0]];
  const s: BjState = { ...state, deck: state.deck.slice(1), playerHand };
  const total = handValue(playerHand).total;
  if (total > 21) return settle(s, "bust", `${total} でバースト。あなたの負けです。`);
  if (total === 21) return dealerPlayAndSettle(s);
  return s;
}

export function stand(state: BjState): BjState {
  if (state.phase !== "player") return state;
  return dealerPlayAndSettle(state);
}

export function doubleDown(state: BjState): BjState {
  if (state.phase !== "player") return state;
  if (state.doubled || state.playerHand.length !== 2) return state;
  if (state.chips < state.bet || state.deck.length === 0) return state;
  const playerHand = [...state.playerHand, state.deck[0]];
  const s: BjState = {
    ...state,
    chips: state.chips - state.bet,
    bet: state.bet * 2,
    doubled: true,
    deck: state.deck.slice(1),
    playerHand,
  };
  const total = handValue(playerHand).total;
  if (total > 21) return settle(s, "bust", `ダブルダウンで ${total}。バーストして負けです。`);
  return dealerPlayAndSettle(s);
}

export function canDouble(state: BjState): boolean {
  return (
    state.phase === "player" &&
    !state.doubled &&
    state.playerHand.length === 2 &&
    state.chips >= state.bet
  );
}

export function nextRound(state: BjState): BjState {
  const chips = state.chips < BJ_MIN_BET ? BJ_INITIAL_CHIPS : state.chips;
  return {
    ...state,
    chips,
    bet: 0,
    doubled: false,
    playerHand: [],
    dealerHand: [],
    phase: "betting",
    result: null,
  };
}

export function refillChips(state: BjState): BjState {
  if (state.phase === "player" || state.chips >= BJ_MIN_BET) return state;
  return { ...state, chips: BJ_INITIAL_CHIPS };
}
