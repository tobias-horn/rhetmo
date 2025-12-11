// supabase/functions/analyze-speech/index.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const OPENAI_KEY = Deno.env.get('OPENAI_KEY')!;
const OPENAI_API = 'https://api.openai.com/v1/chat/completions';

// Model selection: nano for fast text tasks, mini for complex analysis
const MODEL_NANO = 'gpt-5-nano-2025-08-07'; // Fast: punctuation, segmentation, classification
const MODEL_MINI = 'gpt-5-mini-2025-08-07'; // Complex: analysis, issues, coaching highlights

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

interface AnalysisResult {
  segments: SegmentAnalysis[];
  metrics: Metrics;
  issues: Issue[];
  coachingHighlights: CoachingHighlight[];
}

// For content-based splitting
interface ContentSegmentDef {
  startIndex: number;
  endIndex: number;
}

// --- OpenAI Utility ---
async function callOpenAI(
  prompt: string, 
  temperature = 0.3,
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
      temperature,
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
// This adds proper grammar (periods, commas) while preserving filler words
async function addPunctuationToTokens(tokens: Token[]): Promise<Token[]> {
  if (tokens.length === 0) return tokens;

  // Process in chunks to avoid hitting token limits
  const CHUNK_SIZE = 150;
  const chunks: Token[][] = [];
  
  for (let i = 0; i < tokens.length; i += CHUNK_SIZE) {
    chunks.push(tokens.slice(i, i + CHUNK_SIZE));
  }

  const processedTokens: Token[] = [];

  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    const chunk = chunks[chunkIdx];
    const rawText = chunk.map((t) => t.text).join(' ');
    const indexedTokens = chunk.map((t, idx) => `[${idx}] ${t.text}`).join(' ');

    const prompt = `You are adding punctuation to a speech transcript. Your task is to add proper punctuation (periods, commas, question marks) while PRESERVING ALL WORDS EXACTLY as they appear, including filler words like "um", "uh", "like", "you know", etc.

RAW TRANSCRIPT:
"${rawText}"

INDEXED TOKENS:
${indexedTokens}

RULES:
1. KEEP ALL WORDS exactly as they are - do NOT remove or change any words
2. KEEP ALL FILLER WORDS (um, uh, like, you know, basically, actually, sort of, kind of, right, I mean)
3. Add periods (.) at the end of sentences
4. Add commas (,) for natural pauses, lists, and clauses
5. Add question marks (?) for questions
6. Attach punctuation to the word it follows (e.g., "word." not "word .")
7. Return the SAME NUMBER of tokens with punctuation attached

Return ONLY a JSON object with the corrected text for each token index:
{
  "tokens": [
    {"index": 0, "text": "Hello,"},
    {"index": 1, "text": "um,"},
    {"index": 2, "text": "my"},
    {"index": 3, "text": "name"},
    {"index": 4, "text": "is"},
    {"index": 5, "text": "John."}
  ]
}`;

    try {
      const response = await callOpenAI(prompt, 0.1, MODEL_NANO);
      
      let parsed: { tokens?: { index: number; text: string }[] } = {};
      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/s);
        parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response);
      } catch (e) {
        console.error(`Failed to parse punctuation JSON for chunk ${chunkIdx}:`, e);
        // Fallback: use original tokens
        processedTokens.push(...chunk);
        continue;
      }

      if (!parsed.tokens || !Array.isArray(parsed.tokens)) {
        processedTokens.push(...chunk);
        continue;
      }

      // Apply punctuated text to tokens
      const punctuatedMap = new Map<number, string>();
      parsed.tokens.forEach((t) => {
        if (typeof t.index === 'number' && typeof t.text === 'string') {
          punctuatedMap.set(t.index, t.text);
        }
      });

      chunk.forEach((token, idx) => {
        const newText = punctuatedMap.get(idx);
        if (newText) {
          processedTokens.push({
            ...token,
            text: newText,
          });
        } else {
          processedTokens.push(token);
        }
      });

    } catch (e) {
      console.error(`Error adding punctuation to chunk ${chunkIdx}:`, e);
      processedTokens.push(...chunk);
    }
  }

  console.log(`Added punctuation to ${processedTokens.length} tokens`);
  return processedTokens;
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

  const response = await callOpenAI(prompt, 0.2, MODEL_NANO);

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

