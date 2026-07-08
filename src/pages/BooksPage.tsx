import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookCover } from '../components/BookCover';
import { StatCard } from '../components/StatCard';
import { CatalogBook, StoredBook } from '../models/types';
import { clearBookProgress, getBooks, getPagesForBook, saveBooks, upsertBookPages } from '../services/storage';
import { formatDuration, formatLocalDateTime, formatPercent } from '../utils/date';

async function fetchCatalog() {
  const response = await fetch(`${import.meta.env.BASE_URL}livros/index.json`);
  if (!response.ok) {
    return [] as CatalogBook[];
  }

  return (await response.json()) as CatalogBook[];
}

function mergeMetadata(existing: StoredBook | undefined, incoming: StoredBook) {
  if (!existing) {
    return incoming;
  }

  return {
    ...incoming,
    currentPageIndex: existing.currentPageIndex,
    progress: existing.progress,
    lastReadAt: existing.lastReadAt,
    totalReadingTimeMs: existing.totalReadingTimeMs,
    totalWordsRead: existing.totalWordsRead,
    totalCharsRead: existing.totalCharsRead,
    createdAt: existing.createdAt,
    updatedAt: existing.updatedAt,
  };
}

export function BooksPage() {
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState<CatalogBook[]>([]);
  const [books, setBooks] = useState<StoredBook[]>(getBooks());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function run() {
      const items = await fetchCatalog();
      if (!mounted) {
        return;
      }
      setCatalog(items);

      const results: StoredBook[] = [];
      for (const entry of items) {
        const existing = getBooks().find((book) => book.id === entry.id);
        const pages = getPagesForBook(entry.id);
        if (existing && pages.length > 0) {
          results.push(existing);
          continue;
        }

        try {
          const modulePath = import.meta.env.DEV ? `../services/epub.ts?t=${Date.now()}` : '../services/epub';
          const epubModule = await import(modulePath);
          const extracted = await epubModule.extractEpubBook(entry);
          upsertBookPages(entry.id, extracted.pages);
          results.push(mergeMetadata(existing, extracted.book));
        } catch (error) {
          console.warn('Falha ao extrair EPUB', entry.file, error);
          results.push(
            existing ?? {
              id: entry.id,
              file: entry.file,
              title: entry.file.replace(/\.epub$/i, ''),
              author: 'Autor desconhecido',
              totalPages: 0,
              currentPageIndex: 0,
              progress: 0,
              totalReadingTimeMs: 0,
              totalWordsRead: 0,
              totalCharsRead: 0,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          );
        }
      }

      saveBooks(results);
      setBooks(results);
      setLoading(false);
    }

    void run();
    return () => {
      mounted = false;
    };
  }, []);

  const totals = useMemo(() => {
    const totalBooks = books.length;
    const totalPages = books.reduce((sum, book) => sum + book.totalPages, 0);
    const totalReadingTimeMs = books.reduce((sum, book) => sum + book.totalReadingTimeMs, 0);
    return { totalBooks, totalPages, totalReadingTimeMs };
  }, [books]);

  return (
    <main className="page-shell library-shell">
      <header className="page-topbar">
        <div>
          <p className="eyebrow">Reader Analytics</p>
          <h1>Biblioteca</h1>
          <p className="page-subtitle">EPUBs em `public/livros`, com progresso e retomada rápida.</p>
        </div>
        <nav className="top-actions">
          <Link className="ghost-link" to="/dashboard">
            Dashboard
          </Link>
        </nav>
      </header>

      <section className="stats-grid">
        <StatCard label="Livros" value={`${totals.totalBooks}`} note="na biblioteca" />
        <StatCard label="Páginas" value={`${totals.totalPages}`} note="extraídas" />
        <StatCard label="Tempo total" value={formatDuration(totals.totalReadingTimeMs)} note="salvo localmente" />
      </section>

      {loading ? <div className="loading-panel">Carregando EPUBs e metadados...</div> : null}

      <section className="book-grid">
        {books.map((book) => {
          const progressLabel = formatPercent(book.progress * 100);
          const lastRead = book.lastReadAt ? formatLocalDateTime(book.lastReadAt) : 'Ainda não iniciado';
          const canContinue = book.currentPageIndex > 0 || book.progress > 0;

          return (
            <article key={book.id} className="book-card">
              <BookCover title={book.title} author={book.author} cover={book.cover} />
              <div className="book-card-body">
                <div>
                  <p className="book-author">{book.author}</p>
                  <h2 className="book-title">{book.title}</h2>
                </div>
                <div className="book-metrics">
                  <div>
                    <span>Progresso</span>
                    <strong>{progressLabel}</strong>
                  </div>
                  <div>
                    <span>Última leitura</span>
                    <strong>{lastRead}</strong>
                  </div>
                </div>
                <div className="book-actions">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => navigate(`/livro/${book.id}`)}
                  >
                    {canContinue ? 'Continuar' : 'Iniciar leitura'}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      clearBookProgress(book.id);
                      navigate(`/livro/${book.id}`);
                    }}
                  >
                    Iniciar novamente
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
