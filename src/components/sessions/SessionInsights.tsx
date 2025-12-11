import clsx from 'clsx';
import type { ReactNode } from 'react';
import { Activity, Sparkles, Waves, TrendingUp, AlertCircle } from 'lucide-react';
import type { CoachingHighlight, SessionIssue, SessionMetricsSummary } from '@/types/sessions';

interface SessionInsightsProps {
  metrics: SessionMetricsSummary;
  issues: SessionIssue[];
  coachingHighlights?: CoachingHighlight[];
}

type Tone = 'positive' | 'caution' | 'risk';

type Insight = {
  title: string;
  value: string;
  detail: string;
  icon: ReactNode;
  tone: Tone;
};

const toneStyles: Record<Tone, string> = {
  positive: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-50',
  caution: 'border-amber-300/40 bg-amber-500/10 text-amber-50',
  risk: 'border-rose-400/40 bg-rose-500/10 text-rose-50',
};

function deriveInsights(metrics: SessionMetricsSummary): Insight[] {
  const paceBand = { min: 140, max: 160 };
  const paceTone: Tone = metrics.avgWpm > paceBand.max + 15 ? 'risk' : metrics.avgWpm > paceBand.max ? 'caution' : metrics.avgWpm < paceBand.min ? 'caution' : 'positive';
  const paceDetail =
    metrics.avgWpm > paceBand.max
      ? 'Above target band — build in brief pauses to lower pace.'
      : metrics.avgWpm < paceBand.min
      ? 'Below target band — tighten phrasing to keep attention.'
      : 'In a healthy band — maintain this cadence.';

  const fillerTone: Tone = metrics.fillerPerMinute > 4 ? 'risk' : metrics.fillerPerMinute > 2 ? 'caution' : 'positive';
  const fillerDetail =
    metrics.fillerPerMinute > 4
      ? 'High filler density — swap fillers for short breaths.'
      : metrics.fillerPerMinute > 2
      ? 'Moderate fillers — try a beat of silence instead.'
      : 'Low fillers — keep this clarity.';

  return [
    {
      title: 'Pace window',
      value: `${metrics.avgWpm.toFixed(0)} WPM`,
      detail: paceDetail,
      icon: <Activity className="h-5 w-5" />,
      tone: paceTone,
    },
    {
      title: 'Fillers per min',
      value: metrics.fillerPerMinute.toFixed(1),
      detail: fillerDetail,
      icon: <Waves className="h-5 w-5" />,
      tone: fillerTone,
    },
  ];
}

function topIssues(issues: SessionIssue[], limit = 3) {
  const severityOrder = { high: 0, medium: 1, low: 2 } as const;
  return [...issues]
    .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
    .slice(0, limit);
}

const HIGHLIGHT_SEVERITY_STYLES = {
  high: 'border-rose-400/30 bg-rose-500/10',
  medium: 'border-amber-300/30 bg-amber-500/10',
  low: 'border-emerald-300/30 bg-emerald-500/10',
};

export function SessionInsights({ metrics, issues, coachingHighlights }: SessionInsightsProps) {
  const insights = deriveInsights(metrics);
  
  const strengths = coachingHighlights?.filter((h) => h.type === 'strength') ?? [];
  const improvements = coachingHighlights?.filter((h) => h.type === 'improvement') ?? [];

  return (
    <div className="space-y-6">
      {/* Metrics Tiles */}
      <div className="grid gap-4 lg:grid-cols-2">
        {insights.map((insight) => (
          <div
            key={insight.title}
            className={clsx(
              'relative overflow-hidden rounded-2xl border px-4 py-4 shadow-soft transition hover:translate-y-[-1px] hover:shadow-lg',
              toneStyles[insight.tone],
            )}
          >
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.12em] text-white/80">{insight.title}</p>
              <span className="rounded-full bg-white/10 p-2 text-white/90">{insight.icon}</span>
            </div>
            <p className="mt-2 font-display text-2xl font-semibold text-white">{insight.value}</p>
            <p className="text-sm text-white/80">{insight.detail}</p>
            <div className="mt-3 flex items-center gap-2 text-xs text-white/70">
              <Sparkles className="h-4 w-4" />
              <span>Personalized from practice</span>
            </div>
          </div>
        ))}
      </div>

      {/* AI Coaching Summary */}
      {coachingHighlights && coachingHighlights.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="mb-4 flex items-center gap-2 text-sm text-slate-200">
            <Sparkles className="h-4 w-4 text-emerald-300" />
            <span className="uppercase tracking-[0.12em]">AI Coaching Summary</span>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Strengths */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-medium text-emerald-300">
                <TrendingUp className="h-4 w-4" />
                <span>What you did well</span>
              </div>
              {strengths.length > 0 ? (
                strengths.map((highlight, idx) => (
                  <div
                    key={`strength-${idx}`}
                    className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3"
                  >
                    <h4 className="font-medium text-emerald-100">{highlight.title}</h4>
                    <p className="mt-1 text-sm leading-relaxed text-slate-300">{highlight.detail}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-400">No specific strengths identified.</p>
              )}
            </div>

            {/* Areas for Improvement */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-medium text-amber-300">
                <AlertCircle className="h-4 w-4" />
                <span>Focus on improving</span>
              </div>
              {improvements.length > 0 ? (
                improvements.map((highlight, idx) => {
                  const severityStyle = highlight.severity
                    ? HIGHLIGHT_SEVERITY_STYLES[highlight.severity]
                    : 'border-amber-300/30 bg-amber-500/10';
                  return (
                    <div
                      key={`improvement-${idx}`}
                      className={clsx('rounded-xl border p-3', severityStyle)}
                    >
                      <h4 className="font-medium text-amber-100">{highlight.title}</h4>
                      <p className="mt-1 text-sm leading-relaxed text-slate-300">{highlight.detail}</p>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-slate-400">No specific improvements identified.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
