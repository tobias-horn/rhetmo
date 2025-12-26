// supabase/functions/analyze-speech/index.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const OPENAI_KEY = Deno.env.get('OPENAI_KEY')!;
const OPENAI_API = 'https://api.openai.com/v1/chat/completions';

// Model selection strategy:
// - MODEL_NANO: Fast & cheap. Use for classification, tagging, simple extraction
//   Examples: punctuation, segmentation, filler detection, pace classification, title generation
// - MODEL_MINI: Slower but smarter. Use ONLY for tasks requiring reasoning/advice
//   Examples: overall issues analysis, coaching highlights (actionable advice)
const MODEL_NANO = 'gpt-5-nano-2025-08-07';
const MODEL_MINI = 'gpt-5-mini-2025-08-07';

// --- Interface Definitions ---
interface Token {
  id: string;
  conversation_id: string;
  start_ms: number;
  end_ms: number;
  text: string;
  tags: string[];
  created_at: string;
}

interface Tag {
  id: string;
  kind: string;
  severity: 'low' | 'medium' | 'high';
  label: string;
  data?: Record<string, any>;
}


interface TokenWithTags {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  tags: Tag[];
}

interface SegmentAnalysis {
  id: string;
  startMs: number;
  endMs: number;
  kind: 'speech' | 'pause';
  text: string;
  tokens: TokenWithTags[];
  tags: Tag[];
}

interface Issue {
  id: string;
  kind: string;
  severity: 'low' | 'medium' | 'high';
  message: string;
  segmentIds: string[];
  tokenIds?: string[];
  segmentIndices?: number[];
}

interface Metrics {
  durationSec: number;
  totalWords: number;
  avgWpm: number;
  fillerCount: number;
  fillerPerMinute: number;
  avgHeartRate: number;
  peakHeartRate: number;
  movementScore: number;
  stressSpeedIndex: number;
}

// AI-generated coaching summary for the entire presentation
interface CoachingHighlight {
  type: 'strength' | 'improvement';
  title: string;
  detail: string;
  severity?: 'low' | 'medium' | 'high';
}

// Detailed timing breakdown for performance debugging
interface AnalysisTiming {
  totalMs: number;
  tokenFetchMs: number;
  punctuationMs: number;
  segmentationMs: number;
  segmentAnalysisMs: number;
  metricsMs: number;
  aiCallsMs: number; // Combined time for all parallel AI calls
  storageUploadMs: number;
  tokenCount: number;
  segmentCount: number;
  wordCount: number;
  analyzedAt: string; // ISO timestamp
}

interface AnalysisResult {
  title: string;
  segments: SegmentAnalysis[];
  metrics: Metrics;
  issues: Issue[];
  coachingHighlights: CoachingHighlight[];
  analysisTiming?: AnalysisTiming; // Performance data for debugging
}

// For content-based splitting
interface ContentSegmentDef {
  startIndex: number;
  endIndex: number;
}

// --- OpenAI Utility ---
async function callOpenAI(
  prompt: string, 
  model: string = MODEL_MINI
): Promise<string> {
  const response = await fetch(OPENAI_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      // Force JSON output to minimize parsing errors
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }

  const data = await response.json();

  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error(`Invalid OpenAI response: ${JSON.stringify(data)}`);
  }

  return data.choices[0].message.content;
}

// --- Utility: Identify pauses based on timing ---
// Split on pauses of 2+ seconds for better segmentation
function identifyPauses(
  tokens: Token[],
  minPauseMs = 2000
): { start: number; end: number; durationMs: number }[] {
  const pauses: { start: number; end: number; durationMs: number }[] = [];

  for (let i = 0; i < tokens.length - 1; i++) {
    const gap = tokens[i + 1].start_ms - tokens[i].end_ms;
    if (gap >= minPauseMs) {
      pauses.push({
        start: tokens[i].end_ms,
        end: tokens[i + 1].start_ms,
        durationMs: gap,
      });
    }
  }

  return pauses;
}

// --- Dynamic segmentation with max duration ---
// Segments have a max of 25 seconds. Pause threshold decreases as segment gets longer.
const MAX_SEGMENT_DURATION_MS = 25000; // 25 seconds max
const LONG_SEGMENT_THRESHOLD_MS = 20000; // After 20s, use shorter pause threshold
const BASE_PAUSE_THRESHOLD_MS = 2000; // Normal: 2 second pause = new segment
const REDUCED_PAUSE_THRESHOLD_MS = 1000; // After 20s: 1 second pause = new segment

