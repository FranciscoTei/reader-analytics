export interface CatalogBook {
  id: string;
  file: string;
}

export interface StoredPageContent {
  id: string;
  bookId: string;
  pageNumber: number;
  positionInEpub: number;
  chapterIndex: number;
  chapterTitle: string;
  text: string;
  sentences: string[];
  wordCount: number;
  charCount: number;
}

export interface StoredBook {
  id: string;
  file: string;
  title: string;
  author: string;
  cover?: string;
  publicationYear?: string;
  paginationVersion?: number;
  totalPages: number;
  currentPageIndex: number;
  progress: number;
  lastReadAt?: string;
  totalReadingTimeMs: number;
  totalWordsRead: number;
  totalCharsRead: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReadingSession {
  id: string;
  bookId: string;
  bookTitle: string;
  pageId: string;
  pageNumber: number;
  chapterTitle: string;
  wordCount: number;
  charCount: number;
  durationMs: number;
  pauses: number;
  highlightsCount: number;
  startedAt: string;
  endedAt: string;
  localDate: string;
  localTime: string;
}

export interface PageReadingStat {
  id: string;
  bookId: string;
  bookTitle: string;
  pageId: string;
  pageNumber: number;
  chapterTitle: string;
  totalReadingTimeMs: number;
  totalWords: number;
  totalChars: number;
  sessionCount: number;
  longestSessionMs: number;
  firstReadAt: string;
  lastReadAt: string;
}

export interface HighlightRecord {
  id: string;
  bookId: string;
  bookTitle: string;
  pageId: string;
  pageNumber: number;
  chapterTitle: string;
  sentence: string;
  word: string;
  normalizedWord: string;
  sentenceIndex: number;
  wordIndex: number;
  localDate: string;
  localTime: string;
  createdAt: string;
}

export interface WordDictionaryEntry {
  word: string;
  normalizedWord: string;
  occurrences: number;
  highlights: number;
  lastOccurrenceAt: string;
  lastBookId: string;
  lastBookTitle: string;
  lastChapterTitle: string;
  sentences: string[];
}

export interface DailyStatRecord {
  date: string;
  readingTimeMs: number;
  pages: number;
  words: number;
  chars: number;
  highlights: number;
}

export interface SettingsRecord {
  holdToleranceMs: number;
}

export interface BookChapter {
  title: string;
  text: string;
  index: number;
}

export interface BookExtractionResult {
  book: StoredBook;
  pages: StoredPageContent[];
}
