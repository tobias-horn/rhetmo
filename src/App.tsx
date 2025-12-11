import { Navigate, Route, Routes } from 'react-router-dom';
import { DashboardPage } from './pages/DashboardPage';
import { GoalsPage } from './pages/GoalsPage';
import { LiveGuardrailsPage } from './pages/LiveGuardrailsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PracticePage } from './pages/PracticePage';
import { SessionDetailPage } from './pages/SessionDetailPage';
import { SettingsPage } from './pages/SettingsPage';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/practice" element={<PracticePage />} />
      <Route path="/sessions/:id" element={<SessionDetailPage />} />
      <Route path="/goals" element={<GoalsPage />} />
      <Route path="/live" element={<LiveGuardrailsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export default App;