function splitIntoSegmentsDynamic(
  tokens: Token[]
): { segments: Token[][]; pauses: { start: number; end: number; durationMs: number }[] } {
  if (tokens.length === 0) {
    return { segments: [], pauses: [] };
  }

  const segments: Token[][] = [];
  const pauses: { start: number; end: number; durationMs: number }[] = [];
  let currentSegment: Token[] = [];
  let segmentStartMs = tokens[0].start_ms;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const currentDurationMs = token.end_ms - segmentStartMs;
    
    // Determine the pause threshold based on current segment duration
    // After 20 seconds, be more aggressive about splitting (1s pause instead of 2s)
    const pauseThreshold = currentDurationMs >= LONG_SEGMENT_THRESHOLD_MS 
      ? REDUCED_PAUSE_THRESHOLD_MS 
      : BASE_PAUSE_THRESHOLD_MS;

    // Check if we need to force-split due to max duration
    const wouldExceedMax = currentDurationMs >= MAX_SEGMENT_DURATION_MS;
    
    // Check for pause to next token
    let hasSignificantPause = false;
    let pauseInfo: { start: number; end: number; durationMs: number } | null = null;
    
    if (i < tokens.length - 1) {
      const gap = tokens[i + 1].start_ms - token.end_ms;
      if (gap >= pauseThreshold) {
        hasSignificantPause = true;
        pauseInfo = {
          start: token.end_ms,
          end: tokens[i + 1].start_ms,
          durationMs: gap,
        };
      }
    }

    currentSegment.push(token);

    // Split if: significant pause OR max duration exceeded
    const shouldSplit = hasSignificantPause || wouldExceedMax;
    
    if (shouldSplit && currentSegment.length > 0 && i < tokens.length - 1) {
      segments.push(currentSegment);
      
      // Record pause if there was one
      if (pauseInfo) {
        pauses.push(pauseInfo);
      } else if (wouldExceedMax) {
        // Create a synthetic "pause" marker for duration-based splits
        // This helps the UI show where the split happened
        pauses.push({
          start: token.end_ms,
          end: tokens[i + 1].start_ms,
          durationMs: tokens[i + 1].start_ms - token.end_ms,
        });
      }
      
      currentSegment = [];
      segmentStartMs = tokens[i + 1].start_ms;
    }
  }

  // Don't forget the last segment
  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  return { segments, pauses };
}

// --- Add punctuation to tokens ---
// Simple rule-based punctuation - much faster than AI
// Adds periods at long pauses, commas at short pauses
function addPunctuationToTokens(tokens: Token[]): Token[] {
  if (tokens.length === 0) return tokens;

  const LONG_PAUSE_MS = 800;  // Period after 800ms+ pause
  const SHORT_PAUSE_MS = 300; // Comma after 300-800ms pause
  
  // Sentence-ending words that shouldn't get commas
  const questionWords = new Set(['what', 'where', 'when', 'why', 'how', 'who', 'which']);
  
  const result = tokens.map((token, idx) => {
    let text = token.text.trim();
    
    // Skip if already has punctuation
    if (/[.,!?;:]$/.test(text)) {
      return token;
    }
    
    // Check gap to next token
    if (idx < tokens.length - 1) {
      const gap = tokens[idx + 1].start_ms - token.end_ms;
      
      if (gap >= LONG_PAUSE_MS) {
        // Long pause = likely end of sentence
        const lowerText = text.toLowerCase();
        if (questionWords.has(lowerText.split(' ').pop() || '')) {
          text += '?';
        } else {
          text += '.';
        }
      } else if (gap >= SHORT_PAUSE_MS) {
        // Short pause = likely comma
        text += ',';
      }
    } else {
      // Last token gets a period
      text += '.';
    }
    
    return { ...token, text };
  });
  
  console.log(`Added punctuation to ${result.length} tokens (rule-based)`);
  return result;
}

// --- First-layer segmentation: by pauses (with dynamic duration limits) ---
// Now uses the dynamic segmentation with max 25s segments
function splitIntoSegments(
  tokens: Token[]
): { segments: Token[][]; pauses: { start: number; end: number; durationMs: number }[] } {
  return splitIntoSegmentsDynamic(tokens);
}

