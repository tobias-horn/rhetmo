export type TagKind =
  | 'filler'
  | 'fast'
  | 'slow'
  | 'long_pause'
  | 'hedging'
  | 'complex_sentence'
  | 'unclear_point'
  | 'good_emphasis'
  | 'structure';

export type TagSeverity = 'low' | 'medium' | 'high';

export type Tag = {
  id: string;
  kind: TagKind;
  severity: TagSeverity;
  label: string; // e.g. "Filler word", "Too fast"
  data?: any; // optional extra info, e.g. { wpm: 190 }
};

export type TranscriptToken = {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  tags: Tag[];
};

export type SpeechSegment = {
  id: string;
  startMs: number;
  endMs: number;
  kind: 'speech';
  text: string;
  tokens: TranscriptToken[];
  tags: Tag[];
};

export type PauseSegment = {
  id: string;
  startMs: number;
  endMs: number;
  kind: 'pause';
  text: string;
  tokens?: undefined;
  tags: Tag[];
};

export type TranscriptSegment = SpeechSegment | PauseSegment;

export type SessionMetricsSummary = {
  durationSec: number;
  totalWords: number;
  avgWpm: number;
  fillerCount: number;
  fillerPerMinute: number;
  avgHeartRate?: number;
  peakHeartRate?: number;
  movementScore?: number; // 0–1 normalized
  stressSpeedIndex?: number;
};

export type SessionIssue = {
  id: string;
  kind:
    | 'filler_cluster'
    | 'fast_segment'
    | 'slow_segment'
    | 'long_pause'
    | 'hedging'
    | 'structure'
    | 'clarity';
  severity: TagSeverity;
  message: string;
  segmentIds: string[];
  tokenIds?: string[];
};

export type CoachingHighlight = {
  type: 'strength' | 'improvement';
  title: string;
  detail: string;
  severity?: TagSeverity;
};

export type SessionAnalysis = {
  segments: TranscriptSegment[];
  metrics: SessionMetricsSummary;
  issues: SessionIssue[];
  coachingHighlights?: CoachingHighlight[];
};

export type SessionMode = 'practice' | 'live';

export type SessionContext =
  | 'pitch'
  | 'interview'
  | 'meeting'
  | 'exam'
  | 'language_practice'
  | 'other';

export type Session = {
  id: string;
  userId: string;
  title: string;
  mode: SessionMode;
  context: SessionContext;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  durationSec?: number;
  audioUrl?: string | null;
  analysisStatus: 'pending' | 'processing' | 'ready' | 'failed';
  analysis?: SessionAnalysis;
};
