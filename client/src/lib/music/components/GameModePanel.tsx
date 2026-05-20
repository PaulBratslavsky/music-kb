import type { GameModeState, Instrument } from '../types';

type Props = {
  instrument: Instrument;
  game: GameModeState;
  onToggle: () => void;
  onCheck: () => void;
  onReset: () => void;
};

const LABELS: Record<Instrument, string> = {
  piano: 'Piano',
  guitar: 'Guitar',
  push: 'Push',
};

export function GameModePanel({ instrument, game, onToggle, onCheck, onReset }: Props) {
  const pendingCount = game.pendingGuesses.length;
  const showingResults = game.checkedResults != null;
  const allCorrect =
    showingResults &&
    game.checkedResults!.length > 0 &&
    game.checkedResults!.every((r) => r.correct);
  const correctCount = showingResults
    ? game.checkedResults!.filter((r) => r.correct).length
    : 0;

  return (
    <div className="game-mode-panel">
      <button
        type="button"
        className={`chip game-mode-toggle${game.enabled ? ' active' : ''}`}
        onClick={onToggle}
        title={game.enabled ? `Stop ${LABELS[instrument]} game` : `Start ${LABELS[instrument]} game`}
      >
        {game.enabled ? '■ Stop game' : '🎯 Game mode'}
      </button>

      {game.enabled && (
        <>
          <span className="game-mode-prompt">
            Find <strong>{game.currentQuestionDisplay ?? game.currentQuestion}</strong>
          </span>
          <span className="game-mode-streak">
            Streak <strong>{game.currentStreak}</strong> · Best <strong>{game.bestStreak}</strong>
          </span>
          {pendingCount > 0 && (
            <span className="game-mode-pending-count">{pendingCount} pending</span>
          )}
          <button
            type="button"
            className="chip game-check"
            onClick={onCheck}
            disabled={pendingCount === 0}
          >
            Check
          </button>
          <button
            type="button"
            className="chip"
            onClick={onReset}
            disabled={pendingCount === 0 && !showingResults}
            title="Clear pending guesses (does not affect streak)"
          >
            Clear
          </button>
          {showingResults && (
            <span
              className="game-mode-result"
              data-allcorrect={allCorrect ? 'true' : 'false'}
            >
              {allCorrect
                ? `✓ All ${game.checkedResults!.length} correct`
                : `${correctCount}/${game.checkedResults!.length} correct — streak reset`}
            </span>
          )}
        </>
      )}
    </div>
  );
}