// --- Second-layer segmentation: by content (max 4 sentences) ---
// Improved: Clearer instructions to AI for consistent 4-sentence max segmentation
async function splitSegmentByContent(
  segmentTokens: Token[],
  blockIndex: number,
  conversationId: string
): Promise<Token[][]> {
  if (segmentTokens.length === 0) return [];

  const text = segmentTokens.map((t) => t.text).join(' ');
  
  // Count sentences by looking for sentence-ending punctuation
  const sentenceEnders = (text.match(/[.!?]+/g) || []).length;
  
  // For very short segments (1-2 sentences or < 15 words), don't split further
  if (segmentTokens.length < 15 || sentenceEnders <= 2) {
    return [segmentTokens];
  }
  const detailedTokens = segmentTokens
    .map((t, idx) => `[${idx}] ${t.text}`)
    .join(' ');

  const prompt = `You are segmenting spoken text into meaningful content segments for a presentation analysis tool.

The transcript has punctuation (periods, commas, question marks) already added. Use these to identify sentence boundaries.

RULES (follow strictly):
1. Each segment MUST be 1-4 sentences maximum. Never exceed 4 sentences per segment.
2. Segments must be contiguous (no gaps in token indices).
3. Split at sentence boundaries (after periods ".", question marks "?", or exclamation marks "!")
4. Keep related sentences together when they form a cohesive thought (up to 4 sentences max).
5. If the block has more than 4 sentences, you MUST create multiple segments.
6. Filler words (um, uh, like) are part of the transcript - include them in segments, don't treat them as boundaries.

Look for periods and question marks to count sentences, then decide how to split.

DETAILED TOKENS (0-based indices):
${detailedTokens}

FULL TRANSCRIPT:
"${text}"

Return ONLY a JSON object:
{
  "sentenceCount": <number of sentences in this block>,
  "segments": [
    { "startIndex": 0, "endIndex": 12 },
    { "startIndex": 13, "endIndex": 28 }
  ]
}`;

  const response = await callOpenAI(prompt, MODEL_NANO);

  let parsed: { segments?: ContentSegmentDef[] } = {};
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/s);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response);
  } catch (e) {
    console.error(
      'Failed to parse content segments JSON for block',
      blockIndex,
      response,
      e,
    );
    // Fallback: whole block is one segment
    return [segmentTokens];
  }

  if (!parsed.segments || !Array.isArray(parsed.segments) || parsed.segments.length === 0) {
    return [segmentTokens];
  }

  // Clean and clamp indices
  const validRanges = parsed.segments
    .map((s) => ({
      start: Math.max(0, Math.min(segmentTokens.length - 1, s.startIndex)),
      end: Math.max(0, Math.min(segmentTokens.length - 1, s.endIndex)),
    }))
    .filter(
      (r) =>
        Number.isFinite(r.start) &&
        Number.isFinite(r.end) &&
        r.start <= r.end,
    )
    .sort((a, b) => a.start - b.start);

  if (validRanges.length === 0) {
    return [segmentTokens];
  }

  // Merge overlapping or touching ranges (LLM might overlap slightly)
  const merged: { start: number; end: number }[] = [];
  for (const r of validRanges) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push(r);
      continue;
    }
    if (r.start <= last.end + 1) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push(r);
    }
  }

  // Build final token segments from ranges.
  // Note: tokens not covered by any range are currently ignored to keep this simple.
  const result: Token[][] = merged.map((r) =>
    segmentTokens.slice(r.start, r.end + 1)
  );

  if (result.length === 0) {
    return [segmentTokens];
  }

  return result;
}

// --- Fallback: Split by sentence endings ---
// Used when AI segmentation returns only one segment but there are many sentences
function splitBySentences(
  tokens: Token[],
  maxSentencesPerSegment: number = 4
): Token[][] {
  const segments: Token[][] = [];
  let currentSegment: Token[] = [];
  let sentenceCount = 0;

  for (let i = 0; i < tokens.length; i++) {
    currentSegment.push(tokens[i]);
    
    // Check if this token ends with sentence-ending punctuation
    const text = tokens[i].text;
    if (text.match(/[.!?]$/)) {
      sentenceCount++;
      
      // If we've hit the max sentences, start a new segment
      if (sentenceCount >= maxSentencesPerSegment) {
        segments.push(currentSegment);
        currentSegment = [];
        sentenceCount = 0;
      }
    }
  }

  // Don't forget the last segment
  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  return segments.length > 0 ? segments : [tokens];
}

// Known filler words and hedging phrases
const FILLER_WORDS = new Set([
  'um', 'uh', 'uhm', 'umm', 'er', 'ah', 'like', 'you know', 'so', 
  'basically', 'actually', 'literally', 'right', 'okay', 'well'
]);

const HEDGING_STARTERS = ['sort of', 'kind of', 'i think', 'i guess', 'i mean', 
  'maybe', 'perhaps', 'probably', 'might', 'could be'];

