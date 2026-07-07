import { Navigate, Route, Routes } from 'react-router-dom';
import { BooksPage } from './pages/BooksPage';
import { DashboardPage } from './pages/DashboardPage';
import { ReaderPage } from './pages/ReaderPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/livros" replace />} />
      <Route path="/livros" element={<BooksPage />} />
      <Route path="/livro/:livro" element={<ReaderPage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="*" element={<Navigate to="/livros" replace />} />
    </Routes>
  );
}
