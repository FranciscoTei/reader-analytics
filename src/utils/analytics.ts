import {
  DailyStatRecord,
  HighlightRecord,
  PageReadingStat,
  ReadingSession,
  StoredBook,
  WordDictionaryEntry,
} from '../models/types';
import { formatDuration, getDayKey } from './date';
import { normalizeWord } from './text';

export interface DerivedMetrics {
  totalReadingTimeMs: number;
  totalPages: number;
  totalWords: number;
  totalChars: number;
  wordsPerMinute: number;
  charsPerMinute: number;
  avgTimePerPageMs: number;
  avgTimePerWordMs: number;
  avgTimePerCharMs: number;
  avgTimePerChapterMs: number;
  fastestBook?: StoredBook;
  mostReadBook?: StoredBook;
  longestStreakDays: number;
  consecutiveDays: number;
  averageMinutesPerDay: number;
  longestContinuousSessionMs: number;
  averagePauseIntervalMs: number;
}

export interface DashboardInsight {
  title: string;
  detail: string;
}

export const MIN_READING_SESSION_DURATION_MS = 20_000;
export const MIN_READING_SESSION_WORD_COUNT = 100;

export function isMeaningfulReadingSession(
  session: Pick<ReadingSession, 'durationMs' | 'wordCount'>,
) {
  return (
    session.durationMs >= MIN_READING_SESSION_DURATION_MS &&
    session.wordCount >= MIN_READING_SESSION_WORD_COUNT
  );
}

export function filterMeaningfulReadingSessions(sessions: ReadingSession[]) {
  return sessions.filter(isMeaningfulReadingSession);
}

function buildBookTotalsById(sessions: ReadingSession[]) {
  return filterMeaningfulReadingSessions(sessions).reduce<
    Record<string, { totalReadingTimeMs: number; totalWordsRead: number; totalCharsRead: number }>
  >((acc, session) => {
    acc[session.bookId] = acc[session.bookId] ?? {
      totalReadingTimeMs: 0,
      totalWordsRead: 0,
      totalCharsRead: 0,
    };

    acc[session.bookId].totalReadingTimeMs += session.durationMs;
    acc[session.bookId].totalWordsRead += session.wordCount;
    acc[session.bookId].totalCharsRead += session.charCount;
    return acc;
  }, {});
}

export function reconcileBookTotalsFromSessions(books: StoredBook[], sessions: ReadingSession[]) {
  const totalsByBook = buildBookTotalsById(sessions);

  return books.map((book) => {
    const totals = totalsByBook[book.id];
    return {
      ...book,
      totalReadingTimeMs: totals?.totalReadingTimeMs ?? 0,
      totalWordsRead: totals?.totalWordsRead ?? 0,
      totalCharsRead: totals?.totalCharsRead ?? 0,
    };
  });
}

function emptyDailyStat(date: string): DailyStatRecord {
  return {
    date,
    readingTimeMs: 0,
    pages: 0,
    words: 0,
    chars: 0,
    highlights: 0,
  };
}

export function aggregateDailyStats(
  sessions: ReadingSession[],
  highlights: HighlightRecord[],
) {
  const stats: Record<string, DailyStatRecord> = {};
  const meaningfulSessions = filterMeaningfulReadingSessions(sessions);

  for (const session of meaningfulSessions) {
    const day = session.localDate;
    stats[day] = stats[day] ?? emptyDailyStat(day);
    stats[day].readingTimeMs += session.durationMs;
    stats[day].pages += 1;
    stats[day].words += session.wordCount;
    stats[day].chars += session.charCount;
  }

  for (const highlight of highlights) {
    const day = highlight.localDate;
    stats[day] = stats[day] ?? emptyDailyStat(day);
    stats[day].highlights += 1;
  }

  return stats;
}

export function aggregatePageReadingStats(sessions: ReadingSession[]) {
  const stats: Record<string, PageReadingStat> = {};
  const meaningfulSessions = filterMeaningfulReadingSessions(sessions);

  for (const session of meaningfulSessions) {
    const current = stats[session.pageId] ?? {
      id: session.pageId,
      bookId: session.bookId,
      bookTitle: session.bookTitle,
      pageId: session.pageId,
      pageNumber: session.pageNumber,
      chapterTitle: session.chapterTitle,
      totalReadingTimeMs: 0,
      totalWords: 0,
      totalChars: 0,
      sessionCount: 0,
      longestSessionMs: 0,
      firstReadAt: session.startedAt,
      lastReadAt: session.endedAt,
    };

    current.totalReadingTimeMs += session.durationMs;
    current.totalWords += session.wordCount;
    current.totalChars += session.charCount;
    current.sessionCount += 1;
    current.longestSessionMs = Math.max(current.longestSessionMs, session.durationMs);
    current.firstReadAt = current.firstReadAt < session.startedAt ? current.firstReadAt : session.startedAt;
    current.lastReadAt = current.lastReadAt > session.endedAt ? current.lastReadAt : session.endedAt;
    stats[session.pageId] = current;
  }

  return stats;
}