// --- Segment Analysis ---
// Rule-based analysis - no AI calls, instant results
function analyzeSegment(
  segmentTokens: Token[],
  segmentIndex: number,
  conversationId: string,
): SegmentAnalysis {
  const text = segmentTokens.map((t) => t.text).join(' ');
  const startMs = segmentTokens[0].start_ms;
  const endMs = segmentTokens[segmentTokens.length - 1].end_ms;
  const durationSec = (endMs - startMs) / 1000;
  const wpm = durationSec > 0 ? (segmentTokens.length / durationSec) * 60 : 0;

  // Rule-based filler detection
  const fillerWords: { word: string; index: number }[] = [];
  const hedging: { phrase: string; startIndex: number; endIndex: number }[] = [];
  
  segmentTokens.forEach((token, idx) => {
    const word = token.text.toLowerCase().replace(/[.,!?;:]/g, '');
    
    // Check single-word fillers
    if (FILLER_WORDS.has(word)) {
      fillerWords.push({ word, index: idx });
    }
    
    // Check multi-word hedging (look ahead)
    if (idx < segmentTokens.length - 1) {
      const twoWords = `${word} ${segmentTokens[idx + 1].text.toLowerCase().replace(/[.,!?;:]/g, '')}`;
      for (const hedge of HEDGING_STARTERS) {
        if (twoWords.startsWith(hedge)) {
          const wordCount = hedge.split(' ').length;
          hedging.push({ 
            phrase: hedge, 
            startIndex: idx, 
            endIndex: idx + wordCount - 1 
          });
          break;
        }
      }
    }
  });

  // Determine pace based on WPM
  let paceStatus: 'slow' | 'normal' | 'fast' | 'very_fast' = 'normal';
  let paceSeverity: 'low' | 'medium' | 'high' = 'low';
  
  if (wpm < 110) {
    paceStatus = 'slow';
    paceSeverity = 'medium';
  } else if (wpm > 200) {
    paceStatus = 'very_fast';
    paceSeverity = 'high';
  } else if (wpm > 160) {
    paceStatus = 'fast';
    paceSeverity = 'medium';
  }

  const analysis = {
    fillerWords,
    hedging,
    pace: { status: paceStatus, severity: paceSeverity },
    grammar: [],
    structure: { quality: 'No specific issues detected', severity: 'low' as const },
    goodElements: [],
    clarity: { score: 'clear' as const, issues: [] },
  };

  const segmentId = `seg-${conversationId}-${segmentIndex}`;
  const tokenWithTags: TokenWithTags[] = segmentTokens.map((token, idx) => {
    const tags: Tag[] = [];

    // Filler words
    analysis.fillerWords?.forEach((filler: any) => {
      const pos = filler.index ?? filler.startIndex;
      if (pos === idx) {
        tags.push({
          id: `${token.id}-filler`,
          kind: 'filler',
          severity: 'medium',
          label: `Filler word: '${filler.normalized || filler.word}'`,
          data: { normalized: filler.normalized || filler.word },
        });
      }
    });

    // Hedging + Grammar (multi-token)
    const multiWordTags = [
      ...(analysis.hedging?.map((h: any) => ({
        ...h,
        kind: 'hedging',
        labelPrefix: 'Hedging phrase',
      })) || []),
      ...(analysis.grammar?.map((g: any) => ({
        ...g,
        kind: 'grammar',
        labelPrefix: 'Grammar Issue',
        labelDetail: g.issue,
      })) || []),
    ];

    multiWordTags.forEach((item: any) => {
      const start = item.startIndex;
      const end = item.endIndex ?? start;

      if (idx >= start && idx <= end) {
        tags.push({
          id: `${token.id}-${item.kind}`,
          kind: item.kind,
          severity: item.severity || 'medium',
          label: `${item.labelPrefix}: '${
            item.phrase || item.text || item.labelDetail || token.text
          }'`,
          data: { start, end },
        });
      }
    });

    return {
      id: token.id,
      startMs: token.start_ms,
      endMs: token.end_ms,
      text: token.text,
      tags,
    };
  });

  // Segment-level tags
  const segmentTags: Tag[] = [];

  // Pace tags (including very_fast and slow)
  if (analysis.pace?.status === 'very_fast' || analysis.pace?.status === 'fast' || analysis.pace?.status === 'slow') {
    segmentTags.push({
      id: `${segmentId}-pace`,
      kind: analysis.pace.status,
      severity: analysis.pace.severity || (analysis.pace.status === 'very_fast' ? 'high' : 'medium'),
      label: `Segment spoken at ~${wpm.toFixed(0)} WPM${
        analysis.pace.status === 'very_fast' ? ' - way too fast! Target 110-160' :
        analysis.pace.status === 'fast' ? ' - slightly fast, target 110-160' :
        analysis.pace.status === 'slow' ? ' - too slow, target 110-160' : ''
      }`,
    });
  }

  const totalFillers = tokenWithTags.reduce(
    (sum, t) => sum + t.tags.filter((tag) => tag.kind === 'filler').length,
    0,
  );
  
  // Add filler tag if there are multiple fillers
  if (totalFillers > 2) {
    segmentTags.push({
      id: `${segmentId}-filler`,
      kind: 'filler',
      severity: totalFillers > 4 ? 'high' : 'medium',
      label: `Multiple filler words detected (${totalFillers})`,
    });
  }

  // Clarity/unclear point tags based on AI analysis
  if (analysis.clarity?.score === 'unclear' || analysis.clarity?.score === 'very_unclear') {
    const clarityIssues = analysis.clarity.issues?.join('; ') || 'Unclear messaging';
    segmentTags.push({
      id: `${segmentId}-unclear`,
      kind: 'unclear_point',
      severity: analysis.clarity.score === 'very_unclear' ? 'high' : 'medium',
      label: clarityIssues,
    });
  }

  // Hedging at segment level (if multiple hedging phrases)
  const hedgingCount = analysis.hedging?.length || 0;
  if (hedgingCount > 1) {
    segmentTags.push({
      id: `${segmentId}-hedging`,
      kind: 'hedging',
      severity: hedgingCount > 2 ? 'high' : 'medium',
      label: `Multiple hedging phrases weaken your message (${hedgingCount} instances)`,
    });
  }

  if (analysis.structure?.quality && analysis.structure.quality !== 'No specific issues detected') {
    segmentTags.push({
      id: `${segmentId}-structure`,
      kind: 'structure',
      severity: analysis.structure.severity || 'low',
      label: analysis.structure.quality,
    });
  }

  if (analysis.goodElements?.length > 0) {
    analysis.goodElements.forEach((element: string, idx: number) => {
      segmentTags.push({
        id: `${segmentId}-good-${idx}`,
        kind: 'good_emphasis',
        severity: 'low',
        label: element,
      });
    });
  }

  return {
    id: segmentId,
    startMs,
    endMs,
    kind: 'speech',
    text,
    tokens: tokenWithTags,
    tags: segmentTags,
  };
}

