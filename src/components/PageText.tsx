import type { ReactNode } from 'react';
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

export function PageText({ page, highlights, onWordPress, blurred }: PageTextProps) {
  const highlightedTokens = new Set(
    highlights
      .filter((highlight) => highlight.pageId === page.id)
      .map((highlight) => `${highlight.sentenceIndex}:${highlight.wordIndex}`),
  );

  return (
    <article className={`reader-page-text ${blurred ? 'is-blurred' : ''}`} lang="pt-BR">
      {page.sentences.map((sentence, sentenceIndex) => {
        const words = tokenizeWords(sentence);
        let globalIndex = 0;
        const parts: ReactNode[] = [];

        sentence.split(/(\s+)/).forEach((chunk, chunkIndex) => {
          if (!chunk.trim()) {
            parts.push(
              <span key={`${sentenceIndex}-${chunkIndex}-space`} className="word-space">
                {chunk}
              </span>,
            );
            return;
          }

          const word = words[globalIndex] ?? chunk;
          const wordIndex = globalIndex;
          const key = `${sentenceIndex}:${wordIndex}`;
          const highlighted = highlightedTokens.has(key);
          parts.push(
            <button
              key={`${sentenceIndex}-${wordIndex}`}
              type="button"
              className={`word-token ${highlighted ? 'is-highlighted' : ''}`}
              onPointerDown={(event) => {
                event.preventDefault();
                onWordPress({
                  word,
                  sentence,
                  sentenceIndex,
                  wordIndex,
                });
              }}
            >
              {chunk}
            </button>,
          );
          globalIndex += 1;
        });

        return (
          <p key={`${page.id}-${sentenceIndex}`} className="reader-paragraph">
            {parts}
          </p>
        );
      })}
    </article>
  );
}
