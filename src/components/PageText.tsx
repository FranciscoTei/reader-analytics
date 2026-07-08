import { useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { HighlightRecord, StoredPageContent } from '../models/types';
import { tokenizeWords } from '../utils/text';

interface PageTextProps {
  page: StoredPageContent;
  highlights: HighlightRecord[];
  onWordPress: (payload: {
    word: string;
    sentence: string;
    sentenceIndex: number;
    wordIndex: number;
  }) => void;
  blurred: boolean;
}

interface WordTokenProps {
  chunk: string;
  word: string;
  sentence: string;
  sentenceIndex: number;
  wordIndex: number;
  highlighted: boolean;
  onWordPress: PageTextProps['onWordPress'];
}

function WordToken({ chunk, word, sentence, sentenceIndex, wordIndex, highlighted, onWordPress }: WordTokenProps) {
  const startRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [pressed, setPressed] = useState(false);

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    startRef.current = { x: event.clientX, y: event.clientY, moved: false };
    setPressed(true);
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const start = startRef.current;
    if (!start) {
      return;
    }

    const deltaX = Math.abs(event.clientX - start.x);
    const deltaY = Math.abs(event.clientY - start.y);
    if (deltaX > 8 || deltaY > 8) {
      start.moved = true;
      setPressed(false);
    }
  }

  function finishPointer() {
    const start = startRef.current;
    startRef.current = null;

    if (!start || start.moved) {
      setPressed(false);
      return;
    }

    setPressed(false);
    onWordPress({
      word,
      sentence,
      sentenceIndex,
      wordIndex,
    });
  }

  function cancelPointer() {
    startRef.current = null;
    setPressed(false);
  }

  return (
    <button
      type="button"
      className={`word-token ${highlighted ? 'is-highlighted' : ''} ${pressed ? 'is-pressed' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={cancelPointer}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span className="word-token-label">{chunk}</span>
    </button>
  );
}

export function PageText({ page, highlights, onWordPress, blurred }: PageTextProps) {
  const highlightedTokens = new Set(
    highlights
      .filter((highlight) => highlight.pageId === page.id)
      .map((highlight) => `${highlight.sentenceIndex}:${highlight.wordIndex}`),
  );

  return (
    <article className={`reader-page-text ${blurred ? 'is-blurred' : ''}`} lang="pt-BR">
      {page.sentences.map((paragraph, sentenceIndex) => {
        const words = tokenizeWords(paragraph);
        let globalWordIndex = 0;

        return (
          <p key={`${page.id}-${sentenceIndex}`} className="reader-paragraph">
            {paragraph.split(/(\s+)/).map((chunk, chunkIndex) => {
              if (!chunk.trim()) {
                return <span key={`${page.id}-${sentenceIndex}-${chunkIndex}`}>{chunk}</span>;
              }

              const word = words[globalWordIndex] ?? chunk;
              const wordIndex = globalWordIndex;
              globalWordIndex += 1;
              const highlighted = highlightedTokens.has(`${sentenceIndex}:${wordIndex}`);

              return (
                <WordToken
                  key={`${page.id}-${sentenceIndex}-${chunkIndex}`}
                  chunk={chunk}
                  word={word}
                  sentence={paragraph}
                  sentenceIndex={sentenceIndex}
                  wordIndex={wordIndex}
                  highlighted={highlighted}
                  onWordPress={onWordPress}
                />
              );
            })}
          </p>
        );
      })}
    </article>
  );
}
