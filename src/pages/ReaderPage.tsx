import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageText } from '../components/PageText';
import { HighlightRecord, StoredBook, StoredPageContent } from '../models/types';
import { extractEpubBook, PAGINATION_VERSION } from '../services/epub';
import { refreshDerivedStores } from '../services/analyticsSync';
import {
  addHighlight,
  addReadingSession,
  getBooks,
  getHighlights,
  getPagesForBook,
  removeHighlightsByToken,
  saveBooks,
  upsertBookPages,
  updateBookProgress,
} from '../services/storage';
import { formatPercent, getDayKey, nowIso, toLocalDateParts } from '../utils/date';
import { normalizeWord } from '../utils/text';
import {
  isMeaningfulReadingSession,
} from '../utils/analytics';

interface RuntimeState {
  startedAt: number | null;
  accumulatedMs: number;
  pauses: number;
  active: boolean;
}

function createRuntimeState(): RuntimeState {
  return {
    startedAt: null,
    accumulatedMs: 0,
    pauses: 0,
    active: false,
  };
}

function loadBookOrThrow(bookId: string) {
  return getBooks().find((book) => book.id === bookId);
}

export function ReaderPage() {
  const { livro } = useParams();
  const navigate = useNavigate();
  const [book, setBook] = useState<StoredBook | null>(null);
  const [pages, setPages] = useState<StoredPageContent[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [highlights, setHighlights] = useState<HighlightRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [isTextVisible, setIsTextVisible] = useState(false);
  const runtimeRef = useRef<RuntimeState>(createRuntimeState());

  const currentPage = pages[currentPageIndex];

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!livro) {
        navigate('/livros', { replace: true });
        return;
      }

      let loadedBook = loadBookOrThrow(livro);
      let loadedPages = getPagesForBook(livro);

      if (!loadedBook || loadedBook.paginationVersion !== PAGINATION_VERSION || loadedPages.length === 0) {
        const catalogResponse = await fetch(`${import.meta.env.BASE_URL}livros/index.json`);
        const catalog = (await catalogResponse.json()) as { id: string; file: string }[];
        const entry = catalog.find((item) => item.id === livro);

        if (!entry) {
          navigate('/livros', { replace: true });
          return;
        }

        const extracted = await extractEpubBook(entry);
        loadedBook = extracted.book;
        loadedPages = extracted.pages;
        upsertBookPages(livro, extracted.pages);
        saveBooks([...getBooks().filter((item) => item.id !== livro), extracted.book]);
      }

      if (cancelled) {
        return;
      }

      setBook(loadedBook);
      setPages(loadedPages);
      setCurrentPageIndex(loadedBook.currentPageIndex || 0);
      setHighlights(getHighlights().filter((item) => item.bookId === livro));
      runtimeRef.current.startedAt = Date.now();
      runtimeRef.current.active = true;
      runtimeRef.current.accumulatedMs = 0;
      runtimeRef.current.pauses = 0;
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [livro, navigate]);

  useEffect(() => {
    return () => {
      void commitCurrentSession('unload');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        void commitCurrentSession('unload');
      }
    };

    const handlePageHide = () => {
      void commitCurrentSession('unload');
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, []);

  const pageHighlights = useMemo(
    () => highlights.filter((item) => item.pageId === currentPage?.id),
    [highlights, currentPage?.id],
  );

  async function commitCurrentSession(reason: 'page-change' | 'unload') {
    const runtime = runtimeRef.current;
    if (!book || !currentPage || !runtime.active || runtime.startedAt === null) {
      return;
    }

    const endAt = Date.now();
    const durationMs = Math.max(0, endAt - runtime.startedAt);
    runtime.accumulatedMs += durationMs;
    const shouldRecordSession = isMeaningfulReadingSession({
      durationMs,
      wordCount: currentPage.wordCount,
    });

    if (!shouldRecordSession) {
      runtime.accumulatedMs = 0;
      runtime.startedAt = null;
      runtime.active = false;
      runtime.pauses = 0;
      return;
    }

    const sessionDate = toLocalDateParts(new Date());
    addReadingSession({
      id: `${currentPage.id}-${endAt}-${reason}`,
      bookId: book.id,
      bookTitle: book.title,
      pageId: currentPage.id,
      pageNumber: currentPage.pageNumber,
      chapterTitle: currentPage.chapterTitle,
      wordCount: currentPage.wordCount,
      charCount: currentPage.charCount,
      durationMs,
      pauses: runtime.pauses,
      highlightsCount: pageHighlights.length,
      startedAt: new Date(runtime.startedAt).toISOString(),
      endedAt: new Date(endAt).toISOString(),
      localDate: sessionDate.date,
      localTime: sessionDate.time,
    });

    updateBookProgress(book.id, {
      currentPageIndex,
      progress: pages.length > 0 ? (currentPageIndex + 1) / pages.length : 0,
      lastReadAt: nowIso(),
      totalReadingTimeMs: (book.totalReadingTimeMs ?? 0) + durationMs,
      totalWordsRead: (book.totalWordsRead ?? 0) + currentPage.wordCount,
      totalCharsRead: (book.totalCharsRead ?? 0) + currentPage.charCount,
    });

    runtime.accumulatedMs = 0;
    runtime.startedAt = null;
    runtime.active = false;
    runtime.pauses = 0;
    refreshDerivedStores();
  }

  function goToPage(nextIndex: number) {
    if (!pages[nextIndex] || nextIndex === currentPageIndex) {
      return;
    }

    void commitCurrentSession('page-change');
    setCurrentPageIndex(nextIndex);
    runtimeRef.current.startedAt = Date.now();
    runtimeRef.current.active = true;
    runtimeRef.current.pauses = 0;
    updateBookProgress(book?.id ?? '', {
      currentPageIndex: nextIndex,
      progress: pages.length > 0 ? (nextIndex + 1) / pages.length : 0,
      lastReadAt: nowIso(),
    });
  }

  function handleWordPress(payload: {
    word: string;
    sentence: string;
    sentenceIndex: number;
    wordIndex: number;
  }) {
    if (!book || !currentPage) {
      return;
    }

    const existingHighlight = highlights.find(
      (highlight) =>
        highlight.bookId === book.id &&
        highlight.pageId === currentPage.id &&
        highlight.sentenceIndex === payload.sentenceIndex &&
        highlight.wordIndex === payload.wordIndex,
    );

    if (existingHighlight) {
      removeHighlightsByToken(book.id, currentPage.id, payload.sentenceIndex, payload.wordIndex);
      setHighlights((items) =>
        items.filter(
          (highlight) =>
            !(
              highlight.bookId === book.id &&
              highlight.pageId === currentPage.id &&
              highlight.sentenceIndex === payload.sentenceIndex &&
              highlight.wordIndex === payload.wordIndex
            ),
        ),
      );
      refreshDerivedStores();
      return;
    }

    const createdAt = new Date();
    const timestamp = nowIso();
    const record: HighlightRecord = {
      id: `${currentPage.id}-${payload.sentenceIndex}-${payload.wordIndex}-${createdAt.getTime()}`,
      bookId: book.id,
      bookTitle: book.title,
      pageId: currentPage.id,
      pageNumber: currentPage.pageNumber,
      chapterTitle: currentPage.chapterTitle,
      sentence: payload.sentence,
      word: payload.word,
      normalizedWord: normalizeWord(payload.word),
      sentenceIndex: payload.sentenceIndex,
      wordIndex: payload.wordIndex,
      localDate: getDayKey(createdAt),
      localTime: toLocalDateParts(createdAt).time,
      createdAt: timestamp,
    };

    addHighlight(record);
    setHighlights((items) => [...items, record]);
    refreshDerivedStores();
  }

  const progress = pages.length > 0 ? ((currentPageIndex + 1) / pages.length) * 100 : 0;

  if (loading) {
    return <main className="page-shell reader-shell loading-panel">Abrindo leitor...</main>;
  }

  if (!book || !currentPage) {
    return (
      <main className="page-shell reader-shell loading-panel">
        Não foi possível abrir este livro.
      </main>
    );
  }

  return (
    <main className="page-shell reader-shell">
      <article className="reader-canvas">
        <PageText page={currentPage} highlights={highlights} onWordPress={handleWordPress} blurred={!isTextVisible} />
      </article>

      <footer className="reader-bottom-bar">
        <div className="reader-bar-left">
          <button
            type="button"
            className={`reader-toggle-button ${isTextVisible ? 'is-visible' : 'is-hidden'}`}
            onClick={() => setIsTextVisible((value) => !value)}
            aria-pressed={isTextVisible}
            title={isTextVisible ? 'Embaçar texto' : 'Mostrar texto'}
          >
            <span className="reader-toggle-icon" aria-hidden="true">
              {isTextVisible ? (
                <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                  <path d="M12 5c5.2 0 9.7 3.2 11.5 7-1.8 3.8-6.3 7-11.5 7S2.3 15.8.5 12C2.3 8.2 6.8 5 12 5Zm0 2c-4 0-7.5 2.4-9 5 1.5 2.6 5 5 9 5s7.5-2.4 9-5c-1.5-2.6-5-5-9-5Zm0 2.5A2.5 2.5 0 1 1 12 14a2.5 2.5 0 0 1 0-5Z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                  <path d="M2.3 4.7 19.3 21.7l-1.4 1.4-3.1-3.1c-1.5.5-2.9.7-4.8.7C4.8 20.7.3 16.8.5 12c.1-1.2.4-2.3 1-3.4L.9 7.9l1.4-1.4ZM7.2 9.6 8.8 11.2A3.5 3.5 0 0 0 12 16.5c.5 0 1.1-.1 1.6-.3l-1.7-1.7A2.5 2.5 0 0 1 9.5 11c0-.5.1-1 .3-1.4L7.2 7.1c-.6.7-1 1.6-1 2.5 0 .7.2 1.7 1 2.7 1.4 1.8 3.8 3.4 4.8 3.4.7 0 1.4-.1 2.1-.3L12.8 13c-1.1-.1-2-.9-2.2-2l-3.4-3.4Zm4.8-2.1c.4 0 .9 0 1.4.1L16 9.2c.5.7.8 1.5.8 2.6 0 1.3-.5 2.5-1.4 3.5l1.4 1.4c1.4-1.4 2.1-3 2.1-4.9 0-2-.8-3.7-2.5-5.2-1.4-1.2-3.3-2-5.5-2-.8 0-1.6.1-2.4.3l1.5 1.5c.8-.2 1.5-.3 2.1-.3Z" />
                </svg>
              )}
            </span>
          </button>

          <button
            type="button"
            className="reader-nav-button"
            disabled={currentPageIndex === 0}
            onClick={() => goToPage(Math.max(0, currentPageIndex - 1))}
            title="Página anterior"
          >
            <span aria-hidden="true">←</span>
          </button>

          <button
            type="button"
            className="reader-nav-button"
            disabled={currentPageIndex >= pages.length - 1}
            onClick={() => goToPage(Math.min(pages.length - 1, currentPageIndex + 1))}
            title="Próxima página"
          >
            <span aria-hidden="true">→</span>
          </button>
        </div>

        <div className="reader-bar-right">
          <div className="reader-page-info">
            <div className="reader-page-number">
              {currentPageIndex + 1} / {pages.length}
            </div>
            <div className="reader-progress">{formatPercent(progress)}</div>
          </div>
        </div>
      </footer>
    </main>
  );
}
