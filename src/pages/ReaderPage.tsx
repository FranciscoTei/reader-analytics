import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageText } from '../components/PageText';
import { HighlightRecord, StoredBook, StoredPageContent } from '../models/types';
import { extractEpubBook } from '../services/epub';
import { refreshDerivedStores } from '../services/analyticsSync';
import {
  addHighlight,
  addReadingSession,
  getBooks,
  getHighlights,
  getPagesForBook,
  saveBooks,
  upsertBookPages,
  updateBookProgress,
} from '../services/storage';
import { PAGINATION_VERSION } from '../services/epub';
import { formatPercent, getDayKey, nowIso, toLocalDateParts } from '../utils/date';
import { normalizeWord } from '../utils/text';

interface RuntimeState {
  startedAt: number | null;
  accumulatedMs: number;
  pauses: number;
  active: boolean;
  pauseTimer: number | null;
}

function createRuntimeState(): RuntimeState {
  return {
    startedAt: null,
    accumulatedMs: 0,
    pauses: 0,
    active: false,
    pauseTimer: null,
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
  const [holding, setHolding] = useState(false);
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
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [livro, navigate]);

  useEffect(() => {
    return () => {
      if (runtimeRef.current.pauseTimer) {
        window.clearTimeout(runtimeRef.current.pauseTimer);
      }
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

  async function commitCurrentSession(reason: 'pause' | 'page-change' | 'unload') {
    const runtime = runtimeRef.current;
    if (!book || !currentPage || !runtime.active || runtime.startedAt === null) {
      return;
    }

    const endAt = Date.now();
    const durationMs = Math.max(0, endAt - runtime.startedAt);
    runtime.accumulatedMs += durationMs;

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
      pauses: reason === 'pause' ? runtime.pauses + 1 : runtime.pauses,
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
    setHolding(false);
    refreshDerivedStores();
  }

  function startHolding() {
    if (!currentPage) {
      return;
    }

    if (runtimeRef.current.pauseTimer) {
      window.clearTimeout(runtimeRef.current.pauseTimer);
      runtimeRef.current.pauseTimer = null;
    }

    if (!runtimeRef.current.active) {
      runtimeRef.current.startedAt = Date.now();
      runtimeRef.current.active = true;
      runtimeRef.current.pauses = runtimeRef.current.pauses;
    } else if (runtimeRef.current.startedAt === null) {
      runtimeRef.current.startedAt = Date.now();
    }

    setHolding(true);
  }

  function schedulePause() {
    const tolerance = 500;
    if (runtimeRef.current.pauseTimer) {
      window.clearTimeout(runtimeRef.current.pauseTimer);
    }

    runtimeRef.current.pauseTimer = window.setTimeout(() => {
      runtimeRef.current.pauses += 1;
      void commitCurrentSession('pause');
      runtimeRef.current.pauseTimer = null;
    }, tolerance);
  }

  function stopHolding() {
    if (!runtimeRef.current.active) {
      return;
    }

    schedulePause();
  }

  function goToPage(nextIndex: number) {
    if (!pages[nextIndex] || nextIndex === currentPageIndex) {
      return;
    }

    void commitCurrentSession('page-change');
    setCurrentPageIndex(nextIndex);
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
        <PageText page={currentPage} highlights={highlights} onWordPress={handleWordPress} blurred={!holding} />
      </article>

      <footer className="reader-bottom-bar">
        <div className="reader-bar-left">
          <button
            type="button"
            className={`reader-hold-button ${holding ? 'is-holding' : ''}`}
            onPointerDown={startHolding}
            onPointerUp={stopHolding}
            onPointerLeave={stopHolding}
            onPointerCancel={stopHolding}
            onContextMenu={(event) => event.preventDefault()}
            title={holding ? 'Solte para pausar' : 'Segure para ler'}
          >
            <span aria-hidden="true">◔</span>
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
            <div className="reader-page-number">{currentPageIndex + 1} / {pages.length}</div>
            <div className="reader-progress">{formatPercent(progress)}</div>
          </div>
        </div>
      </footer>
    </main>
  );
}
