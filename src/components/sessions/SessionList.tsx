import { Activity } from 'lucide-react';
import type { Session } from '@/types/sessions';
import { SessionListItem } from './SessionListItem';

interface SessionListProps {
  sessions: Session[];
  onDelete?: (sessionId: string) => void;
}

export function SessionList({ sessions, onDelete }: SessionListProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-slate-300">
        <Activity className="h-4 w-4 text-emerald-300" />
        <span>{sessions.length} sessions</span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {sessions.map((session) => (
          <SessionListItem key={session.id} session={session} onDelete={onDelete} />
        ))}
      </div>
    </div>
  );
}
