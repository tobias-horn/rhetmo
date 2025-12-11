// API Client for Rhetmo Backend
// Handles communication with Supabase Edge Functions

import { API_CONFIG, API_HEADERS } from './config';
import type { Session, SessionAnalysis, TranscriptSegment, TranscriptToken, Tag, SessionMetricsSummary, SessionIssue, CoachingHighlight } from '@/types/sessions';

// Raw API response types (may differ slightly from our internal types)
interface ApiSegment {
  id: string;
  startMs: number;
  endMs: number;
  kind: 'speech' | 'pause';
  text: string;
  tokens?: ApiToken[];
  tags?: ApiTag[];
}

interface ApiToken {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  tags: ApiTag[];
}

interface ApiTag {
  id: string;
  kind: string;
  severity?: 'low' | 'medium' | 'high';
  label?: string;
  data?: any;
}

interface ApiMetrics {
  durationSec: number;
  totalWords: number;
  avgWpm: number;
  fillerCount: number;
  fillerPerMinute: number;
  avgHeartRate?: number | null;
  peakHeartRate?: number | null;
  movementScore?: number | null;
  stressSpeedIndex?: number | null;
}

interface ApiIssue {
  id: string;
  kind: string;
  severity: 'low' | 'medium' | 'high';
  message: string;
  segmentIds: string[];
  tokenIds?: string[];
}

interface ApiCoachingHighlight {
  type: 'strength' | 'improvement';
  title: string;
  detail: string;
  severity?: 'low' | 'medium' | 'high';
}

interface ApiAnalysis {
  segments: ApiSegment[];
  metrics?: ApiMetrics;
  issues?: ApiIssue[];
  coachingHighlights?: ApiCoachingHighlight[];
}

// Live session response (quick-worker) - full session object
interface ApiLiveSessionResponse {
  id: string;
  userId: string;
  title: string;
  mode: string;
  context: string;
  createdAt: string;
  startedAt: string;
  endedAt: string | null;
  durationSec: number;
  audioUrl: string | null;
  analysisStatus: string;
  analysis: ApiAnalysis;
}

interface ApiAnalyzedSessionResponse {
  segments: ApiSegment[];
  metrics?: ApiMetrics;
  issues?: ApiIssue[];
  coachingHighlights?: ApiCoachingHighlight[];
}

// Conversation list response (dynamic-handler)
interface ApiConversationEntry {
  conversation_id: string;
  timestamp: number;
  status: 'recording' | 'processing' | 'finished';
}

/**
 * Transform API tag to internal Tag type
 */
function transformTag(apiTag: ApiTag): Tag {
  return {
    id: apiTag.id,
    kind: apiTag.kind as Tag['kind'],
    severity: apiTag.severity ?? 'low',
    label: apiTag.label ?? apiTag.kind,
    data: apiTag.data,
  };
}

/**
 * Transform API token to internal TranscriptToken type
 */
function transformToken(apiToken: ApiToken): TranscriptToken {
  return {
    id: apiToken.id,
    startMs: apiToken.startMs,
    endMs: apiToken.endMs,
    text: apiToken.text,
    tags: (apiToken.tags ?? []).map(transformTag),
  };
}

/**
 * Transform API segment to internal TranscriptSegment type
 */
function transformSegment(apiSegment: ApiSegment): TranscriptSegment {
  if (apiSegment.kind === 'pause') {
    return {
      id: apiSegment.id,
      startMs: apiSegment.startMs,
      endMs: apiSegment.endMs,
      kind: 'pause',
      text: apiSegment.text || '',
      tags: (apiSegment.tags ?? []).map(transformTag),
    };
  }

  return {
    id: apiSegment.id,
    startMs: apiSegment.startMs,
    endMs: apiSegment.endMs,
    kind: 'speech',
    text: apiSegment.text,
    tokens: (apiSegment.tokens ?? []).map(transformToken),
    tags: (apiSegment.tags ?? []).map(transformTag),
  };
}

/**
 * Transform API metrics to internal SessionMetricsSummary type
 */
function transformMetrics(apiMetrics?: ApiMetrics): SessionMetricsSummary {
  if (!apiMetrics) {
    return {
      durationSec: 0,
      totalWords: 0,
      avgWpm: 0,
      fillerCount: 0,
      fillerPerMinute: 0,
    };
  }

  return {
    durationSec: apiMetrics.durationSec,
    totalWords: apiMetrics.totalWords,
    avgWpm: apiMetrics.avgWpm,
    fillerCount: apiMetrics.fillerCount,
    fillerPerMinute: apiMetrics.fillerPerMinute,
    avgHeartRate: apiMetrics.avgHeartRate ?? undefined,
    peakHeartRate: apiMetrics.peakHeartRate ?? undefined,
    movementScore: apiMetrics.movementScore ?? undefined,
    stressSpeedIndex: apiMetrics.stressSpeedIndex ?? undefined,
  };
}

/**
 * Transform API issue to internal SessionIssue type
 */
