import { createFallbackCover } from '../services/epub';

interface BookCoverProps {
  title: string;
  author: string;
  cover?: string;
}

export function BookCover({ title, author, cover }: BookCoverProps) {
  if (cover) {
    return <img className="book-cover" src={cover} alt={`Capa de ${title}`} />;
  }

  return (
    <div className="book-cover book-cover-fallback" aria-label={`Capa de ${title}`}>
      <span>{createFallbackCover(title)}</span>
      <small>{author}</small>
    </div>
  );
}