// --- Segment Analysis ---
async function analyzeSegment(
  segmentTokens: Token[],
  segmentIndex: number,
  conversationId: string,
): Promise<SegmentAnalysis> {
  const text = segmentTokens.map((t) => t.text).join(' ');
  const startMs = segmentTokens[0].start_ms;
  const endMs = segmentTokens[segmentTokens.length - 1].end_ms;
  const durationSec = (endMs - startMs) / 1000;
  const wpm = (segmentTokens.length / durationSec) * 60;

  const detailedTokens = segmentTokens
    .map((t, idx) => `[${idx}] ${t.text}`)
    .join(' ');

  const prompt = `Analyze this speech segment for a presentation. Your primary task is to precisely map any identified issues (especially filler words and hedging) back to their corresponding word index in the segment.

SEGMENT TRANSCRIPT:
"${text}"

DETAILED TOKENS (Use these indices for your output):
${detailedTokens}

DURATION: ${durationSec.toFixed(1)} seconds
WORDS: ${segmentTokens.length}
WPM: ${wpm.toFixed(0)}

Analyze for:
1. Filler words (e.g., um, uh, like, you know, sort of, kind of, actually, basically, right, I mean)
2. Hedging language (e.g., maybe, perhaps, I think, I guess, possibly)
3. Pace issues (too fast >180 WPM, too slow <120 WPM)
4. Grammar/language mistakes
5. Structure quality (clarity, flow, organization)
6. Good elements (emphasis, examples, clear statements)

Output ONLY a single JSON object. Ensure the 'index' fields are present and correct, referencing the DETAILED TOKENS list.

{
  "fillerWords": [{"word": "um", "index": 5, "normalized": "um"}],
  "hedging": [{"phrase": "sort of", "startIndex": 10, "endIndex": 11}],
  "pace": {"status": "fast|normal|slow", "severity": "low|medium|high"},
  "grammar": [{"issue": "Run-on sentence", "startIndex": 3, "endIndex": 8}],
  "structure": {"quality": "description", "severity": "low|medium|high"},
  "goodElements": ["specific positive aspect"]
}`;

  const response = await callOpenAI(prompt, 0.2, MODEL_MINI);

  let analysis: any;
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/s);
    analysis = JSON.parse(jsonMatch ? jsonMatch[0] : response);
  } catch (e) {
    console.error(`Failed to parse JSON for segment ${segmentIndex}:`, response, e);
    analysis = {
      fillerWords: [],
      hedging: [],
      pace: { status: 'normal', severity: 'low' },
      grammar: [],
      structure: { quality: 'No specific issues detected', severity: 'low' },
      goodElements: [],
    };
  }

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

  if (analysis.pace?.status === 'fast' || analysis.pace?.status === 'slow') {
    segmentTags.push({
      id: `${segmentId}-pace`,
      kind: analysis.pace.status,
      severity: analysis.pace.severity || 'medium',
      label: `Segment spoken at ~${wpm.toFixed(0)} WPM${
        analysis.pace.status === 'fast' ? ', target 150-165' : ''
      }`,
    });
  }

  const totalFillers = tokenWithTags.reduce(
    (sum, t) => sum + t.tags.filter((tag) => tag.kind === 'filler').length,
    0,
  );
  if (totalFillers > 2) {
    segmentTags.push({
      id: `${segmentId}-filler`,
      kind: 'filler',
      severity: 'medium',
      label: `Multiple filler words detected (${totalFillers})`,
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
async function generateOverallIssues(
  segments: SegmentAnalysis[],
  conversationId: string,
): Promise<Issue[]> {
  const allText = segments.map((s) => s.text).join(' ');

  const fillerTokenIds = segments.flatMap((s) =>
    s.tokens
      .filter((t) => t.tags.some((tag) => tag.kind === 'filler'))
      .map((t) => t.id)
  );

  const prompt = `Review this complete presentation transcript and identify 3-5 key issues that need improvement.

FULL TRANSCRIPT:
${allText}


SEGMENT SUMMARIES:
${segments
  .map(
    (s, i) =>
      `Segment ${i + 1} (Index: ${i}): ${s.tags
        .map((t) => t.label)
        .join('; ')}`
  )
  .join('\n')}

Identify the most important issues across:
- Filler word patterns
- Pace consistency
- Structure and flow
- Language clarity
- Key improvement opportunities

If an issue pertains to specific segments, provide the 0-based index of those segments (Segment Indices). If an issue pertains to filler words, you may also reference their specific token IDs: ${fillerTokenIds
    .slice(0, 10)
    .join(', ')}${fillerTokenIds.length > 10 ? '...' : ''}

Output ONLY a JSON array of issues:
[
  {
    "kind": "filler_cluster|fast_segment|structure|hedging|complex_sentence",
    "severity": "low|medium|high",
    "message": "Specific actionable feedback",
    "segmentIndices": [0, 2]
  }
]`;

  const response = await callOpenAI(prompt, 0.3, MODEL_MINI);

  let issuesData;
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/s);
    issuesData = JSON.parse(jsonMatch ? jsonMatch[0] : response);
  } catch (e) {
    console.error('Failed to parse Issues JSON:', response, e);
    issuesData = [];
  }

  return issuesData.map((issue: any, idx: number) => ({
    id: `issue-${conversationId}-${idx}`,
    kind: issue.kind || 'general',
    severity: issue.severity || 'medium',
    message: issue.message || 'Review this section for improvement',
    segmentIds: (issue.segmentIndices || []).map(
      (i: number) => `seg-${conversationId}-${i}`,
    ),
    tokenIds: issue.tokenIds || [],
  }));
}

// --- Generate Coaching Highlights ---
// This creates a summary of the top strengths and areas for improvement
async function generateCoachingHighlights(
  segments: SegmentAnalysis[],
  metrics: Metrics,
  issues: Issue[],
  conversationId: string,
): Promise<CoachingHighlight[]> {
  const allText = segments.map((s) => s.text).join(' ');
  
  // Collect all good elements from segments
  const goodElements: string[] = [];
  segments.forEach((s) => {
    s.tags
      .filter((t) => t.kind === 'good_emphasis')
      .forEach((t) => goodElements.push(t.label));
  });

  const prompt = `You are a professional speech coach analyzing a presentation. Based on the transcript and analysis data, identify the TOP 2-3 STRENGTHS and TOP 2-3 AREAS FOR IMPROVEMENT.

FULL TRANSCRIPT:
${allText}

METRICS:
- Duration: ${metrics.durationSec} seconds
- Average pace: ${metrics.avgWpm} WPM (ideal: 140-165 WPM)
- Filler words: ${metrics.fillerCount} total (${metrics.fillerPerMinute}/min)

IDENTIFIED ISSUES:
${issues.map((i) => `- [${i.severity}] ${i.message}`).join('\n')}

POSITIVE ELEMENTS FOUND:
${goodElements.length > 0 ? goodElements.join('\n') : 'None specifically identified'}

Create coaching highlights that:
1. Are specific and actionable
2. Reference concrete examples from the transcript when possible
3. Focus on the MOST impactful things - what will make the biggest difference
4. For improvements, suggest HOW to fix it, not just what's wrong
5. For strengths, explain WHY it works well

Return ONLY a JSON object:
{
  "highlights": [
    {
      "type": "strength",
      "title": "Clear opening hook",
      "detail": "You grabbed attention immediately by stating a relatable problem. This establishes credibility and relevance."
    },
    {
      "type": "improvement",
      "title": "Reduce filler clusters",
      "detail": "Around the 45-second mark, you used 'um' and 'like' 4 times in one sentence. Try pausing silently instead - it projects confidence.",
      "severity": "medium"
    }
  ]
}`;

  const response = await callOpenAI(prompt, 0.4, MODEL_MINI);

  let parsed: { highlights?: CoachingHighlight[] } = {};
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/s);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response);
  } catch (e) {
    console.error('Failed to parse coaching highlights JSON:', response, e);
    // Fallback: generate basic highlights from metrics
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
}

