import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  BarChart,
  Bar,
} from 'recharts';
import { StatCard } from '../components/StatCard';
import { getBooks, getDailyStats, getHighlights, getPages, getReadingSessions } from '../services/storage';
import {
  buildBookRanking,
  buildWeeklyChartData,
  computeDerivedMetrics,
  generateInsights,
} from '../utils/analytics';
import { formatDuration, formatLocalDateTime, formatNumber } from '../utils/date';

export function DashboardPage() {
  const books = getBooks();
  const sessions = getReadingSessions();
  const highlights = getHighlights();
  const pages = getPages();
  const dailyStats = getDailyStats();
  const derived = computeDerivedMetrics({ books, sessions, pages });
  const insights = generateInsights({ sessions, highlights, derived });
  const weekly = buildWeeklyChartData(sessions);
  const ranking = buildBookRanking(books);
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
  >)
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

  return (
    <main className="page-shell dashboard-shell">
      <header className="page-topbar">
        <div>
          <p className="eyebrow">Reader Analytics</p>
          <h1>Dashboard</h1>
          <p className="page-subtitle">Tempo, fluência, progresso e padrão de leitura. Tudo no navegador.</p>
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
          <div className="chart-block">
            <h3>Tempo por dia</h3>
            <ResponsiveContainer width="100%" height={220}>
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
          <div className="chart-block">
            <h3>Palavras por dia</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={weekly}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ddd6c8" />
                <XAxis dataKey="date" tick={{ fill: '#555' }} />
                <YAxis tick={{ fill: '#555' }} />
                <Tooltip />
                <Bar dataKey="words" fill="#36506f" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>

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
                  <small>{entry.bookTitle} · {entry.chapterTitle}</small>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="panel">
          <h2>Livros</h2>
          <div className="book-stats-list">
            {ranking.map((book) => (
              <div key={book.id} className="book-row">
                <div>
                  <strong>{book.title}</strong>
                  <small>{formatPercent(book.progress * 100)}</small>
                </div>
                <div>
                  <span>Última leitura</span>
                  <strong>{book.lastReadAt ? formatLocalDateTime(book.lastReadAt) : '-'}</strong>
                </div>
                <div>
                  <span>Tempo total</span>
                  <strong>{formatDuration(book.time)}</strong>
                </div>
                <div>
                  <span>Palavras lidas</span>
                  <strong>{formatNumber(book.words)}</strong>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="panel insights-panel">
        <h2>Insights</h2>
        <div className="insight-grid">
          {insights.map((insight) => (
            <article key={insight.title} className="insight-card">
              <strong>{insight.title}</strong>
              <p>{insight.detail}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );

  function formatPercent(value: number) {
    return `${Math.round(value)}%`;
  }
}
