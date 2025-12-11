import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Flame, Plus } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { SessionList } from '@/components/sessions/SessionList';
import { listSessions } from '@/data/sessions';
import { deleteSession } from '@/api';
import type { Session } from '@/types/sessions';

export function DashboardPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    listSessions().then((data) => {
      if (isMounted) {
        setSessions(data);
        setLoading(false);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const highlights = useMemo(() => {
    const ready = sessions.filter((s) => s.analysisStatus === 'ready');
    const fillerAvg =
      ready.reduce((acc, s) => acc + (s.analysis?.metrics.fillerPerMinute ?? 0), 0) /
      Math.max(ready.length, 1);
    const paceAvg =
      ready.reduce((acc, s) => acc + (s.analysis?.metrics.avgWpm ?? 0), 0) /
      Math.max(ready.length, 1);
    return { readyCount: ready.length, fillerAvg, paceAvg };
  }, [sessions]);

  const handleDeleteSession = async (sessionId: string) => {
    const success = await deleteSession(sessionId);
    if (success) {
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    }
  };

  return (
    <AppShell
      title="Coaching sessions"
      subtitle="Practice and live sessions with analysis stitched from your phone and watch"
      actions={
        <button 
          onClick={() => navigate('/practice')}
          className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-soft transition hover:bg-emerald-400"
        >
          <Plus className="h-4 w-4" />
          New practice
        </button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="glass-panel relative overflow-hidden rounded-3xl p-6 lg:col-span-2">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-amber-400/5 to-transparent" />
          <div className="relative flex flex-col gap-3 text-slate-100">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-emerald-100/70">
              <Flame className="h-4 w-4" />
              Consistency pays off
            </div>
            <h2 className="font-display text-2xl font-semibold">Keep tightening pace, fillers, and calmness.</h2>
            <p className="text-slate-300">
              Your latest practice sessions sync audio, transcript, and watch signals. Use the detail view to
              replay, highlight fillers, and set live guardrails.
            </p>
            <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-100">
              <HighlightPill label="Ready analyses">{highlights.readyCount} ready</HighlightPill>
              <HighlightPill label="Avg fillers/min">{highlights.fillerAvg.toFixed(1)}</HighlightPill>
              <HighlightPill label="Avg pace">{highlights.paceAvg.toFixed(0)} WPM</HighlightPill>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-white/5 bg-white/5 p-5 text-sm text-slate-200">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-[0.15em] text-slate-400">Next steps</span>
            <ArrowRight className="h-4 w-4 text-emerald-200" />
          </div>
          <ul className="mt-3 space-y-2 text-slate-100">
            <li>• Review fillers clusters in your last pitch.</li>
            <li>• Set target pace band for live talks.</li>
            <li>• Try one live guardrail on your next update.</li>
          </ul>
        </div>
      </div>

      {loading ? (
        <div className="rounded-3xl border border-white/5 bg-white/5 p-6 text-slate-200">Loading sessions…</div>
      ) : (
        <SessionList sessions={sessions} onDelete={handleDeleteSession} />
      )}
    </AppShell>
  );
}

function HighlightPill({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="tag-pill bg-white/10 text-white shadow-soft">
      <span className="text-emerald-200">{children}</span>
      <span className="text-slate-200/80">{label}</span>
    </span>
  );
}