export function buildDictionary(highlights: HighlightRecord[]) {
  const dictionary: Record<string, WordDictionaryEntry> = {};

  for (const highlight of highlights) {
    const key = normalizeWord(highlight.word);
    const current = dictionary[key] ?? {
      word: highlight.word,
      normalizedWord: key,
      occurrences: 0,
      highlights: 0,
      lastOccurrenceAt: highlight.createdAt,
      lastBookId: highlight.bookId,
      lastBookTitle: highlight.bookTitle,
      lastChapterTitle: highlight.chapterTitle,
      sentences: [],
    };

    current.occurrences += 1;
    current.highlights += 1;
    current.lastOccurrenceAt = highlight.createdAt;
    current.lastBookId = highlight.bookId;
    current.lastBookTitle = highlight.bookTitle;
    current.lastChapterTitle = highlight.chapterTitle;
    if (highlight.sentence && !current.sentences.includes(highlight.sentence)) {
      current.sentences.unshift(highlight.sentence);
    }
    dictionary[key] = current;
  }

  return dictionary;
}

export function rebuildDerivedData({
  sessions,
  highlights,
}: {
  sessions: ReadingSession[];
  highlights: HighlightRecord[];
}) {
  const dictionary = buildDictionary(highlights);
  const dailyStats = aggregateDailyStats(sessions, highlights);
  const pageReadingStats = aggregatePageReadingStats(sessions);

  return { dictionary, dailyStats, pageReadingStats };
}

export function computeDerivedMetrics({
  books,
  sessions,
}: {
  books: StoredBook[];
  sessions: ReadingSession[];
}) {
  const meaningfulSessions = filterMeaningfulReadingSessions(sessions);
  const totalsByBook = buildBookTotalsById(meaningfulSessions);
  const totalReadingTimeMs = meaningfulSessions.reduce((sum, session) => sum + session.durationMs, 0);
  const totalPages = meaningfulSessions.reduce((sum, session) => sum + 1, 0);
  const totalWords = meaningfulSessions.reduce((sum, session) => sum + session.wordCount, 0);
  const totalChars = meaningfulSessions.reduce((sum, session) => sum + session.charCount, 0);
  const totalChapters = new Set(meaningfulSessions.map((session) => `${session.bookId}:${session.chapterTitle}`)).size || 1;
  const totalMinutes = totalReadingTimeMs / 60000 || 1;

  const booksById = new Map(books.map((book) => [book.id, book]));
  const enrichedBooks = Object.entries(totalsByBook)
    .map(([bookId, totals]) => {
      const book = booksById.get(bookId);
      return book
        ? {
            ...book,
            totalReadingTimeMs: totals.totalReadingTimeMs,
            totalWordsRead: totals.totalWordsRead,
            totalCharsRead: totals.totalCharsRead,
          }
        : null;
    })
    .filter((book): book is StoredBook => book !== null);

  const mostReadBook = [...enrichedBooks].sort((a, b) => b.totalReadingTimeMs - a.totalReadingTimeMs)[0];
  const fastestBook = [...enrichedBooks].sort((a, b) => {
    const aRate = a.totalReadingTimeMs > 0 ? a.totalWordsRead / (a.totalReadingTimeMs / 60000) : 0;
    const bRate = b.totalReadingTimeMs > 0 ? b.totalWordsRead / (b.totalReadingTimeMs / 60000) : 0;
    return bRate - aRate;
  })[0];

  const dayKeys = Array.from(new Set(meaningfulSessions.map((session) => session.localDate))).sort();
  const longestStreakDays = dayKeys.reduce((best, day, index) => {
    if (index === 0) {
      return 1;
    }

    const previous = new Date(`${dayKeys[index - 1]}T12:00:00`);
    const current = new Date(`${day}T12:00:00`);
    const diffDays = Math.round((current.getTime() - previous.getTime()) / 86400000);
    return diffDays === 1 ? best + 1 : Math.max(best, 1);
  }, dayKeys.length ? 1 : 0);

  const totalDays = dayKeys.length || 1;
  const averageMinutesPerDay = (totalReadingTimeMs / 60000) / totalDays;
  const avgTimePerPageMs = totalPages > 0 ? totalReadingTimeMs / totalPages : 0;
  const avgTimePerWordMs = totalWords > 0 ? totalReadingTimeMs / totalWords : 0;
  const avgTimePerCharMs = totalChars > 0 ? totalReadingTimeMs / totalChars : 0;
  const avgTimePerChapterMs = totalChapters > 0 ? totalReadingTimeMs / totalChapters : 0;
  const longestContinuousSessionMs = sessions.reduce((max, session) => Math.max(max, session.durationMs), 0);
  const totalPauses = sessions.reduce((sum, session) => sum + session.pauses, 0);
  const averagePauseIntervalMs = totalPauses > 0 ? totalReadingTimeMs / totalPauses : 0;

  return {
    totalReadingTimeMs,
    totalPages,
    totalWords,
    totalChars,
    wordsPerMinute: totalMinutes > 0 ? totalWords / totalMinutes : 0,
    charsPerMinute: totalMinutes > 0 ? totalChars / totalMinutes : 0,
    avgTimePerPageMs,
    avgTimePerWordMs,
    avgTimePerCharMs,
    avgTimePerChapterMs,
    fastestBook,
    mostReadBook,
    longestStreakDays,
    consecutiveDays: longestStreakDays,
    averageMinutesPerDay,
    longestContinuousSessionMs,
    averagePauseIntervalMs,
  } satisfies DerivedMetrics;
}

