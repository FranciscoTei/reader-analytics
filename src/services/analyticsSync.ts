import { getDailyStats, getDictionary, getHighlights, getPages, getReadingSessions, saveDailyStats, saveDictionary } from './storage';
import { rebuildDerivedData } from '../utils/analytics';

export function refreshDerivedStores() {
  const sessions = getReadingSessions();
  const highlights = getHighlights();
  const pages = getPages();
  const result = rebuildDerivedData({ sessions, highlights, pages });
  saveDictionary(result.dictionary);
  saveDailyStats(result.dailyStats);
}
