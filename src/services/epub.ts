import type { BookExtractionResult, BookChapter, CatalogBook, StoredBook, StoredPageContent } from '../models/types';
import { countCharacters, countWords, createPageText, extractFirstHeading, normalizeText, splitIntoSentenceChunks } from '../utils/text';
import { nowIso } from '../utils/date';

// === Configurações de visualização === //
// Ajuste estes valores para mudar a aparência da leitura
export const PAGINATION_VERSION = 6;
export const READER_CONFIG = {
  // Número de palavras por página (afeta quanto texto é mostrado)
  wordsPerPage: 300,
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

interface ManifestEntry {
  href: string;
  mediaType: string;
  properties: string;
}

function parseOpfMetadata(opfXml: string) {
  const titleMatch = opfXml.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i);
  const creatorMatch = opfXml.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i);
  const dateMatch = opfXml.match(/<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i);
  const coverMetaMatch = opfXml.match(/<meta[^>]+name="cover"[^>]+content="([^"]+)"/i);
  const title = titleMatch ? stripTags(titleMatch[1]) : '';
  const author = creatorMatch ? stripTags(creatorMatch[1]) : '';
  const publishedAt = dateMatch ? stripTags(dateMatch[1]) : '';
  const publicationYear = publishedAt.match(/\b(\d{4})\b/)?.[1] ?? '';
  return { title, author, publishedAt, publicationYear, coverId: coverMetaMatch?.[1] ?? '' };
}

function parseManifestAndSpine(opfXml: string) {
  const manifest = new Map<string, ManifestEntry>();
  const itemMatches = Array.from(opfXml.matchAll(/<item\b[^>]*>/gi));
  itemMatches.forEach((match) => {
    const block = match[0];
    const idMatch = block.match(/id="([^"]+)"/i);
    const hrefMatch = block.match(/href="([^"]+)"/i);
    const mediaTypeMatch = block.match(/media-type="([^"]+)"/i);
    const propertiesMatch = block.match(/properties="([^"]+)"/i);
    if (!idMatch || !hrefMatch) {
      return;
    }

    manifest.set(idMatch[1], {
      href: hrefMatch[1],
      mediaType: mediaTypeMatch?.[1] ?? '',
      properties: propertiesMatch?.[1] ?? '',
    });
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

  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
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

function readZipBytes(zip: ZipEntries, path: string) {
  const entry = getZipEntry(zip, path);
  return entry ? entry : null;
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

function guessMimeType(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (lower.endsWith('.png')) {
    return 'image/png';
  }
  if (lower.endsWith('.gif')) {
    return 'image/gif';
  }
  if (lower.endsWith('.webp')) {
    return 'image/webp';
  }
  if (lower.endsWith('.svg') || lower.endsWith('.svgz')) {
    return 'image/svg+xml';
  }
  return 'image/jpeg';
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function bytesToDataUrl(bytes: Uint8Array, path: string) {
  const mimeType = guessMimeType(path);
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

async function extractInlineImageFromDocument(
  zip: ZipEntries,
  document: Document | null,
  basePath: string,
) {
  if (!document) {
    return null;
  }

  const image = document.querySelector('img[src]');
  const src = image?.getAttribute('src')?.trim();
  if (!src || src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) {
    return src?.startsWith('data:') ? src : null;
  }

  const resolvedPath = resolveZipPath(basePath, src);
  const bytes = readZipBytes(zip, resolvedPath);
  if (!bytes) {
    return null;
  }

  return bytesToDataUrl(bytes, resolvedPath);
}

async function extractCoverImage(
  zip: ZipEntries,
  rootFilePath: string,
  manifest: Map<string, ManifestEntry>,
  spineIds: string[],
  coverId: string,
) {
  const seen = new Set<string>();
  const candidates: string[] = [];

  if (coverId) {
    const coverEntry = manifest.get(coverId);
    if (coverEntry?.href) {
      candidates.push(resolveZipPath(rootFilePath, coverEntry.href));
    }
  }

  manifest.forEach((entry, id) => {
    if (entry.mediaType.startsWith('image/') && (entry.properties.includes('cover-image') || id === coverId)) {
      candidates.push(resolveZipPath(rootFilePath, entry.href));
    }
  });

  manifest.forEach((entry) => {
    if (entry.mediaType.startsWith('image/')) {
      candidates.push(resolveZipPath(rootFilePath, entry.href));
    }
  });

  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    const bytes = readZipBytes(zip, candidate);
    if (bytes) {
      return bytesToDataUrl(bytes, candidate);
    }
  }

  for (const idref of spineIds) {
    const entry = manifest.get(idref);
    if (!entry) {
      continue;
    }

    const html = await readZipText(zip, resolveZipPath(rootFilePath, entry.href));
    const document = resolveDocument(html);
    const inlineCover = await extractInlineImageFromDocument(zip, document, resolveZipPath(rootFilePath, entry.href));
    if (inlineCover) {
      return inlineCover;
    }
  }

  return null;
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
  const baseUrl = import.meta.env.BASE_URL;
  const candidatePaths = [
    `${baseUrl}epubs/${encodeURI(entry.file)}`,
    `${baseUrl}livros/${encodeURI(entry.file)}`,
  ];

  let zip: ZipEntries | null = null;

  for (const fileUrl of candidatePaths) {
    try {
      zip = await loadEpubArchive(fileUrl);
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
  const { title, author, publicationYear, coverId } = parseOpfMetadata(opfXml);
  const { manifest, spineIds } = parseManifestAndSpine(opfXml);

  const chapters: BookChapter[] = [];
  for (let index = 0; index < spineIds.length; index += 1) {
    const idref = spineIds[index];
    const href = manifest.get(idref)?.href;
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
  const cover = await extractCoverImage(zip, rootFilePath, manifest, spineIds, coverId);
  const timestamp = nowIso();
  const storedBook: StoredBook = {
    id: entry.id,
    file: entry.file,
    title: String(title || entry.file.replace(/\.epub$/i, '')),
    author: String(author || 'Autor desconhecido'),
    cover: cover ?? undefined,
    publicationYear: publicationYear || undefined,
    paginationVersion: PAGINATION_VERSION,
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