// Fallback highlights if AI call fails
function generateFallbackHighlights(
  metrics: Metrics,
  issues: Issue[],
): CoachingHighlight[] {
  const highlights: CoachingHighlight[] = [];

  // Pace feedback
  if (metrics.avgWpm >= 140 && metrics.avgWpm <= 165) {
    highlights.push({
      type: 'strength',
      title: 'Good speaking pace',
      detail: `Your average pace of ${metrics.avgWpm} WPM is in the ideal range for clear communication.`,
    });
  } else if (metrics.avgWpm > 165) {
    highlights.push({
      type: 'improvement',
      title: 'Slow down your pace',
      detail: `At ${metrics.avgWpm} WPM, you're speaking faster than ideal. Try adding brief pauses between key points.`,
      severity: metrics.avgWpm > 180 ? 'high' : 'medium',
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
Deno.serve(async (_req) => {
  try {
    if (!OPENAI_KEY) {
      throw new Error('OPENAI_KEY environment variable is not set');
    }

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

    // Get all tokens for this conversation
    const { data: tokens, error: tokensError } = await supabaseClient
      .from('tokens')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('start_ms', { ascending: true });

    if (tokensError || !tokens || tokens.length === 0) {
      throw new Error('No tokens found for conversation');
    }

    console.log(
      `Analyzing ${tokens.length} tokens for conversation ${conversationId}`,
    );

    // 0) Add punctuation to tokens (periods, commas) while preserving filler words
    console.log('Adding punctuation to transcript...');
    const punctuatedTokens = await addPunctuationToTokens(tokens);
    console.log('Punctuation added successfully');

    // 1) Pause-based segmentation into blocks
    const { segments: pauseBlocks, pauses } = splitIntoSegments(punctuatedTokens);
    console.log(
      `Pause-based split: ${pauseBlocks.length} blocks with ${pauses.length} pauses`,
    );

    // 2) Within each block, split further by content (or by sentences as fallback)
    const contentSegmentsPerBlock: Token[][][] = [];
    for (let blockIdx = 0; blockIdx < pauseBlocks.length; blockIdx++) {
      const blockTokens = pauseBlocks[blockIdx];
      
      // Try AI-based content segmentation first
      let contentSegments = await splitSegmentByContent(
        blockTokens,
        blockIdx,
        conversationId,
      );
      
      // If AI only returned 1 segment but we have many sentences, use fallback
      if (contentSegments.length === 1 && blockTokens.length > 30) {
        const text = blockTokens.map(t => t.text).join(' ');
        const sentenceCount = (text.match(/[.!?]+/g) || []).length;
        
        if (sentenceCount > 4) {
          console.log(`Block ${blockIdx}: AI returned 1 segment but found ${sentenceCount} sentences. Using fallback splitter.`);
          contentSegments = splitBySentences(blockTokens, 4);
        }
      }
      
      console.log(`Block ${blockIdx}: ${blockTokens.length} tokens -> ${contentSegments.length} content segments`);
      contentSegmentsPerBlock.push(contentSegments);
    }

    // 3) Analyze each content segment and interleave pause segments
    let globalSegmentIndex = 0;
    const speechSegments: SegmentAnalysis[] = [];
    const allSegments: SegmentAnalysis[] = [];

    for (let blockIdx = 0; blockIdx < contentSegmentsPerBlock.length; blockIdx++) {
      const contentSegments = contentSegmentsPerBlock[blockIdx];

      for (const segTokens of contentSegments) {
        const analysis = await analyzeSegment(
          segTokens,
          globalSegmentIndex,
          conversationId,
        );
        speechSegments.push(analysis);
        allSegments.push(analysis);
        globalSegmentIndex++;
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
              kind: 'long_pause',
              severity,
              label: `Pause duration: ${(pause.durationMs / 1000).toFixed(1)}s`,
              data: { durationMs: pause.durationMs },
            },
          ],
        });
      }
    }

    console.log(
      `Final segmentation: ${speechSegments.length} speech segments + ${pauses.length} pauses`,
    );

    // 4) Overall issues + metrics based on speech segments
    const issues = await generateOverallIssues(speechSegments, conversationId);
    const metrics = calculateMetrics(speechSegments, pauses);

    // 5) Generate coaching highlights (AI summary of key strengths and improvements)
    console.log('Generating coaching highlights...');
    const coachingHighlights = await generateCoachingHighlights(
      speechSegments,
      metrics,
      issues,
      conversationId,
    );
    console.log(`Generated ${coachingHighlights.length} coaching highlights`);

    const analysis: AnalysisResult = {
      segments: allSegments,
      metrics,
      issues,
      coachingHighlights,
    };

    // 6) Save to storage bucket
    const analysisJson = JSON.stringify(analysis, null, 2);
    console.log(analysis);
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
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      },
    );
  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 500,
      },
    );
  }
});