// --- Overall Issues ---
// Uses MODEL_NANO with minimal prompt for speed
async function generateOverallIssues(
  segments: SegmentAnalysis[],
  conversationId: string,
): Promise<Issue[]> {
  // Count totals only - no text needed
  const totalFillers = segments.reduce((sum, s) => 
    sum + s.tokens.filter(t => t.tags.some(tag => tag.kind === 'filler')).length, 0
  );
  const fastSegs = segments.filter(s => s.tags.some(t => t.kind === 'fast' || t.kind === 'very_fast')).length;
  const slowSegs = segments.filter(s => s.tags.some(t => t.kind === 'slow')).length;
  const hedgeSegs = segments.filter(s => s.tags.some(t => t.kind === 'hedging')).length;

  // Ultra-minimal prompt - just numbers
  const prompt = `Speech: ${segments.length} segs, ${totalFillers} fillers, ${fastSegs} fast, ${slowSegs} slow, ${hedgeSegs} hedging.
Return 2-3 issues as JSON: [{"kind":"filler|pace|hedging","severity":"low|medium|high","message":"10 words max","segmentIndices":[]}]`;

  const response = await callOpenAI(prompt, MODEL_NANO);

  let issuesData: any[] = [];
  try {
    const arrayMatch = response.match(/\[[\s\S]*\]/s);
    if (arrayMatch) {
      issuesData = JSON.parse(arrayMatch[0]);
    } else {
      const objectMatches = response.match(/\{[^{}]*\}/g);
      if (objectMatches) {
        issuesData = objectMatches.map(obj => {
          try { return JSON.parse(obj); } catch { return null; }
        }).filter(Boolean);
        console.log(`Recovered ${issuesData.length} issues from malformed JSON`);
      }
    }
  } catch (e) {
    console.error('Failed to parse Issues JSON:', e);
    issuesData = [];
  }

  return issuesData.map((issue: any, idx: number) => ({
    id: `issue-${conversationId}-${idx}`,
    kind: issue.kind || 'general',
    severity: issue.severity || 'medium',
    message: issue.message || 'Review this section',
    segmentIds: (issue.segmentIndices || []).map((i: number) => `seg-${conversationId}-${i}`),
    tokenIds: issue.tokenIds || [],
  }));
}

// --- Generate Coaching Highlights ---
// Uses MODEL_NANO with context for personalized feedback
async function generateCoachingHighlights(
  segments: SegmentAnalysis[],
  metrics: Metrics,
  issues: Issue[],
  conversationId: string,
): Promise<CoachingHighlight[]> {
  // Get first ~150 words for content context (enough to understand topic without being too long)
  const allText = segments.map((s) => s.text).join(' ');
  const truncatedText = allText.split(/\s+/).slice(0, 150).join(' ');
  
  // Build issue summary
  const issueMessages = issues.slice(0, 3).map(i => i.message).join('; ') || 'none';
  
  // Find specific examples for personalization
  const fillerExamples = segments
    .flatMap(s => s.tokens.filter(t => t.tags.some(tag => tag.kind === 'filler')))
    .slice(0, 3)
    .map(t => t.text.toLowerCase().replace(/[.,!?]/g, ''));
  const fillerList = [...new Set(fillerExamples)].join(', ') || 'none';
  
  // Check for pace variation
  const fastCount = segments.filter(s => s.tags.some(t => t.kind === 'fast' || t.kind === 'very_fast')).length;
  const slowCount = segments.filter(s => s.tags.some(t => t.kind === 'slow')).length;
  const paceNote = fastCount > 2 ? 'rushing in parts' : slowCount > 2 ? 'dragging in parts' : 'consistent';

  const prompt = `Analyze this speech and give personalized coaching feedback.

SPEECH EXCERPT: "${truncatedText}"

METRICS:
- Duration: ${metrics.durationSec}s, ${metrics.totalWords} words
- Pace: ${metrics.avgWpm} WPM (ideal: 110-160), ${paceNote}
- Fillers: ${metrics.fillerCount} total (${metrics.fillerPerMinute}/min), examples: ${fillerList}

ISSUES: ${issueMessages}

Give 2-3 specific strengths and 2-3 actionable improvements based on THIS speech.
Reference the actual content/topic when relevant. Be specific, not generic.

Return JSON:
{"highlights":[
  {"type":"strength","title":"4-6 words","detail":"20-30 words, specific to this speech"},
  {"type":"improvement","title":"4-6 words","detail":"20-30 words, actionable advice","severity":"low|medium|high"}
]}`;

  try {
    const response = await callOpenAI(prompt, MODEL_NANO);

    let parsed: { highlights?: CoachingHighlight[] } = {};
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/s);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response);
    } catch (e) {
      console.error('Failed to parse coaching highlights JSON:', e);
      return generateFallbackHighlights(metrics, issues);
    }

    if (!parsed.highlights || !Array.isArray(parsed.highlights)) {
      return generateFallbackHighlights(metrics, issues);
    }

    return parsed.highlights.map((h) => ({
      type: h.type || 'improvement',
      title: h.title || 'General feedback',
      detail: h.detail || '',
      severity: h.severity,
    }));
  } catch (e) {
    console.error('Error generating coaching highlights:', e);
    return generateFallbackHighlights(metrics, issues);
  }
}

