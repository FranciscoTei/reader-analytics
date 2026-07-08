import {
  getBooks,
  getDailyStats,
  getDictionary,
  getHighlights,
  getReadingSessions,
  savePageReadingStats,
  saveBooks,
  saveDailyStats,
  saveDictionary,
} from './storage';
import { rebuildDerivedData, reconcileBookTotalsFromSessions } from '../utils/analytics';

export function refreshDerivedStores() {
  const books = getBooks();
  const sessions = getReadingSessions();
  const highlights = getHighlights();
  const result = rebuildDerivedData({ sessions, highlights });
  saveDictionary(result.dictionary);
  saveDailyStats(result.dailyStats);
  savePageReadingStats(result.pageReadingStats);
  saveBooks(reconcileBookTotalsFromSessions(books, sessions));
}
