import {
  DailyStatRecord,
  HighlightRecord,
  ReadingSession,
  SettingsRecord,
  StoredBook,
  StoredPageContent,
  WordDictionaryEntry,
} from '../models/types';

const storageKeys = {
  books: 'books',
  readingSessions: 'readingSessions',
  pages: 'pages',
  highlights: 'highlights',
  dictionary: 'dictionary',
  dailyStats: 'dailyStats',
  settings: 'settings',
} as const;

const defaultSettings: SettingsRecord = {
  holdToleranceMs: 500,
};

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(value));
}

export function getBooks() {
  return readJson<StoredBook[]>(storageKeys.books, []);
}

export function saveBooks(books: StoredBook[]) {
  writeJson(storageKeys.books, books);
}

export function upsertBook(book: StoredBook) {
  const books = getBooks();
  const index = books.findIndex((item) => item.id === book.id);
  if (index >= 0) {
    books[index] = book;
  } else {
    books.push(book);
  }
  saveBooks(books);
}

export function getPages() {
  return readJson<StoredPageContent[]>(storageKeys.pages, []);
}

export function savePages(pages: StoredPageContent[]) {
  writeJson(storageKeys.pages, pages);
}

export function upsertBookPages(bookId: string, pages: StoredPageContent[]) {
  const existing = getPages().filter((page) => page.bookId !== bookId);
  savePages([...existing, ...pages]);
}

export function getPagesForBook(bookId: string) {
  return getPages()
    .filter((page) => page.bookId === bookId)
    .sort((a, b) => a.pageNumber - b.pageNumber);
}

export function getReadingSessions() {
  return readJson<ReadingSession[]>(storageKeys.readingSessions, []);
}

export function saveReadingSessions(sessions: ReadingSession[]) {
  writeJson(storageKeys.readingSessions, sessions);
}

export function addReadingSession(session: ReadingSession) {
  const sessions = getReadingSessions();
  sessions.push(session);
  saveReadingSessions(sessions);
}

export function getHighlights() {
  return readJson<HighlightRecord[]>(storageKeys.highlights, []);
}

export function saveHighlights(highlights: HighlightRecord[]) {
  writeJson(storageKeys.highlights, highlights);
}

export function addHighlight(highlight: HighlightRecord) {
  const highlights = getHighlights();
  highlights.push(highlight);
  saveHighlights(highlights);
}

export function getDictionary() {
  return readJson<Record<string, WordDictionaryEntry>>(storageKeys.dictionary, {});
}

export function saveDictionary(dictionary: Record<string, WordDictionaryEntry>) {
  writeJson(storageKeys.dictionary, dictionary);
}

export function getDailyStats() {
  return readJson<Record<string, DailyStatRecord>>(storageKeys.dailyStats, {});
}

export function saveDailyStats(stats: Record<string, DailyStatRecord>) {
  writeJson(storageKeys.dailyStats, stats);
}

export function getSettings() {
  return readJson<SettingsRecord>(storageKeys.settings, defaultSettings);
}

export function saveSettings(settings: SettingsRecord) {
  writeJson(storageKeys.settings, settings);
}

export function getStoredBook(bookId: string) {
  return getBooks().find((book) => book.id === bookId);
}

export function getOrCreateBook(
  fallback: StoredBook,
): StoredBook {
  const existing = getStoredBook(fallback.id);
  if (existing) {
    return existing;
  }

  upsertBook(fallback);
  return fallback;
}

export function clearBookProgress(bookId: string) {
  const books = getBooks();
  const target = books.find((book) => book.id === bookId);
  if (!target) {
    return;
  }

  target.currentPageIndex = 0;
  target.progress = 0;
  target.lastReadAt = undefined;
  target.totalReadingTimeMs = 0;
  target.totalWordsRead = 0;
  target.totalCharsRead = 0;
  target.updatedAt = new Date().toISOString();
  saveBooks(books);
}

export function updateBookProgress(
  bookId: string,
  updates: Partial<Pick<StoredBook, 'currentPageIndex' | 'progress' | 'lastReadAt' | 'totalReadingTimeMs' | 'totalWordsRead' | 'totalCharsRead' | 'cover' | 'title' | 'author' | 'totalPages'>>,
) {
  const books = getBooks();
  const index = books.findIndex((book) => book.id === bookId);
  if (index < 0) {
    return;
  }

  books[index] = {
    ...books[index],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  saveBooks(books);
}

export function ensureBookRecord(book: StoredBook) {
  const existing = getStoredBook(book.id);
  if (existing) {
    return existing;
  }

  upsertBook(book);
  return book;
}

export function getLocalStorageSnapshot() {
  return {
    books: getBooks(),
    pages: getPages(),
    readingSessions: getReadingSessions(),
    highlights: getHighlights(),
    dictionary: getDictionary(),
    dailyStats: getDailyStats(),
    settings: getSettings(),
  };
}
