"use client";

import Link from "next/link";
import { useState } from "react";
import type { PracticeDifficulty } from "@/lib/battle-protocol";
import {
  DEFAULT_PRACTICE_DIFFICULTY,
  PRACTICE_DIFFICULTY_OPTIONS,
  practiceDifficultyOption,
} from "./practice-difficulty-model";

/** Idle presentation only. The existing battle session owns every action. */
export default function BattleEntry({ mode, code, error, setupReady = true, onStartPractice, practiceDifficulty = "medium", onCodeChange, onFind, onCreate, onJoin }: {
  mode: "private" | "unranked" | "ranked" | "practice";
  code: string;
  error: string | null;
  setupReady?: boolean;
  /** Practice is a separate server room, so its action has its own callback. */
  onStartPractice?: (difficulty: PracticeDifficulty) => void;
  /** Initial server-selected difficulty. New Practice entries default to Medium. */
  practiceDifficulty?: PracticeDifficulty;
  onCodeChange: (code: string) => void;
  onFind: () => void;
  onCreate: () => void;
  onJoin: () => void;
}) {
  const [selectedDifficulty, setSelectedDifficulty] = useState<PracticeDifficulty>(practiceDifficulty ?? DEFAULT_PRACTICE_DIFFICULTY);
  const selectedOption = practiceDifficultyOption(selectedDifficulty);
  const startPractice = () => {
    if (onStartPractice) onStartPractice(selectedDifficulty);
    else onFind();
  };
  return (
    <section className="app-play-battle-entry app-panel" aria-labelledby="battle-entry-title">
      <header className="app-play-battle-head">
        <div>
          <p className="app-play-kicker">Battle hall</p>
          <h1 id="battle-entry-title">{mode === "private" ? "Private room" : mode === "ranked" ? "Ranked queue" : mode === "practice" ? "Practice battle" : "Unranked battle"}</h1>
        </div>
        <Link className="app-btn app-btn--ghost" href="/app/play">Change mode</Link>
      </header>
      <p className="app-play-entry-lead">{mode === "private" ? "Create a room and share its code with a friend, or join theirs." : mode === "ranked" ? "Ranked matchmaking is currently closed." : mode === "practice" ? "Play a real battle against a server-driven AI opponent. Practice has no rewards yet." : "Find an opponent, ready your deck, and enter the arena."}</p>
      <div className="app-play-entry-actions">
        {mode === "private" ? (
          <>
            <button type="button" className="app-btn app-btn--battle" onClick={onCreate} disabled={!setupReady}>Create Private Room</button>
            <form className="app-play-join" onSubmit={(event) => { event.preventDefault(); if (setupReady && code.trim()) onJoin(); }}>
              <label className="app-play-code" htmlFor="battle-room-code">
                <span>Have a room code?</span>
                <input id="battle-room-code" placeholder="Room code" value={code} onChange={(event) => onCodeChange(event.target.value)} autoComplete="off" spellCheck={false} />
              </label>
              <button type="submit" className="app-btn app-btn--ghost" disabled={!setupReady || !code.trim()}>Join with Code</button>
            </form>
          </>
        ) : mode === "practice" ? (
          <div className="app-play-practice-entry">
            <p className="app-play-battle-state" role="status"><strong>AI Opponent</strong><span>{selectedOption.label} difficulty · no rewards, Gold, XP, or trophies</span></p>
            <fieldset className="app-play-difficulty" aria-describedby="practice-difficulty-note">
              <legend>Choose AI difficulty</legend>
              <div className="app-play-difficulty__options">
                {PRACTICE_DIFFICULTY_OPTIONS.map((option) => (
                  <label className="app-play-difficulty__choice" key={option.value} data-difficulty={option.value} data-selected={selectedDifficulty === option.value}>
                    <input
                      className="app-play-difficulty__input"
                      type="radio"
                      name="practice-difficulty"
                      value={option.value}
                      checked={selectedDifficulty === option.value}
                      onChange={() => setSelectedDifficulty(option.value)}
                    />
                    <span className="app-play-difficulty__card">
                      <span className="app-play-difficulty__label">{option.label}</span>
                      <span className="app-play-difficulty__tagline">{option.tagline}</span>
                      <span className="app-play-difficulty__description">{option.description}</span>
                      {selectedDifficulty === option.value && <span className="app-play-difficulty__selected">Selected</span>}
                    </span>
                  </label>
                ))}
              </div>
              <p id="practice-difficulty-note" className="app-play-difficulty__note">Same cards and rules at every difficulty. Practice has no rewards yet.</p>
            </fieldset>
            <button type="button" className="app-btn app-btn--battle" onClick={startPractice} disabled={!setupReady}>Start Practice</button>
          </div>
        ) : mode === "unranked" ? (
          <button type="button" className="app-btn app-btn--battle" onClick={onFind} disabled={!setupReady}>Find Opponent</button>
        ) : <p className="app-play-battle-state">Ranked queue is unavailable in this build.</p>}
      </div>
      {!setupReady && <p className="app-play-battle-state" role="status">Checking your player setup before opening a room.</p>}
      {error && <p className="app-play-battle-error" role="alert">{error}</p>}
    </section>
  );
}
