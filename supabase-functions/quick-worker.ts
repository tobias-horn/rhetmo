import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface TokenRecord {
  id: string
  conversation_id: string
  start_ms: number
  end_ms: number
  text: string
  tags: string[]
}

interface TranscriptToken {
  id: string
  startMs: number
  endMs: number
  text: string
  tags: Array<{
    id: string
    kind: string
    severity: string
    label: string
    data?: Record<string, any>
  }>
}

interface Segment {
  id: string
  startMs: number
  endMs: number
  kind: 'speech' | 'pause'
  text: string
  tokens: TranscriptToken[]
  tags: Array<{
    id: string
    kind: string
    severity: string
    label: string
  }>
}

interface Session {
  id: string
  userId: string
  title: string
  mode: 'practice' | 'live'
  context: string
  createdAt: string
  startedAt: string
  endedAt: string | null
  durationSec: number
  audioUrl: string | null
  analysisStatus: 'pending' | 'processing' | 'ready' | 'error'
  analysis: {
    segments: Segment[]
    metrics: {
      durationSec: number
      totalWords: number
      avgWpm: number
      fillerCount: number
      fillerPerMinute: number
      avgHeartRate: number
      peakHeartRate: number
      movementScore: number
      stressSpeedIndex: number
    }
    issues: Array<{
      id: string
      kind: string
      severity: string
      message: string
      segmentIds: string[]
      tokenIds?: string[]
    }>
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      SUPABASE_URL!,
      SUPABASE_SERVICE_ROLE_KEY!
    )

    // Extract conversation_id from URL parameters
    const url = new URL(req.url)
    let conversation_id = url.searchParams.get('conversation_id')

    // --- NEW LOGIC START ---
    // If no conversation_id is provided, find the ID of the latest token
    if (!conversation_id) {
      console.log('No conversation_id provided. Fetching latest token...')
      
      const { data: latestToken, error: latestError } = await supabase
        .from('tokens')
        .select('conversation_id')
        .order('created_at', { ascending: false }) // Order by timestamp desc to get the newest
        .limit(1)
        .single()

      if (latestError) {
        console.error('Error fetching latest token:', latestError)
        return new Response(
          JSON.stringify({ error: 'Failed to retrieve latest session', details: latestError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      if (!latestToken) {
        return new Response(
          JSON.stringify({ error: 'No tokens found in database to infer session.' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      conversation_id = latestToken.conversation_id
      console.log(`Resolved latest conversation_id: ${conversation_id}`)
    }
    // --- NEW LOGIC END ---

    console.log(`Fetching session data for conversation: ${conversation_id}`)

    // Fetch all tokens from this conversation, sorted by time
    const { data: tokens, error: tokensError } = await supabase
      .from('tokens')
      .select('id, conversation_id, start_ms, end_ms, text, tags')
      .eq('conversation_id', conversation_id)
      .order('start_ms', { ascending: true })

    if (tokensError) {
      console.error('Error fetching tokens:', tokensError)
      return new Response(
        JSON.stringify({ error: 'Failed to fetch tokens', details: tokensError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!tokens || tokens.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No tokens found for this conversation' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get conversation metadata
    const conversationData = {};

    // Calculate metrics
    const totalWords = tokens.length
    const startMs = tokens[0].start_ms
    const endMs = tokens[tokens.length - 1].end_ms
    const durationMs = endMs - startMs
    const durationSec = Math.round(durationMs / 1000)
    const avgWpm = durationSec > 0 ? Math.round((totalWords / durationSec) * 60) : 0
    
    // Count fillers
    const fillerCount = tokens.filter((t: any) => 
      t.tags && t.tags.some((tag: string) => tag === 'filler')
    ).length
    const fillerPerMinute = durationSec > 0 ? parseFloat(((fillerCount / durationSec) * 60).toFixed(1)) : 0

    // Mock biometric data (consistent with clever-service.ts)
    // These will be replaced with real Apple Watch data when available
    const movementScore = parseFloat((0.35 + Math.random() * 0.3).toFixed(2))
    const avgHeartRate = Math.round(75 + Math.random() * 20)
    const peakHeartRate = Math.round(120 + Math.random() * 25)
    
    // Calculate stress/speed index based on pace
    const stressSpeedIndex = avgWpm > 160 ? parseFloat((Math.min(1, (avgWpm - 160) / 100)).toFixed(2)) : 0

    // Build full transcript text
    const fullText = tokens.map((t: any) => t.text).join(' ')

    // Generate a basic title from first few meaningful words
    // This is a fallback - full AI title generation happens in clever-service
    const generateQuickTitle = (text: string): string => {
      const words = text
        .replace(/[^a-zA-Z\s]/g, '')
        .split(/\s+/)
        .filter((w: string) => w.length > 3)
        .slice(0, 4)
      
      if (words.length >= 2) {
        return words.slice(0, 3).map((w: string) => 
          w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
        ).join(' ') + '...'
      }
      
      return `Session ${new Date().toLocaleDateString()}`
    }
    
    const sessionTitle = generateQuickTitle(fullText)

    // Convert tokens to the expected format
    const transcriptTokens: TranscriptToken[] = tokens.map((token: TokenRecord) => ({
      id: token.id,
      startMs: token.start_ms,
      endMs: token.end_ms,
      text: token.text,
      tags: token.tags ? token.tags.map((tagStr: string, idx: number) => ({
        id: `${token.id}-tag-${idx}`,
        kind: tagStr,
        severity: tagStr === 'filler' ? 'medium' : 'low',
        label: `Tag: ${tagStr}`,
      })) : []
    }))

    // Create single segment containing all tokens
    const segment: Segment = {
      id: `${conversation_id}-seg-1`,
      startMs,
      endMs,
      kind: 'speech',
      text: fullText,
      tokens: transcriptTokens,
      tags: []
    }

    // Build the session object
    const session: Session = {
      id: conversation_id!,
      userId: '',
      title: sessionTitle,
      mode: 'practice',
      context: 'general',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      endedAt: null,
      durationSec,
      audioUrl: null,
      analysisStatus: 'processing',
      analysis: {
        segments: [segment],
        metrics: {
          durationSec,
          totalWords,
          avgWpm,
          fillerCount,
          fillerPerMinute,
          avgHeartRate,
          peakHeartRate,
          movementScore,
          stressSpeedIndex,
        },
        issues: []
      }
    }

    return new Response(
      JSON.stringify(session),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error: any) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})