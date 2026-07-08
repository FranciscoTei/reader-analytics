export interface SentenceChunk {
  sentence: string;
  words: string[];
}

const wordMatcher = /[\p{L}\p{M}\p{N}’'-]+/gu;

export function normalizeText(text: string) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+/g, ' ')
    .trim();
}

export function countWords(text: string) {
  return tokenizeWords(text).length;
}

export function countCharacters(text: string) {
  return text.replace(/\s+/g, '').length;
}

export function tokenizeWords(text: string) {
  return text.match(wordMatcher) ?? [];
}

export function splitIntoSentences(text: string) {
  const cleanText = normalizeText(text);
  if (!cleanText) {
    return [];
  }

  const SegmenterCtor = (Intl as typeof Intl & {
    Segmenter?: new (
      locale: string,
      options: { granularity: 'sentence' },
    ) => {
      segment(input: string): Iterable<{ segment: string }>;
    };
  }).Segmenter;

  if (SegmenterCtor) {
    const segmenter = new SegmenterCtor('pt-BR', { granularity: 'sentence' });
    return Array.from(segmenter.segment(cleanText))
      .map((segment: { segment: string }) => segment.segment.trim())
      .filter(Boolean);
  }

  return cleanText
    .split(/(?<=[.!?…])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function splitIntoSentenceChunks(text: string) {
  return splitIntoSentences(text).map((sentence) => ({
    sentence,
    words: tokenizeWords(sentence),
  }));
}

export function normalizeWord(word: string) {
  return word
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function extractFirstHeading(document: Document | null | undefined) {
  const heading =
    document?.querySelector('h1, h2, h3, h4, h5, h6')?.textContent?.trim() ||
    document?.title?.trim() ||
    '';
  return heading;
}

export function createPageText(sentences: string[]) {
  return sentences.join(' ').replace(/\s+/g, ' ').trim();
}