// Fallback highlights if AI call fails
function generateFallbackHighlights(
  metrics: Metrics,
  issues: Issue[],
): CoachingHighlight[] {
  const highlights: CoachingHighlight[] = [];

  // Pace feedback (using new thresholds: 110-160 WPM is good)
  if (metrics.avgWpm >= 110 && metrics.avgWpm <= 160) {
    highlights.push({
      type: 'strength',
      title: 'Good speaking pace',
      detail: `Your average pace of ${metrics.avgWpm} WPM is in the ideal range for clear communication.`,
    });
  } else if (metrics.avgWpm > 160) {
    highlights.push({
      type: 'improvement',
      title: 'Slow down your pace',
      detail: `At ${metrics.avgWpm} WPM, you're speaking faster than ideal (110-160 WPM). Try adding brief pauses between key points.`,
      severity: metrics.avgWpm > 200 ? 'high' : 'medium',
    });
  } else if (metrics.avgWpm < 110) {
    highlights.push({
      type: 'improvement',
      title: 'Speed up your pace',
      detail: `At ${metrics.avgWpm} WPM, you're speaking slower than ideal (110-160 WPM). Try to maintain more energy and momentum.`,
      severity: 'low',
    });
  }

  // Filler feedback
  if (metrics.fillerPerMinute < 2) {
    highlights.push({
      type: 'strength',
      title: 'Minimal filler words',
      detail: 'You kept filler words to a minimum, which makes your speech sound confident and polished.',
    });
  } else if (metrics.fillerPerMinute > 3) {
    highlights.push({
      type: 'improvement',
      title: 'Reduce filler words',
      detail: `You used ${metrics.fillerCount} filler words. Try replacing them with silent pauses for more impact.`,
      severity: metrics.fillerPerMinute > 5 ? 'high' : 'medium',
    });
  }

  // Add top issue as improvement if we don't have enough
  if (highlights.filter((h) => h.type === 'improvement').length === 0 && issues.length > 0) {
    const topIssue = issues.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.severity] - order[b.severity];
    })[0];
    
    highlights.push({
      type: 'improvement',
      title: topIssue.kind.replace('_', ' '),
      detail: topIssue.message,
      severity: topIssue.severity,
    });
  }

  return highlights;
}

// --- Generate Session Title ---
// Creates a short, descriptive title based on the content of the speech
async function generateSessionTitle(
  segments: SegmentAnalysis[],
  metrics: Metrics,
): Promise<string> {
  // Get first ~100 words only - enough for topic detection
  const allText = segments.map((s) => s.text).join(' ');
  const truncatedText = allText.split(/\s+/).slice(0, 100).join(' ');
  
  // If very short or no content, return generic title
  if (!truncatedText || truncatedText.length < 20) {
    return 'Untitled Session';
  }

  // Minimal prompt - just the text and simple instruction
  const prompt = `Title this speech in 3-5 words: "${truncatedText}"
Return JSON: {"title":"Your Title Here"}`;

  try {
    const response = await callOpenAI(prompt, MODEL_NANO);
    
    let parsed: { title?: string } = {};
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/s);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response);
    } catch (e) {
      console.error('Failed to parse title JSON:', e);
      return generateFallbackTitle(truncatedText);
    }

    if (parsed.title && typeof parsed.title === 'string' && parsed.title.length > 0) {
      // Clean up the title - remove quotes, limit length
      let title = parsed.title.replace(/^["']|["']$/g, '').trim();
      // Limit to ~50 chars if somehow too long
      if (title.length > 50) {
        title = title.substring(0, 47) + '...';
      }
      return title;
    }
    
    return generateFallbackTitle(truncatedText);
  } catch (e) {
    console.error('Error generating title:', e);
    return generateFallbackTitle(truncatedText);
  }
}

