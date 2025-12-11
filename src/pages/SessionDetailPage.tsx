import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { IssuesPanel } from '@/components/sessions/IssuesPanel';
import { MetricsPanel } from '@/components/sessions/MetricsPanel';
import { SessionInsights } from '@/components/sessions/SessionInsights';
import { SessionHeaderCard } from '@/components/sessions/SessionHeaderCard';
import { TranscriptViewer } from '@/components/sessions/TranscriptViewer';
import type { ViewMode } from '@/components/sessions/ViewModeToggle';
import { fetchSessionById } from '@/data/sessions';
import { deleteSession } from '@/api';
import type { Session } from '@/types/sessions';

export function SessionDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | undefined>();
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('default');
  const [activeSegmentId, setActiveSegmentId] = useState<string | undefined>();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchSessionById(id).then((data) => {
      setSession(data);
      setLoading(false);
    });
  }, [id]);

  const handleDelete = async () => {
    if (!id) return;
    setDeleting(true);
    const success = await deleteSession(id);
    if (success) {
      navigate('/');
    } else {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  if (!id) {
    return <AppShell title="Session" subtitle="Missing ID">Invalid session id.</AppShell>;
  }

  if (loading) {
    return (
      <AppShell title="Loading session" subtitle="Fetching analysis">
        <div className="rounded-3xl border border-white/5 bg-white/5 p-6 text-slate-200">Loading session…</div>
      </AppShell>
    );
  }

  if (!session) {
    return (
      <AppShell title="Session" subtitle="Not found">
        <div className="rounded-3xl border border-white/5 bg-white/5 p-6 text-slate-200">Session not found.</div>
      </AppShell>
    );
  }

  const metrics = session.analysis?.metrics;
  const issues = session.analysis?.issues ?? [];
  const coachingHighlights = session.analysis?.coachingHighlights ?? [];
  const hasAnalysis = session.analysisStatus === 'ready' && !!session.analysis;

  return (
    <AppShell
      title={session.title}
      subtitle={`${session.context} • ${session.mode}`}
      actions={null}
    >
      <SessionHeaderCard session={session} />

      {hasAnalysis ? (
        <SessionInsights metrics={metrics!} issues={issues} coachingHighlights={coachingHighlights} />
      ) : (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-4 text-sm text-slate-300">
          Analysis pending — insights will unlock once processing finishes.
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm uppercase tracking-[0.15em] text-slate-400">Transcript & highlights</h2>
          </div>
          <TranscriptViewer
            session={session}
            activeView={viewMode}
            onViewChange={setViewMode}
            activeSegmentId={activeSegmentId}
            onSegmentClick={setActiveSegmentId}
          />
        </div>

        <div className="space-y-4">
          {hasAnalysis && metrics ? <MetricsPanel metrics={metrics} /> : null}
          {issues.length ? (
            <IssuesPanel issues={issues} onIssueClick={(_, segments) => setActiveSegmentId(segments[0])} />
          ) : (
            <div className="rounded-2xl border border-white/5 bg-white/5 p-4 text-sm text-slate-300">
              No issues flagged for this session yet.
            </div>
          )}
        </div>
      </div>

      {/* Delete Session Section */}
      <div className="mt-12 border-t border-white/5 pt-8">
        <div className="flex flex-col items-center justify-center gap-4">
          {showDeleteConfirm ? (
            <div className="flex flex-col items-center gap-4 rounded-2xl border border-red-500/20 bg-red-500/5 p-6">
              <p className="text-center text-sm text-slate-300">
                Are you sure you want to delete this session?<br />
                <span className="text-red-400">This action cannot be undone.</span>
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deleting}
                  className="rounded-xl border border-white/10 bg-white/5 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-white/10 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex items-center gap-2 rounded-xl bg-red-500/80 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  {deleting ? 'Deleting...' : 'Delete Session'}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-5 py-2.5 text-sm font-medium text-red-400 transition hover:border-red-500/40 hover:bg-red-500/10"
            >
              <Trash2 className="h-4 w-4" />
              Delete this session
            </button>
          )}
        </div>
      </div>
    </AppShell>
  );
}