function sumByDateRange(sessions: ReadingSession[], daysBack: number) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - daysBack + 1);
  start.setHours(0, 0, 0, 0);

  return sessions.filter((session) => {
    const sessionDate = new Date(`${session.localDate}T12:00:00`);
    return sessionDate >= start && sessionDate <= end;
  });
}

function getSpeedForSessions(sessions: ReadingSession[]) {
  const words = sessions.reduce((sum, session) => sum + session.wordCount, 0);
  const minutes = sessions.reduce((sum, session) => sum + session.durationMs, 0) / 60000;
  return minutes > 0 ? words / minutes : 0;
}

export function generateInsights({
  sessions,
  highlights,
  derived,
}: {
  sessions: ReadingSession[];
  highlights: HighlightRecord[];
  derived: DerivedMetrics;
}) {
  const insights: DashboardInsight[] = [];
  const meaningfulSessions = filterMeaningfulReadingSessions(sessions);

  const byHour = meaningfulSessions.reduce<Record<string, ReadingSession[]>>((acc, session) => {
    const hour = new Date(session.startedAt).getHours();
    const bucket = hour >= 5 && hour < 12 ? 'manhã' : hour >= 12 && hour < 18 ? 'tarde' : 'noite';
    acc[bucket] = acc[bucket] ?? [];
    acc[bucket].push(session);
    return acc;
  }, {});

  const bestBucket = Object.entries(byHour)
    .map(([bucket, bucketSessions]) => ({ bucket, minutes: bucketSessions.reduce((sum, session) => sum + session.durationMs, 0) / 60000 }))
    .sort((a, b) => b.minutes - a.minutes)[0];
  if (bestBucket) {
    insights.push({
      title: `Você lê mais na ${bestBucket.bucket}`,
      detail: `A ${bestBucket.bucket} concentrou ${Math.round(bestBucket.minutes)} minutos de leitura.`,
    });
  }

  const chapterTotals = meaningfulSessions.reduce<Record<string, { time: number; words: number; title: string }>>((acc, session) => {
    const key = `${session.bookId}:${session.chapterTitle}`;
    acc[key] = acc[key] ?? { time: 0, words: 0, title: session.chapterTitle };
    acc[key].time += session.durationMs;
    acc[key].words += session.wordCount;
    return acc;
  }, {});
  const mostReadChapter = Object.values(chapterTotals).sort((a, b) => b.time - a.time)[0];
  if (mostReadChapter) {
    insights.push({
      title: `Capítulo mais lido`,
      detail: `${mostReadChapter.title} recebeu ${formatDuration(mostReadChapter.time)} de atenção.`,
    });
  }

  const uniqueRecentWords = new Set(
    highlights
      .filter((highlight) => {
        const highlightDate = new Date(highlight.createdAt);
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        return highlightDate >= thirtyDaysAgo;
      })
      .map((highlight) => normalizeWord(highlight.word)),
  );
  insights.push({
    title: 'Palavras novas destacadas',
    detail: `Você marcou ${uniqueRecentWords.size} palavras diferentes nos últimos 30 dias.`,
  });

  const recent30 = sumByDateRange(meaningfulSessions, 30);
  const previous30 = meaningfulSessions.filter((session) => {
    const sessionDate = new Date(`${session.localDate}T12:00:00`);
    const now = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(now.getDate() - 30);
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(now.getDate() - 60);
    return sessionDate >= sixtyDaysAgo && sessionDate < thirtyDaysAgo;
  });
  const recentSpeed = getSpeedForSessions(recent30);
  const previousSpeed = getSpeedForSessions(previous30);
  if (previousSpeed > 0) {
    const variation = ((recentSpeed - previousSpeed) / previousSpeed) * 100;
    insights.push({
      title: 'Velocidade recente',
      detail: `Sua velocidade ${variation >= 0 ? 'aumentou' : 'caiu'} ${Math.abs(Math.round(variation))}% nos últimos 30 dias.`,
    });
  }

  insights.push({
    title: 'Ritmo diário',
    detail: `Você está lendo em média ${Math.round(derived.averageMinutesPerDay)} minutos por dia.`,
  });

  insights.push({
    title: 'Sessão mais longa',
    detail: `Seu maior tempo contínuo foi de ${formatDuration(derived.longestContinuousSessionMs)}.`,
  });

  if (derived.averagePauseIntervalMs > 0) {
    insights.push({
      title: 'Padrão de pausas',
      detail: `Você costuma fazer pausas a cada ${Math.max(1, Math.round(derived.averagePauseIntervalMs / 60000))} minutos.`,
    });
  }

  return insights.slice(0, 6);
}

