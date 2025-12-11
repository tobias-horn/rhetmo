import { useState } from 'react';
import { ArrowRight, Clock, HeartPulse, MoreVertical, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SessionContextBadge } from './SessionContextBadge';
import { SessionStatusBadge } from './SessionStatusBadge';
import type { Session } from '@/types/sessions';

function formatDate(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface SessionListItemProps {
  session: Session;
  onDelete?: (sessionId: string) => void;
}

export function SessionListItem({ session, onDelete }: SessionListItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const metrics = session.analysis?.metrics;
  const duration = metrics?.durationSec ?? session.durationSec;
  const avgWpm = metrics?.avgWpm;
  const fillerPerMinute = metrics?.fillerPerMinute;
  const avgHeartRate = metrics?.avgHeartRate;

  const handleMenuClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(!menuOpen);
    setConfirmDelete(false);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirmDelete(true);
  };

  const handleConfirmDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDelete?.(session.id);
    setMenuOpen(false);
    setConfirmDelete(false);
  };

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirmDelete(false);
    setMenuOpen(false);
  };

  return (
    <Link
      to={`/sessions/${session.id}`}
      className="group relative block overflow-hidden rounded-2xl border border-white/5 bg-white/5 p-5 transition hover:border-emerald-400/40 hover:bg-white/8"
    >
      {/* Three-dots menu button */}
      <button
        onClick={handleMenuClick}
        className="absolute right-3 top-3 z-10 rounded-lg p-2 text-slate-400 opacity-0 transition hover:bg-white/10 hover:text-white group-hover:opacity-100"
        aria-label="Session options"
      >
        <MoreVertical className="h-5 w-5" />
      </button>

      {/* Dropdown menu */}
      {menuOpen && (
        <div
          className="absolute right-3 top-12 z-20 min-w-[160px] overflow-hidden rounded-xl border border-white/10 bg-slate-800/95 shadow-xl backdrop-blur-xl"
          onClick={(e) => e.stopPropagation()}
        >
          {confirmDelete ? (
            <div className="p-3">
              <p className="mb-3 text-sm text-slate-300">Delete this session?</p>
              <div className="flex gap-2">
                <button
                  onClick={handleCancelDelete}
                  className="flex-1 rounded-lg bg-white/10 px-3 py-2 text-xs font-medium text-white transition hover:bg-white/20"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmDelete}
                  className="flex-1 rounded-lg bg-red-500/80 px-3 py-2 text-xs font-medium text-white transition hover:bg-red-500"
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={handleDeleteClick}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-red-400 transition hover:bg-white/5"
            >
              <Trash2 className="h-4 w-4" />
              Delete session
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <img src="/brand/rhetmoIcon.svg" alt="Rhetmo icon" className="h-10 w-10" />
          <div>
            <p className="font-display text-lg font-semibold text-white">{session.title}</p>
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <Clock className="h-4 w-4" />
              <span>{formatDate(session.createdAt)}</span>
            </div>
          </div>
        </div>
        <SessionStatusBadge status={session.analysisStatus} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <SessionContextBadge context={session.context} />
        <span className="tag-pill bg-slate-500/15 text-slate-200">
          {session.mode === 'practice' ? 'Practice' : 'Live'}
        </span>
        {metrics ? (
          <span className="tag-pill bg-amber-500/15 text-amber-200">{Math.round(metrics.avgWpm)} WPM avg</span>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-200 sm:grid-cols-4">
        <div className="rounded-xl border border-white/5 bg-white/5 px-3 py-2">
          <p className="text-xs uppercase tracking-[0.12em] text-slate-400">Duration</p>
          <p className="font-semibold text-white">{duration !== undefined ? `${duration}s` : '—'}</p>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/5 px-3 py-2">
          <p className="text-xs uppercase tracking-[0.12em] text-slate-400">Avg WPM</p>
          <p className="font-semibold text-white">{avgWpm !== undefined ? avgWpm.toFixed(1) : '—'}</p>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/5 px-3 py-2">
          <p className="text-xs uppercase tracking-[0.12em] text-slate-400">Fillers/min</p>
          <p className="font-semibold text-white">
            {fillerPerMinute !== undefined ? fillerPerMinute.toFixed(1) : '—'}
          </p>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/5 px-3 py-2">
          <p className="text-xs uppercase tracking-[0.12em] text-slate-400">Avg HR</p>
          <div className="flex items-center gap-2">
            <HeartPulse className="h-4 w-4 text-emerald-300" />
            <p className="font-semibold text-white">
              {avgHeartRate !== undefined ? `${avgHeartRate} bpm` : '—'}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 text-xs text-emerald-100/80 opacity-0 transition group-hover:opacity-100">
        <ArrowRight className="h-4 w-4" />
        <span>Dive into transcript</span>
      </div>
    </Link>
  );
}