// Fallback title generation without AI
function generateFallbackTitle(text: string): string {
  // Extract first few meaningful words
  const words = text
    .replace(/[^a-zA-Z\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 4);
  
  if (words.length >= 2) {
    return words.slice(0, 3).map(w => 
      w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    ).join(' ') + '...';
  }
  
  return 'Untitled Session';
}

// --- Metrics Calculation ---
function calculateMetrics(
  segments: SegmentAnalysis[],
  pauses: { start: number; end: number; durationMs: number }[],
): Metrics {
  const totalWords = segments.reduce((sum, s) => sum + s.tokens.length, 0);

  const totalDurationMs =
    segments.length > 0
      ? segments[segments.length - 1].endMs - segments[0].startMs
      : 0;

  const durationSec = totalDurationMs / 1000;

  const speakingDurationMs = segments.reduce(
    (sum, s) => sum + (s.endMs - s.startMs),
    0,
  );
  const avgWpm =
    speakingDurationMs > 0
      ? (totalWords / (speakingDurationMs / 1000)) * 60
      : 0;

  let fillerCount = 0;
  segments.forEach((s) => {
    s.tokens.forEach((t) => {
      fillerCount += t.tags.filter((tag) => tag.kind === 'filler').length;
    });
  });

  const fillerPerMinute =
    durationSec > 0 ? (fillerCount / durationSec) * 60 : 0;

  const fastSegments = segments.filter((s) =>
    s.tags.some((t) => t.kind === 'fast'),
  ).length;
  const stressSpeedIndex =
    segments.length > 0 ? fastSegments / segments.length : 0;

  // Mock biometric data (will be replaced with real Watch data later)
  // Movement score: random value between 0.35 and 0.65 (middle range)
  const movementScore = 0.35 + Math.random() * 0.3;
  
  // Heart rate: plausible values for public speaking (elevated but normal)
  // Average HR: 75-95 bpm range
  const avgHeartRate = Math.round(75 + Math.random() * 20);
  // Peak HR: around 120-145 bpm (nervousness spikes)
  const peakHeartRate = Math.round(120 + Math.random() * 25);

  return {
    durationSec: Math.round(durationSec),
    totalWords,
    avgWpm: Math.round(avgWpm),
    fillerCount,
    fillerPerMinute: parseFloat(fillerPerMinute.toFixed(1)),
    avgHeartRate,
    peakHeartRate,
    movementScore: parseFloat(movementScore.toFixed(2)),
    stressSpeedIndex: parseFloat(stressSpeedIndex.toFixed(2)),
  };
}

// --- Deno Handler ---
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
};

