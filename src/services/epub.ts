import type { BookExtractionResult, BookChapter, CatalogBook, StoredBook, StoredPageContent } from '../models/types';
import { countCharacters, countWords, createPageText, extractFirstHeading, normalizeText, splitIntoSentenceChunks } from '../utils/text';
import { nowIso } from '../utils/date';

// === Configurações de visualização === //
// Ajuste estes valores para mudar a aparência da leitura
export const READER_CONFIG = {
  // Número de palavras por página (afeta quanto texto é mostrado)
  wordsPerPage: 150,
};
// === Fim das configurações === //

function resolveZipPath(basePath: string, href: string) {
  const cleanHref = href.replace(/\\/g, '/');
  if (!cleanHref || cleanHref.startsWith('http://') || cleanHref.startsWith('https://')) {
    return cleanHref;
  }

  const baseDir = basePath.includes('/') ? basePath.substring(0, basePath.lastIndexOf('/') + 1) : '';
  const segments = `${baseDir}${cleanHref}`.split('/');
  const normalized: string[] = [];

  segments.forEach((segment) => {
    if (!segment || segment === '.') {
      return;
    }

    if (segment === '..') {
      normalized.pop();
      return;
    }

    normalized.push(segment);
  });

  return normalized.join('/');
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseContainerRootFile(containerXml: string) {
  const match = containerXml.match(/<rootfile[^>]+full-path="([^"]+)"/i);
  return match?.[1] ?? null;
}

function parseOpfMetadata(opfXml: string) {
  const titleMatch = opfXml.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i);
  const creatorMatch = opfXml.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i);
  const title = titleMatch ? stripTags(titleMatch[1]) : '';
  const author = creatorMatch ? stripTags(creatorMatch[1]) : '';
  return { title, author };
}

function parseManifestAndSpine(opfXml: string) {
  const manifest = new Map<string, string>();
  const itemMatches = Array.from(opfXml.matchAll(/<item\b[^>]*>/gi));
  itemMatches.forEach((match) => {
    const block = match[0];
    const idMatch = block.match(/id="([^"]+)"/i);
    const hrefMatch = block.match(/href="([^"]+)"/i);
    if (!idMatch || !hrefMatch) {
      return;
    }

    manifest.set(idMatch[1], hrefMatch[1]);
  });

  const spineIds = Array.from(opfXml.matchAll(/<itemref\b[^>]*>/gi))
    .map((match) => match[0].match(/idref="([^"]+)"/i)?.[1])
    .filter((value): value is string => Boolean(value));

  return { manifest, spineIds };
}

type ZipEntries = Record<string, Uint8Array>;

function readUint32LE(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);
}

function readUint16LE(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readZipString(bytes: Uint8Array, offset: number, length: number) {
  const slice = bytes.subarray(offset, offset + length);
  return new TextDecoder('utf-8').decode(slice);
}

async function readDeflatedData(data: Uint8Array) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream não disponível');
  }

  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const response = new Response(stream);
  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

