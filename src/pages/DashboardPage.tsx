import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BookCover } from '../components/BookCover';
import { StatCard } from '../components/StatCard';
import { getBooks, getDailyStats, getHighlights, getPageReadingStats, getReadingSessions } from '../services/storage';
import { refreshDerivedStores } from '../services/analyticsSync';
import {
  buildBookRanking,
  buildMonthlyChartData,
  buildPageRanking,
  buildWeeklyChartData,
  computeDerivedMetrics,
  generateInsights,
} from '../utils/analytics';
import { formatDuration, formatLocalDateTime, formatNumber } from '../utils/date';

export function DashboardPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(() => getBooks()[0]?.id ?? null);

  useEffect(() => {
    refreshDerivedStores();
    setRefreshKey((value) => value + 1);
  }, []);

  const books = getBooks();
  const sessions = getReadingSessions();
  const highlights = getHighlights();
  const dailyStats = getDailyStats();
  const pageStats = useMemo(() => Object.values(getPageReadingStats()), [refreshKey]);
  const derived = computeDerivedMetrics({ books, sessions });
  const insights = generateInsights({ sessions, highlights, derived });
  const weekly = buildWeeklyChartData(sessions);
  const monthly = buildMonthlyChartData(sessions);
  const ranking = buildBookRanking(books, sessions);
  const pageRanking = buildPageRanking(sessions);
  const highlightCountByPage = highlights.reduce<Record<string, number>>((acc, highlight) => {
    acc[highlight.pageId] = (acc[highlight.pageId] ?? 0) + 1;
    return acc;
  }, {});

  const difficultWords = Object.values(
    highlights.reduce((acc, highlight) => {
      const key = highlight.normalizedWord;

      acc[key] = acc[key] ?? {
        word: highlight.word,
        count: 0,
        lastAt: highlight.createdAt,
        sentence: highlight.sentence,
        bookTitle: highlight.bookTitle,
        chapterTitle: highlight.chapterTitle,
      };

      acc[key].count += 1;

      if (highlight.createdAt > acc[key].lastAt) {
        acc[key].lastAt = highlight.createdAt;
        acc[key].sentence = highlight.sentence;
        acc[key].bookTitle = highlight.bookTitle;
        acc[key].chapterTitle = highlight.chapterTitle;
      }

      return acc;
    }, {} as Record<
      string,
      {
        word: string;
        count: number;
        lastAt: string;
        sentence: string;
        bookTitle: string;
        chapterTitle: string;
      }
    >),
  )
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const today = Object.values(dailyStats).sort((a, b) => b.date.localeCompare(a.date))[0] ?? {
    readingTimeMs: 0,
    pages: 0,
    words: 0,
    chars: 0,
    highlights: 0,
  };

  const weeklyTotals = sumSeries(weekly);
  const monthlyTotals = sumSeries(monthly);

  const selectedBook = books.find((book) => book.id === selectedBookId) ?? books[0] ?? null;
  const selectedPageRows = selectedBook
    ? pageRanking
        .filter((page) => page.bookId === selectedBook.id)
        .sort((a, b) => a.pageNumber - b.pageNumber)
    : [];
  const selectedMostReadChapter = selectedPageRows.reduce<{ chapterTitle: string; time: number } | null>(
    (best, page) => {
      const chapterTime = selectedPageRows
        .filter((item) => item.chapterTitle === page.chapterTitle)
        .reduce((sum, item) => sum + item.time, 0);
      if (!best || chapterTime > best.time) {
        return { chapterTitle: page.chapterTitle, time: chapterTime };
      }
      return best;
    },
    null,
  );
  const selectedLongestPage = selectedPageRows.reduce(
    (best, page) => (!best || page.time > best.time ? page : best),
    null as (typeof selectedPageRows)[number] | null,
  );

  const repeatedPages = pageStats.filter((page) => page.sessionCount > 1).length;
  const longestPage = pageRanking[0];
  const pageStatsTotal = pageStats.reduce((sum, page) => sum + page.totalReadingTimeMs, 0);
  const averagePageTimeMs = pageStats.length > 0 ? pageStatsTotal / pageStats.length : 0;

  return (
    <main className="page-shell dashboard-shell">
      <header className="page-topbar">
        <div>
          <p className="eyebrow">Reader Analytics</p>
          <h1>Dashboard</h1>
          <p className="page-subtitle">Tempo, fluência, progresso, ritmo semanal, mensal e visão detalhada por livro.</p>
        </div>
      </header>

      <section className="stats-grid">
        <StatCard label="Hoje" value={formatDuration(today.readingTimeMs)} note="tempo lendo" />
        <StatCard label="Páginas" value={`${formatNumber(today.pages)}`} note="hoje" />
        <StatCard label="Palavras" value={`${formatNumber(today.words)}`} note="hoje" />
        <StatCard label="Caracteres" value={`${formatNumber(today.chars)}`} note="hoje" />
      </section>

      <section className="dashboard-panels">
        <article className="panel">
          <h2>Semana</h2>
          <div className="stats-grid compact">
            <StatCard label="Tempo" value={formatDuration(weeklyTotals.timeMs)} note="7 dias" />
            <StatCard label="Páginas" value={formatNumber(weeklyTotals.pages)} note="7 dias" />
            <StatCard label="Palavras" value={formatNumber(weeklyTotals.words)} note="7 dias" />
            <StatCard label="Média/dia" value={formatDuration(weeklyTotals.averagePerDayMs)} note="7 dias" />
          </div>

          <div className="chart-block">
            <h3>Tempo por dia</h3>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={weekly}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ddd6c8" />
                <XAxis dataKey="date" tick={{ fill: '#555' }} />
                <YAxis tick={{ fill: '#555' }} />
                <Tooltip formatter={(value: number) => `${Math.round(value)} min`} />
                <Line type="monotone" dataKey="time" stroke="#3a3a2a" strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-block">
            <h3>Páginas por dia</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={weekly}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ddd6c8" />
                <XAxis dataKey="date" tick={{ fill: '#555' }} />
                <YAxis tick={{ fill: '#555' }} />
                <Tooltip />
                <Bar dataKey="pages" fill="#7b5f3c" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="panel">
          <h2>Mês</h2>
          <div className="stats-grid compact">
            <StatCard label="Tempo" value={formatDuration(monthlyTotals.timeMs)} note="30 dias" />
            <StatCard label="Páginas" value={formatNumber(monthlyTotals.pages)} note="30 dias" />
            <StatCard label="Palavras" value={formatNumber(monthlyTotals.words)} note="30 dias" />
            <StatCard label="Média/dia" value={formatDuration(monthlyTotals.averagePerDayMs)} note="30 dias" />
          </div>

          <div className="chart-block">
            <h3>Tempo nos últimos 30 dias</h3>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ddd6c8" />
                <XAxis dataKey="date" tick={{ fill: '#555', fontSize: 12 }} minTickGap={18} />
                <YAxis tick={{ fill: '#555' }} />
                <Tooltip formatter={(value: number) => `${Math.round(value)} min`} />
                <Line type="monotone" dataKey="time" stroke="#36506f" strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-block">
            <h3>Palavras nos últimos 30 dias</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ddd6c8" />
                <XAxis dataKey="date" tick={{ fill: '#555', fontSize: 12 }} minTickGap={18} />
                <YAxis tick={{ fill: '#555' }} />
                <Tooltip />
                <Bar dataKey="words" fill="#36506f" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>

      <section className="dashboard-panels">
        <article className="panel">
          <h2>Evolução</h2>
          <div className="stats-grid compact">
            <StatCard label="Tempo médio por página" value={formatDuration(derived.avgTimePerPageMs)} note="↓" />
            <StatCard label="Tempo médio por palavra" value={`${derived.avgTimePerWordMs.toFixed(2)} ms`} note="↓" />
            <StatCard label="Palavras por minuto" value={`${derived.wordsPerMinute.toFixed(1)}`} note="↑" />
            <StatCard label="Caracteres por minuto" value={`${derived.charsPerMinute.toFixed(1)}`} note="↑" />
          </div>

          <div className="metric-list">
            <div>
              <span>Livro mais lido</span>
              <strong>{derived.mostReadBook?.title ?? '-'}</strong>
            </div>
            <div>
              <span>Livro mais rápido</span>
              <strong>{derived.fastestBook?.title ?? '-'}</strong>
            </div>
            <div>
              <span>Maior sequência</span>
              <strong>{derived.longestStreakDays} dias</strong>
            </div>
            <div>
              <span>Tempo total</span>
              <strong>{formatDuration(derived.totalReadingTimeMs)}</strong>
            </div>
            <div>
              <span>Páginas totais</span>
              <strong>{formatNumber(derived.totalPages)}</strong>
            </div>
            <div>
              <span>Palavras totais</span>
              <strong>{formatNumber(derived.totalWords)}</strong>
            </div>
            <div>
              <span>Caracteres totais</span>
              <strong>{formatNumber(derived.totalChars)}</strong>
            </div>
            <div>
              <span>Velocidade média</span>
              <strong>{derived.wordsPerMinute.toFixed(1)} ppm</strong>
            </div>
          </div>
        </article>

        <article className="panel">
          <h2>Leitura por página</h2>
          <div className="stats-grid compact">
            <StatCard label="Páginas monitoradas" value={formatNumber(pageStats.length)} note="salvas" />
            <StatCard label="Tempo médio por página" value={formatDuration(averagePageTimeMs)} note="visitas válidas" />
            <StatCard
              label="Página mais longa"
              value={longestPage ? `${longestPage.bookTitle} · p. ${longestPage.pageNumber}` : '-'}
              note={longestPage ? formatDuration(longestPage.time) : 'sem dados'}
            />
            <StatCard label="Páginas revisitadas" value={formatNumber(repeatedPages)} note="mais de 1 sessão" />
          </div>

          <div className="chart-block">
            <h3>Tempo por página</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={pageRanking.slice(0, 8).map((page) => ({
                  label: `${page.bookTitle} · p. ${page.pageNumber}`,
                  minutes: page.time / 60000,
                }))}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#ddd6c8" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#555', fontSize: 12 }}
                  interval={0}
                  angle={-18}
                  textAnchor="end"
                  height={68}
                />
                <YAxis tick={{ fill: '#555' }} />
                <Tooltip formatter={(value: number) => `${value.toFixed(1)} min`} />
                <Bar dataKey="minutes" fill="#36506f" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="book-stats-list">
            {pageRanking.slice(0, 8).length === 0 ? (
              <p className="empty-state">Ainda não há sessões suficientes para montar o mapa por página.</p>
            ) : (
              pageRanking.slice(0, 8).map((page) => (
                <div key={page.id} className="book-row">
                  <div>
                    <strong>
                      {page.bookTitle} · p. {page.pageNumber}
                    </strong>
                    <small>{page.chapterTitle}</small>
                  </div>
                  <div>
                    <span>Tempo</span>
                    <strong>{formatDuration(page.time)}</strong>
                  </div>
                  <div>
                    <span>Visitas</span>
                    <strong>{formatNumber(page.visits)}</strong>
                  </div>
                  <div>
                    <span>Destaques</span>
                    <strong>{formatNumber(highlightCountByPage[page.id] ?? 0)}</strong>
                  </div>
                </div>
              ))
            )}
          </div>
        </article>
      </section>

      <section className="dashboard-panels">
        <article className="panel">
          <h2>Palavras difíceis</h2>
          <div className="word-table">
            {difficultWords.length === 0 ? (
              <p className="empty-state">Ainda não há destaques suficientes para montar o dicionário.</p>
            ) : (
              difficultWords.map((entry) => (
                <div key={entry.word} className="word-row">
                  <strong>{entry.word}</strong>
                  <span>{entry.count} vezes</span>
                  <small>Última vez: {formatLocalDateTime(entry.lastAt)}</small>
                  <small>
                    {entry.bookTitle} · {entry.chapterTitle}
                  </small>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="panel">
          <h2>Insights</h2>
          <div className="insight-grid">
            {insights.map((insight) => (
              <article key={insight.title} className="insight-card">
                <strong>{insight.title}</strong>
                <p>{insight.detail}</p>
              </article>
            ))}
          </div>
        </article>
      </section>

      <section className="panel book-detail-panel">
        <div className="book-detail-head">
          <div>
            <p className="eyebrow">Por livro</p>
            <h2>{selectedBook?.title ?? 'Selecione um livro'}</h2>
            <p className="page-subtitle">
              Clique em um livro para ver um cabeçalho com os dados principais e a tabela de páginas lidas.
            </p>
          </div>
        </div>

        <div className="book-selector-grid">
          {ranking.map((book) => (
            <button
              type="button"
              key={book.id}
              className={`book-selector ${selectedBook?.id === book.id ? 'is-selected' : ''}`}
              onClick={() => setSelectedBookId(book.id)}
            >
              <strong>{book.title}</strong>
              <span>{book.words} palavras lidas</span>
              <small>{formatDuration(book.time)}</small>
            </button>
          ))}
        </div>

        {selectedBook ? (
          <div className="book-detail-card">
            <div className="book-detail-header">
              <BookCover title={selectedBook.title} author={selectedBook.author} cover={selectedBook.cover} />

              <div className="book-detail-meta">
                <div>
                  <span>Título</span>
                  <strong>{selectedBook.title}</strong>
                </div>
                <div>
                  <span>Autor</span>
                  <strong>{selectedBook.author}</strong>
                </div>
                <div>
                  <span>Ano de lançamento</span>
                  <strong>{selectedBook.publicationYear ?? '-'}</strong>
                </div>
                <div>
                  <span>Páginas</span>
                  <strong>{selectedBook.totalPages}</strong>
                </div>
                <div>
                  <span>Progresso</span>
                  <strong>{formatPercent(selectedBook.progress * 100)}</strong>
                </div>
                <div>
                  <span>Tempo total</span>
                  <strong>{formatDuration(selectedBook.totalReadingTimeMs)}</strong>
                </div>
                <div>
                  <span>Palavras lidas</span>
                  <strong>{formatNumber(selectedBook.totalWordsRead)}</strong>
                </div>
                <div>
                  <span>Caracteres lidos</span>
                  <strong>{formatNumber(selectedBook.totalCharsRead)}</strong>
                </div>
                <div>
                  <span>Última leitura</span>
                  <strong>{selectedBook.lastReadAt ? formatLocalDateTime(selectedBook.lastReadAt) : '-'}</strong>
                </div>
              </div>
            </div>

            <div className="book-detail-summary">
              <div>
                <span>Páginas com leitura válida</span>
                <strong>{formatNumber(selectedPageRows.length)}</strong>
              </div>
              <div>
                <span>Tempo médio por página</span>
                <strong>
                  {formatDuration(
                    selectedPageRows.length > 0
                      ? selectedPageRows.reduce((sum, page) => sum + page.time, 0) / selectedPageRows.length
                      : 0,
                  )}
                </strong>
              </div>
              <div>
                <span>Capítulo mais lido</span>
                <strong>{selectedMostReadChapter?.chapterTitle ?? '-'}</strong>
              </div>
              <div>
                <span>Página mais longa</span>
                <strong>
                  {selectedLongestPage
                    ? `${selectedLongestPage.pageNumber} (${formatDuration(selectedLongestPage.time)})`
                    : '-'}
                </strong>
              </div>
            </div>

            <div className="table-shell">
              <table className="detail-table">
                <thead>
                  <tr>
                    <th>Página</th>
                    <th>Capítulo</th>
                    <th>Palavras</th>
                    <th>Letras</th>
                    <th>Tempo lendo</th>
                    <th>Visitas</th>
                    <th>Destaques</th>
                    <th>Primeira leitura</th>
                    <th>Última leitura</th>
                    <th>Média/visita</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedPageRows.length === 0 ? (
                    <tr>
                      <td colSpan={10}>
                        <div className="empty-state">Nenhuma página válida encontrada para este livro.</div>
                      </td>
                    </tr>
                  ) : (
                    selectedPageRows.map((page) => {
                      const averageVisitMs = page.visits > 0 ? page.time / page.visits : 0;
                      return (
                        <tr key={page.id}>
                          <td>{page.pageNumber}</td>
                          <td>{page.chapterTitle}</td>
                          <td>{formatNumber(page.words)}</td>
                          <td>{formatNumber(page.chars)}</td>
                          <td>{formatDuration(page.time)}</td>
                          <td>{formatNumber(page.visits)}</td>
                          <td>{formatNumber(highlightCountByPage[page.id] ?? 0)}</td>
                          <td>{formatLocalDateTime(page.firstReadAt)}</td>
                          <td>{formatLocalDateTime(page.lastReadAt)}</td>
                          <td>{formatDuration(averageVisitMs)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="page-mobile-list">
              {selectedPageRows.length === 0 ? (
                <p className="empty-state">Nenhuma página válida encontrada para este livro.</p>
              ) : (
                selectedPageRows.map((page) => {
                  const averageVisitMs = page.visits > 0 ? page.time / page.visits : 0;
                  return (
                    <article key={page.id} className="page-mobile-card">
                      <div className="page-mobile-card-head">
                        <strong>
                          Página {page.pageNumber}
                          <span> · {page.chapterTitle}</span>
                        </strong>
                        <small>{formatLocalDateTime(page.lastReadAt)}</small>
                      </div>

                      <div className="page-mobile-card-grid">
                        <div>
                          <span>Tempo</span>
                          <strong>{formatDuration(page.time)}</strong>
                        </div>
                        <div>
                          <span>Palavras</span>
                          <strong>{formatNumber(page.words)}</strong>
                        </div>
                        <div>
                          <span>Letras</span>
                          <strong>{formatNumber(page.chars)}</strong>
                        </div>
                        <div>
                          <span>Visitas</span>
                          <strong>{formatNumber(page.visits)}</strong>
                        </div>
                        <div>
                          <span>Destaques</span>
                          <strong>{formatNumber(highlightCountByPage[page.id] ?? 0)}</strong>
                        </div>
                        <div>
                          <span>Média/visita</span>
                          <strong>{formatDuration(averageVisitMs)}</strong>
                        </div>
                      </div>

                      <div className="page-mobile-card-footer">
                        <small>Primeira leitura: {formatLocalDateTime(page.firstReadAt)}</small>
                        <small>Última leitura: {formatLocalDateTime(page.lastReadAt)}</small>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <p className="empty-state">Nenhum livro disponível para detalhar.</p>
        )}
      </section>
    </main>
  );

  function formatPercent(value: number) {
    return `${Math.round(value)}%`;
  }
}

function sumSeries(data: Array<{ time: number; pages: number; words: number }>) {
  const totalTimeMs = data.reduce((sum, item) => sum + item.time * 60000, 0);
  const totalPages = data.reduce((sum, item) => sum + item.pages, 0);
  const totalWords = data.reduce((sum, item) => sum + item.words, 0);
  const days = data.length || 1;

  return {
    timeMs: totalTimeMs,
    pages: totalPages,
    words: totalWords,
    averagePerDayMs: totalTimeMs / days,
  };
}