Deno.serve(async (req) => {
  const startTime = Date.now();
  const logTime = (label: string) => console.log(`[${Date.now() - startTime}ms] ${label}`);
  
  // Timing tracker for each step
  const timing: Record<string, number> = {};
  const markStart = (key: string) => { timing[`${key}_start`] = Date.now(); };
  const markEnd = (key: string) => { 
    timing[key] = Date.now() - (timing[`${key}_start`] || startTime);
    delete timing[`${key}_start`];
  };
  
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    if (!OPENAI_KEY) {
      throw new Error('OPENAI_KEY environment variable is not set');
    }

    logTime('Starting analysis...');
    
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          persistSession: false,
        },
      },
    );

    // Get the latest conversation_id
    markStart('tokenFetch');
    const { data: latestToken, error: latestError } = await supabaseClient
      .from('tokens')
      .select('conversation_id')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (latestError || !latestToken) {
      throw new Error('No tokens found');
    }

    const conversationId = latestToken.conversation_id;
    logTime(`Got conversation ID: ${conversationId}`);

    // Get all tokens for this conversation
    const { data: tokens, error: tokensError } = await supabaseClient
      .from('tokens')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('start_ms', { ascending: true });

    if (tokensError || !tokens || tokens.length === 0) {
      throw new Error('No tokens found for conversation');
    }
    markEnd('tokenFetch');

    logTime(`Fetched ${tokens.length} tokens`);

    // 0) Add punctuation to tokens (periods, commas) - fast rule-based approach
    markStart('punctuation');
    const punctuatedTokens = addPunctuationToTokens(tokens);
    markEnd('punctuation');
    logTime('Punctuation added');

    // 1) Pause-based segmentation into blocks
    markStart('segmentation');
    const { segments: pauseBlocks, pauses } = splitIntoSegments(punctuatedTokens);
    logTime(`Pause-based split: ${pauseBlocks.length} blocks`);

    // 2) Within each block, split by sentences (deterministic, fast, no AI needed)
    const contentSegmentsPerBlock: Token[][][] = pauseBlocks.map((blockTokens) => {
      return splitBySentences(blockTokens, 4);
    });
    
    // Count total segments
    const totalSegments = contentSegmentsPerBlock.reduce((sum, block) => sum + block.length, 0);
    markEnd('segmentation');
    logTime(`Sentence split complete: ${totalSegments} segments`);

    // 3) Analyze each content segment in PARALLEL, then interleave pause segments
    // First, flatten all segments with their indices for parallel processing
    markStart('segmentAnalysis');
    const segmentsToAnalyze: { tokens: Token[]; blockIdx: number; segIdx: number; globalIdx: number }[] = [];
    let globalIdx = 0;
    for (let blockIdx = 0; blockIdx < contentSegmentsPerBlock.length; blockIdx++) {
      const contentSegments = contentSegmentsPerBlock[blockIdx];
      for (let segIdx = 0; segIdx < contentSegments.length; segIdx++) {
        segmentsToAnalyze.push({
          tokens: contentSegments[segIdx],
          blockIdx,
          segIdx,
          globalIdx: globalIdx++,
        });
      }
    }

    // Analyze all segments (synchronous, rule-based - instant)
    logTime(`Analyzing ${segmentsToAnalyze.length} segments (rule-based)`);
    const analyzedSegments: SegmentAnalysis[] = segmentsToAnalyze.map(({ tokens, globalIdx }) =>
      analyzeSegment(tokens, globalIdx, conversationId)
    );
    markEnd('segmentAnalysis');
    logTime('Segment analysis complete');

    // Now reconstruct the final array with pauses interleaved
    const speechSegments: SegmentAnalysis[] = [...analyzedSegments];
    const allSegments: SegmentAnalysis[] = [];
    
    let analyzedIdx = 0;
    for (let blockIdx = 0; blockIdx < contentSegmentsPerBlock.length; blockIdx++) {
      const contentSegments = contentSegmentsPerBlock[blockIdx];
      
      // Add all speech segments for this block
      for (let i = 0; i < contentSegments.length; i++) {
        allSegments.push(analyzedSegments[analyzedIdx++]);
      }

      // Insert pause segment between blocks
      if (blockIdx < pauses.length) {
        const pause = pauses[blockIdx];
        const severity = pause.durationMs > 4000 ? 'medium' : 'low';
        allSegments.push({
          id: `pause-${conversationId}-${blockIdx}`,
          startMs: pause.start,
          endMs: pause.end,
          kind: 'pause',
          text: '',
          tokens: [],
          tags: [
            {
              id: `pause-${conversationId}-${blockIdx}-tag`,
              kind: 'pause',
              severity,
              label: `Pause: ${(pause.durationMs / 1000).toFixed(1)}s`,
              data: { durationMs: pause.durationMs },
            },
          ],
        });
      }
    }

    console.log(
      `Final segmentation: ${speechSegments.length} speech segments + ${pauses.length} pauses`,
    );

    // Calculate metrics first (synchronous)
    markStart('metrics');
    const metrics = calculateMetrics(speechSegments, pauses);
    markEnd('metrics');
    logTime('Metrics calculated');

    // 4) Run ALL AI calls in PARALLEL (issues, title, coaching)
    markStart('aiCalls');
    logTime('Starting all AI calls in parallel');
    const [issues, title, coachingHighlights] = await Promise.all([
      generateOverallIssues(speechSegments, conversationId),
      generateSessionTitle(speechSegments, metrics),
      generateCoachingHighlights(speechSegments, metrics, [], conversationId), // Pass empty issues since parallel
    ]);
    markEnd('aiCalls');
    logTime(`AI complete: ${issues.length} issues, title: "${title}", ${coachingHighlights.length} highlights`);

    // Build timing data for debugging
    const analysisTiming: AnalysisTiming = {
      totalMs: Date.now() - startTime,
      tokenFetchMs: timing['tokenFetch'] || 0,
      punctuationMs: timing['punctuation'] || 0,
      segmentationMs: timing['segmentation'] || 0,
      segmentAnalysisMs: timing['segmentAnalysis'] || 0,
      metricsMs: timing['metrics'] || 0,
      aiCallsMs: timing['aiCalls'] || 0,
      storageUploadMs: 0, // Will update after upload
      tokenCount: tokens.length,
      segmentCount: allSegments.length,
      wordCount: metrics.totalWords,
      analyzedAt: new Date().toISOString(),
    };

    const analysis: AnalysisResult = {
      title,
      segments: allSegments,
      metrics,
      issues,
      coachingHighlights,
      analysisTiming,
    };

    // 7) Save to storage bucket
    markStart('storageUpload');
    const analysisJson = JSON.stringify(analysis, null, 2);
    const fileName = `${conversationId}-analysis.json`;

    const { error: uploadError } = await supabaseClient.storage
      .from('a')
      .upload(fileName, analysisJson, {
        contentType: 'application/json',
        upsert: true,
      });

    if (uploadError) {
      throw uploadError;
    }
    markEnd('storageUpload');
    
    // Update timing with final storage time
    analysis.analysisTiming!.storageUploadMs = timing['storageUpload'] || 0;
    analysis.analysisTiming!.totalMs = Date.now() - startTime;
    
    // Re-upload with final timing (quick since upsert)
    await supabaseClient.storage
      .from('a')
      .upload(fileName, JSON.stringify(analysis, null, 2), {
        contentType: 'application/json',
        upsert: true,
      });
    
    logTime('Analysis uploaded to storage');

    // Update conversation status to 'finished'
    const { error: statusError } = await supabaseClient
      .from('conversations')
      .upsert(
        {
          conversation_id: conversationId,
          status: 'finished',
          timestamp: Math.floor(Date.now() / 1000),
        },
        {
          onConflict: 'conversation_id',
          ignoreDuplicates: false,
        }
      );

    if (statusError) {
      console.error('Failed to update conversation status:', statusError);
    } else {
      logTime('Conversation marked as finished');
    }

    logTime('ANALYSIS COMPLETE');

    return new Response(
      JSON.stringify({
        success: true,
        conversationId,
        fileName,
        summary: {
          segments: allSegments.length,
          issues: issues.length,
          metrics,
        },
        totalTimeMs: Date.now() - startTime,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    );
  } catch (error: any) {
    const errorTime = Date.now() - startTime;
    console.error(`[${errorTime}ms] ERROR:`, error.message, error.stack);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        stack: error.stack,
        timeMs: errorTime,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      },
    );
  }
});