function transformIssue(apiIssue: ApiIssue): SessionIssue {
  return {
    id: apiIssue.id,
    kind: apiIssue.kind as SessionIssue['kind'],
    severity: apiIssue.severity,
    message: apiIssue.message,
    segmentIds: apiIssue.segmentIds,
    tokenIds: apiIssue.tokenIds,
  };
}

/**
 * Transform API coaching highlight to internal CoachingHighlight type
 */
function transformCoachingHighlight(apiHighlight: ApiCoachingHighlight): CoachingHighlight {
  return {
    type: apiHighlight.type,
    title: apiHighlight.title,
    detail: apiHighlight.detail,
    severity: apiHighlight.severity,
  };
}

/**
 * Transform full API analysis to internal SessionAnalysis type
 */
function transformAnalysis(apiAnalysis: ApiAnalysis): SessionAnalysis {
  return {
    segments: apiAnalysis.segments.map(transformSegment),
    metrics: transformMetrics(apiAnalysis.metrics),
    issues: (apiAnalysis.issues ?? []).map(transformIssue),
    coachingHighlights: apiAnalysis.coachingHighlights?.map(transformCoachingHighlight),
  };
}

/**
 * Fetch live session data (in-progress recording)
 * Uses quick-worker endpoint
 */
export async function fetchLiveSession(): Promise<Session | null> {
  try {
    const response = await fetch(`${API_CONFIG.baseUrl}/quick-worker`, {
      method: 'POST',
      headers: API_HEADERS,
      body: JSON.stringify({ name: 'Functions' }),
    });

    if (!response.ok) {
      console.error('Failed to fetch live session:', response.status, response.statusText);
      return null;
    }

    const data: ApiLiveSessionResponse = await response.json();
    
    // Transform to internal Session type
    const session: Session = {
      id: data.id,
      userId: data.userId || 'user-live',
      title: data.title,
      mode: (data.mode as Session['mode']) || 'practice',
      context: (data.context as Session['context']) || 'other',
      createdAt: data.createdAt,
      startedAt: data.startedAt,
      endedAt: data.endedAt ?? undefined,
      durationSec: data.durationSec,
      audioUrl: data.audioUrl,
      analysisStatus: data.analysisStatus as Session['analysisStatus'],
      analysis: data.analysis ? transformAnalysis(data.analysis) : undefined,
    };

    return session;
  } catch (error) {
    console.error('Error fetching live session:', error);
    return null;
  }
}

/**
 * Fetch analyzed session data (completed analysis)
 * Uses quick-handler endpoint
 * @param conversationId - Optional conversation ID to fetch specific session
 */
export async function fetchAnalyzedSession(conversationId?: string): Promise<SessionAnalysis | null> {
  try {
    const body = conversationId 
      ? { conversation_id: conversationId }
      : { name: 'Functions' };
    
    const response = await fetch(`${API_CONFIG.baseUrl}/quick-handler`, {
      method: 'POST',
      headers: API_HEADERS,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.error('Failed to fetch analyzed session:', response.status, response.statusText);
      return null;
    }

    const data: ApiAnalyzedSessionResponse = await response.json();
    
    return {
      segments: data.segments.map(transformSegment),
      metrics: transformMetrics(data.metrics),
      issues: (data.issues ?? []).map(transformIssue),
      coachingHighlights: data.coachingHighlights?.map(transformCoachingHighlight),
    };
  } catch (error) {
    console.error('Error fetching analyzed session:', error);
    return null;
  }
}

/**
 * Check if there's an active recording session
 * TODO: Implement when status endpoint is ready
 */
export async function checkRecordingStatus(): Promise<{
  isRecording: boolean;
  hasNewAnalysis: boolean;
  sessionId?: string;
}> {
  // Placeholder - will be implemented when status endpoint is provided
  return {
    isRecording: false,
    hasNewAnalysis: false,
  };
}

/**
 * Fetch list of all conversations from dynamic-handler
 */
export async function fetchAllConversations(): Promise<ApiConversationEntry[]> {
  try {
    const response = await fetch(`${API_CONFIG.baseUrl}/dynamic-handler`, {
      method: 'POST',
      headers: API_HEADERS,
      body: JSON.stringify({ name: 'Functions' }),
    });

    if (!response.ok) {
      console.error('Failed to fetch conversations:', response.status, response.statusText);
      return [];
    }

    const data: ApiConversationEntry[] = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching conversations:', error);
    return [];
  }
}

/**
 * Delete a session/conversation by ID
 */
export async function deleteSession(conversationId: string): Promise<boolean> {
  try {
    console.log('Deleting session:', conversationId);
    // Note: delete-function endpoint doesn't allow 'apikey' header in CORS
    // Using only Authorization header
    const response = await fetch(`${API_CONFIG.baseUrl}/delete-function`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_CONFIG.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        name: 'Functions',
        conversation_id: conversationId 
      }),
    });

    const responseText = await response.text();
    console.log('Delete response:', response.status, responseText);

    if (!response.ok) {
      console.error('Failed to delete session:', response.status, response.statusText, responseText);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error deleting session:', error);
    return false;
  }
}

// Export types for use in data layer
export type { ApiConversationEntry };