export async function loadEpubArchive(fileUrl: string): Promise<ZipEntries> {
  const response = await fetch(fileUrl);
  const contentType = response.headers.get('content-type') || 'unknown';
  if (!response.ok) {
    throw new Error(`Falha ao carregar EPUB: ${response.status} ${contentType} ${fileUrl}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength < 10) {
    throw new Error(`EPUB vazio: ${fileUrl} ${contentType}`);
  }
  const bytes = new Uint8Array(arrayBuffer);
  const entries: ZipEntries = {};

  let eocdOffset = -1;
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (bytes[offset] === 0x50 && bytes[offset + 1] === 0x4b && bytes[offset + 2] === 0x05 && bytes[offset + 3] === 0x06) {
      eocdOffset = offset;
      break;
    }
  }

  if (eocdOffset < 0) {
    throw new Error(`EPUB sem central directory: url=${fileUrl} size=${bytes.length} first=${Array.from(bytes.slice(0, 8)).join(',')} last=${Array.from(bytes.slice(-8)).join(',')} contentType=${contentType}`);
  }

  const centralDirectoryOffset = readUint32LE(bytes, eocdOffset + 16);
  const entryCount = readUint16LE(bytes, eocdOffset + 10);
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > bytes.length) {
      break;
    }

    const signature = readUint32LE(bytes, cursor);
    if (signature !== 0x02014b50) {
      break;
    }

    const fileNameLength = readUint16LE(bytes, cursor + 28);
    const extraLength = readUint16LE(bytes, cursor + 30);
    const commentLength = readUint16LE(bytes, cursor + 32);
    const compressionMethod = readUint16LE(bytes, cursor + 10);
    const compressedSize = readUint32LE(bytes, cursor + 20);
    const uncompressedSize = readUint32LE(bytes, cursor + 24);
    const localHeaderOffset = readUint32LE(bytes, cursor + 42);
    const fileName = readZipString(bytes, cursor + 46, fileNameLength);

    if (fileName.endsWith('/')) {
      cursor += 46 + fileNameLength + extraLength + commentLength;
      continue;
    }

    if (localHeaderOffset + 30 > bytes.length) {
      cursor += 46 + fileNameLength + extraLength + commentLength;
      continue;
    }

    const localSignature = readUint32LE(bytes, localHeaderOffset);
    if (localSignature !== 0x04034b50) {
      cursor += 46 + fileNameLength + extraLength + commentLength;
      continue;
    }

    const localFileNameLength = readUint16LE(bytes, localHeaderOffset + 26);
    const localExtraLength = readUint16LE(bytes, localHeaderOffset + 28);
    const localFileDataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const localFileDataEnd = localFileDataOffset + compressedSize;

    if (localFileDataEnd > bytes.length) {
      cursor += 46 + fileNameLength + extraLength + commentLength;
      continue;
    }

    const rawData = bytes.subarray(localFileDataOffset, localFileDataEnd);
    let entryData: Uint8Array = rawData;

    if (compressionMethod === 8) {
      entryData = await readDeflatedData(rawData);
    } else if (compressionMethod !== 0) {
      throw new Error(`Método de compressão não suportado: ${compressionMethod}`);
    }

    if (entryData.length !== uncompressedSize) {
      entryData = entryData.slice(0, uncompressedSize);
    }

    entries[fileName.replace(/\\/g, '/')] = entryData;
    cursor += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function getZipEntry(zip: ZipEntries, path: string) {
  const normalizedPath = path.replace(/\\/g, '/');
  return zip[normalizedPath] ?? zip[normalizedPath.replace(/^\/+/, '')] ?? null;
}

function readZipText(zip: ZipEntries, path: string) {
  const entry = getZipEntry(zip, path);
  if (!entry) {
    return null;
  }

  return new TextDecoder('utf-8').decode(entry);
}

async function loadChapterHtml(zip: ZipEntries, basePath: string, href: string) {
  const resolvedPath = resolveZipPath(basePath, href);
  return readZipText(zip, resolvedPath);
}

function resolveDocument(contents: string | null): Document | null {
  if (!contents) {
    return null;
  }

  const parser = new DOMParser();
  return parser.parseFromString(contents, 'text/html');
}

function extractChapterTitle(document: Document | null, fallback: string) {
  const title = extractFirstHeading(document);
  return title || fallback;
}

function extractChapterText(document: Document | null) {
  if (!document) {
    return '';
  }

  const article = document.body?.innerText || document.body?.textContent || '';
  return normalizeText(article);
}

function paginateChapters(bookId: string, chapters: BookChapter[]) {
  const pages: StoredPageContent[] = [];
  let globalPageNumber = 0;

  chapters.forEach((chapter, chapterIndex) => {
    const sentenceChunks = splitIntoSentenceChunks(chapter.text);
    let currentSentences: string[] = [];
    let currentWords = 0;

    const flush = () => {
      if (currentSentences.length === 0) {
        return;
      }

      const text = createPageText(currentSentences);
      globalPageNumber += 1;
      pages.push({
        id: `${bookId}-page-${String(globalPageNumber).padStart(4, '0')}`,
        bookId,
        pageNumber: globalPageNumber,
        positionInEpub: globalPageNumber,
        chapterIndex,
        chapterTitle: chapter.title,
        text,
        sentences: [...currentSentences],
        wordCount: countWords(text),
        charCount: countCharacters(text),
      });
      currentSentences = [];
      currentWords = 0;
    };

    for (const chunk of sentenceChunks) {
      const chunkWords = chunk.words.length || countWords(chunk.sentence);
      const wouldOverflow = currentWords > 0 && currentWords + chunkWords > READER_CONFIG.wordsPerPage;

      if (wouldOverflow) {
        flush();
      }

      currentSentences.push(chunk.sentence);
      currentWords += chunkWords;

      if (currentWords >= READER_CONFIG.wordsPerPage) {
        flush();
      }
    }

    flush();
  });

  return pages;
}

export function createFallbackCover(title: string) {
  const initials = title
    .split(' ')
    .slice(0, 3)
    .map((word) => word[0]?.toUpperCase())
    .join('');

  return initials || 'EPUB';
}

export async function extractEpubBook(entry: CatalogBook): Promise<BookExtractionResult> {
  const candidatePaths = [
    `/epubs/${encodeURI(entry.file)}`,
    `/livros/${encodeURI(entry.file)}`,
  ];

  let zip: ZipEntries | null = null;
  let usedUrl = '';

  for (const fileUrl of candidatePaths) {
    try {
      zip = await loadEpubArchive(fileUrl);
      usedUrl = fileUrl;
      break;
    } catch (error) {
      if (fileUrl === candidatePaths[candidatePaths.length - 1]) {
        throw error;
      }
    }
  }

  if (!zip) {
    throw new Error(`Não foi possível carregar o EPUB para ${entry.file}`);
  }

  const containerXml = readZipText(zip, 'META-INF/container.xml');
  if (!containerXml) {
    throw new Error('EPUB sem container.xml');
  }
  const rootFilePath = parseContainerRootFile(containerXml);
  if (!rootFilePath) {
    throw new Error('EPUB sem rootfile');
  }

  const opfXml = readZipText(zip, rootFilePath);
  if (!opfXml) {
    throw new Error('EPUB sem package OPF');
  }
  const { title, author } = parseOpfMetadata(opfXml);
  const { manifest, spineIds } = parseManifestAndSpine(opfXml);

  const chapters: BookChapter[] = [];
  for (let index = 0; index < spineIds.length; index += 1) {
    const idref = spineIds[index];
    const href = manifest.get(idref);
    if (!href) {
      continue;
    }

    const html = await loadChapterHtml(zip, rootFilePath, href);
    const document = resolveDocument(html);
    const chapterTitle = extractChapterTitle(document, `Capítulo ${index + 1}`);
    const chapterText = extractChapterText(document);
    if (!chapterText) {
      continue;
    }

    chapters.push({
      title: chapterTitle,
      text: chapterText,
      index,
    });
  }

  const pages = paginateChapters(entry.id, chapters);
  const timestamp = nowIso();
  const storedBook: StoredBook = {
    id: entry.id,
    file: entry.file,
    title: String(title || entry.file.replace(/\.epub$/i, '')),
    author: String(author || 'Autor desconhecido'),
    totalPages: pages.length,
    currentPageIndex: 0,
    progress: 0,
    totalReadingTimeMs: 0,
    totalWordsRead: 0,
    totalCharsRead: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  return {
    book: storedBook,
    pages,
  };
}
