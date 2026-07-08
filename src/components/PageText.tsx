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

  const dialogueStart = /^["'“”‘’\-–—]/;

  return (
    <article className={`reader-page-text ${blurred ? 'is-blurred' : ''}`} lang="pt-BR">
      {page.sentences.map((paragraph, sentenceIndex) => {
        const lines = paragraph.split(/\n+/).filter(Boolean);

        return (
          <p key={`${page.id}-${sentenceIndex}`} className="reader-paragraph">
            {lines.flatMap((line, lineIndex) => {
              const words = tokenizeWords(line);
              let globalIndex = 0;
              const parts: ReactNode[] = [];

              if (lineIndex > 0 || (sentenceIndex > 0 && dialogueStart.test(line.trim()))) {
                parts.push(<br key={`${page.id}-${sentenceIndex}-${lineIndex}-break`} />);
              }

              line.split(/(\s+)/).forEach((chunk, chunkIndex) => {
                if (!chunk.trim()) {
                  parts.push(
                    <span key={`${sentenceIndex}-${lineIndex}-${chunkIndex}-space`} className="word-space">
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
                    key={`${sentenceIndex}-${lineIndex}-${wordIndex}`}
                    type="button"
                    className={`word-token ${highlighted ? 'is-highlighted' : ''}`}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      onWordPress({
                        word,
                        sentence: paragraph,
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

              if (lineIndex < lines.length - 1) {
                parts.push(<span key={`${sentenceIndex}-${lineIndex}-separator`} className="word-space"> </span>);
              }

              return parts;
            })}
          </p>
        );
      })}
    </article>
  );
}
