# Guess the Number / PIN / Temperature

A polished, real-time multiplayer browser game built with vanilla JavaScript and Supabase Realtime. No frameworks, no build step — just three files served statically.

---

## Game Modes

### Classic (0 – 100)
Guess a hidden integer between 0 and 100. After each attempt the range narrows visually — a left bound and a right bound close in around your current guess, giving you a clear picture of where the number lies. The fewer guesses you need, the higher your score.

### PIN Code (4 digits)
Crack a secret 4-digit PIN chosen by your opponent. Correctly placed digits lock green and are no longer part of the input — you only type the remaining unknown positions. Progress is permanent: once a digit is confirmed it can never be wrong.

### Hot & Cold (0 – 100, blind)
Guess a hidden integer between 0 and 100 with no directional hints. After each attempt you receive only a temperature reading that tells you how close you are — nothing more. A history panel on the left side of the screen tracks every guess and its temperature, letting you build a mental map of the search space over time.

| Distance | Temperature |
|---|---|
| ≤ 3 | Burning! |
| ≤ 8 | Hot |
| ≤ 15 | Warm |
| ≤ 25 | Lukewarm |
| ≤ 40 | Cold |
| > 40 | Freezing! |

---

## Scoring

```
Score = base_score + time_bonus

base_score  = max(0, round(1000 × (1 − log(attempts) / log(20))))
time_bonus  = max(0, round(100 × (1 − min(elapsed_seconds, 90) / 90)))
```

Maximum score per round is **1100** (theoretical perfect run) with a practical ceiling of **1000** for most play. Logarithmic scaling rewards early correct guesses disproportionately — a one-attempt win is worth far more than a two-attempt win.

---

## Multiplayer

Two players connect via a **6-digit room code**. The host generates the code and shares it; the guest types it in. No accounts, no lobbies.

**Flow:**
1. Both players independently pick a secret value (Classic / Hot & Cold: number 0–100, PIN: 4-digit string) during a 30-second countdown. If time runs out, a random value is locked automatically and the player is notified.
2. Secrets are exchanged over an encrypted Supabase Realtime channel — each player guesses the other's secret.
3. Turns alternate: after your guess the input locks and your opponent takes their turn. You can watch their progress live on the opponent card.
4. A round ends when both players have found the correct value. Scores are compared and the next round begins automatically.
5. After all rounds, a head-to-head scoreboard shows totals and a per-round breakdown.

**Supported configurations:** 1, 3, or 5 rounds.

---

## Features

| Feature | Detail |
|---|---|
| Real-time networking | Supabase Realtime broadcast channels — no WebRTC, no STUN/TURN |
| Turn indicator | Rainbow ring pulse on your card when it's your turn (white glow in dark mode, animated colour ring in light mode) |
| Live opponent card | Opponent's guess history, current value, and range update instantly |
| Hot & Cold history panel | Dedicated side card listing every guess with its temperature, colour-coded by proximity |
| Heat flash | Background colour reacts to how close Classic and Hot & Cold guesses are |
| Procedural audio | All sound effects generated via Web Audio API — no audio files |
| Particle burst | Confetti explosion on correct answer |
| PIN digit lock animation | Newly confirmed digits flash and scale before settling green |
| Per-round scoreboard | Full round-by-round breakdown in the result screen for multi-round matches |
| Timeout handling | 30-second lock-in timer; auto-randomises if you don't pick — with a visible notification |
| Graceful disconnect | Inline error with "Try again" instead of browser alerts for failed joins |
| Custom modals | All confirm / alert dialogs use a custom in-app modal — no native browser popups |
| Dark / Light theme | System-agnostic toggle, preference saved to `localStorage` |
| Responsive layout | Single card on mobile (opponent/history card as overlay); side-by-side cards on desktop |
| Version badge | Current version shown in the bottom-right corner of the page; auto-updated on every `git commit` via a pre-commit hook |
| No dependencies | Zero npm, zero bundler — a CDN script tag for Supabase is the only external resource |

---

## Tech Stack

- **HTML / CSS / JavaScript** — vanilla, no framework
- **Supabase Realtime** — WebSocket broadcast channels for game state synchronisation
- **Web Audio API** — procedural SFX (tick, type, delete, submit, high, low, win, whoosh, turn, click)
- **CSS custom properties + `@property`** — animated conic-gradient ring on the Challenge button and turn-indicator glow
- **`localStorage`** — theme preference persistence
- **Git pre-commit hook** — auto-stamps `VERSION` constant in `script.js` with date + short commit hash

---

## Project Structure

```
.
├── index.html   — markup, screen definitions, Supabase CDN import
├── style.css    — all styling and keyframe animations
└── script.js    — entire game logic, networking, audio, state
```

The JavaScript is wrapped in an IIFE that exposes a minimal `window.Game` API consumed by inline `onclick` handlers in the HTML.

---

## Running Locally

Any static file server works. With Node.js:

```bash
npx serve .
```

Or with Python:

```bash
python3 -m http.server 8090
```

Then open `http://localhost:8090`.

> **Note:** Opening `index.html` directly as a `file://` URL will not work — Supabase Realtime requires an HTTP context.

---

## Multiplayer Architecture

```
Host browser                        Guest browser
     │                                    │
     ├─ subscribe(room-XXXXXX) ──────────►│
     │                                    ├─ subscribe(room-XXXXXX)
     │                                    ├─ broadcast: GUEST_JOINED
     ├─ broadcast: INIT (name, rounds, gameType)
     │                                    ├─ broadcast: INIT_ACK (name)
     │                    [choose phase]
     ├─ broadcast: READY (secret) ───────►│
     │◄─────────────────── broadcast: READY (secret)
     ├─ broadcast: START (guestTarget) ──►│   ← host drives round start
     │                    [game phase]
     ├─ broadcast: GUESS ────────────────►│
     │◄───────────────────── broadcast: GUESS
     ├─ broadcast: FINISH ───────────────►│
     │◄──────────────────── broadcast: FINISH
     │                    [result screen]
     ├─ broadcast: REMATCH / QUIT ───────►│
```

All messages travel over a single Supabase Realtime channel named `room-{CODE}`. The **host drives round start** — once both players have locked in their secrets, the host sends a `START` message containing the guest's target. This prevents the race condition that would occur if both sides tried to launch the round independently. Presence tracking detects disconnection and notifies the remaining player.