export function buildWeeklyChartData(sessions: ReadingSession[]) {
  return buildDateSeriesData(sessions, 7);
}

function buildDateSeriesData(sessions: ReadingSession[], daysBack: number) {
  const map = new Map<string, { date: string; time: number; pages: number; words: number }>();
  const meaningfulSessions = filterMeaningfulReadingSessions(sessions);
  const days = Array.from({ length: daysBack }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - ((daysBack - 1) - index));
    return getDayKey(date);
  });

  for (const day of days) {
    map.set(day, { date: day, time: 0, pages: 0, words: 0 });
  }

  for (const session of meaningfulSessions) {
    const item = map.get(session.localDate) ?? { date: session.localDate, time: 0, pages: 0, words: 0 };
    item.time += session.durationMs / 60000;
    item.pages += 1;
    item.words += session.wordCount;
    map.set(session.localDate, item);
  }

  return Array.from(map.values());
}

export function buildMonthlyChartData(sessions: ReadingSession[]) {
  return buildDateSeriesData(sessions, 30);
}

export function buildBookRanking(books: StoredBook[], sessions?: ReadingSession[]) {
  const totalsByBook = sessions ? buildBookTotalsById(sessions) : null;

  return [...books]
    .map((book) => {
      const totals = totalsByBook?.[book.id];
      return totals
        ? {
            ...book,
            totalReadingTimeMs: totals.totalReadingTimeMs,
            totalWordsRead: totals.totalWordsRead,
            totalCharsRead: totals.totalCharsRead,
          }
        : book;
    })
    .sort((a, b) => b.totalReadingTimeMs - a.totalReadingTimeMs)
    .map((book) => ({
      id: book.id,
      title: book.title,
      progress: book.progress,
      lastReadAt: book.lastReadAt,
      time: book.totalReadingTimeMs,
      words: book.totalWordsRead,
      chars: book.totalCharsRead,
      totalPages: book.totalPages,
    }));
}

export function buildPageRanking(sessions: ReadingSession[]) {
  return Object.values(aggregatePageReadingStats(sessions))
    .sort((a, b) => b.totalReadingTimeMs - a.totalReadingTimeMs)
    .map((page) => ({
      id: page.id,
      bookId: page.bookId,
      bookTitle: page.bookTitle,
      pageNumber: page.pageNumber,
      chapterTitle: page.chapterTitle,
      time: page.totalReadingTimeMs,
      words: page.totalWords,
      chars: page.totalChars,
      visits: page.sessionCount,
      longestSessionMs: page.longestSessionMs,
      firstReadAt: page.firstReadAt,
      lastReadAt: page.lastReadAt,
    }));
}
