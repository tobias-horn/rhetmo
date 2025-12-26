// Supabase Edge Function: analyze-voice
// File: supabase/functions/analyze-voice/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface TranscriptionWord {
  word: string
  start: number
  end: number
}

interface WhisperResponse {
  text: string
  words?: TranscriptionWord[]
}

interface TokenRecord {
  id: string
  conversation_id: string
  start_ms: number
  end_ms: number
  text: string
  tags: string[]
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

    // Extract parameters from URL
    const url = new URL(req.url)
    const conversation_id = url.searchParams.get('conversation_id')
    const timestamp = parseFloat(url.searchParams.get('timestamp') || '0')
    const sample_rate = parseInt(url.searchParams.get('sample_rate') || '16000')
    const channels = parseInt(url.searchParams.get('channels') || '1')

    if (!conversation_id) {
      return new Response(
        JSON.stringify({ error: 'Missing conversation_id parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Read binary audio data from request body
    const audioBuffer = await req.arrayBuffer()
    
    if (!audioBuffer || audioBuffer.byteLength === 0) {
      return new Response(
        JSON.stringify({ error: 'Missing or empty audio data' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Processing audio for conversation: ${conversation_id}, timestamp: ${timestamp}, size: ${audioBuffer.byteLength} bytes`)

    // Create File object for Whisper API
    const audioBlob = new Blob([audioBuffer], { type: 'audio/wav' })
    const audioFile = new File([audioBlob], 'audio.wav', { type: 'audio/wav' })

    // Transcribe with OpenAI Whisper
    const formData = new FormData()
    formData.append('file', audioFile)
    formData.append('model', 'whisper-1')
    /*formData.append("prompt", "Transcribe the audio exactly as spoken, including filler words, hesitations, false starts, and repeated words. Do not omit or clean up speech. Do not paraphrase or correct grammar. Produce a verbatim, raw transcription.")*/
    formData.append('response_format', 'verbose_json')
    formData.append('timestamp_granularities[]', 'word')

    const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: formData,
    })

    if (!whisperResponse.ok) {
      const errorText = await whisperResponse.text()
      console.error('Whisper API error:', errorText)
      return new Response(
        JSON.stringify({ error: 'Transcription failed', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const transcription: WhisperResponse = await whisperResponse.json()
    console.log('Transcription:', transcription.text)

    // Process words and save to database
    const words = transcription.words || []
    const tokensToInsert: TokenRecord[] = []

    // Convert timestamp (seconds) to milliseconds base
    const baseTimestampMs = Math.round(timestamp * 1000)

    for (const word of words) {
      const startMs = baseTimestampMs + Math.round(word.start * 1000)
      const endMs = baseTimestampMs + Math.round(word.end * 1000)
      
      // Generate unique ID for this token
      const tokenId = `${conversation_id}-${startMs}-${crypto.randomUUID().slice(0, 8)}`

      const tokenRecord: TokenRecord = {
        id: tokenId,
        conversation_id,
        start_ms: startMs,
        end_ms: endMs,
        text: word.word.trim(),
        tags: [], // Empty tags initially - will be populated during analysis
      }

      tokensToInsert.push(tokenRecord)
    }

    // Batch insert tokens
    if (tokensToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from('tokens')
        .insert(tokensToInsert)

      if (insertError) {
        console.error('Database insert error:', insertError)
        return new Response(
          JSON.stringify({ error: 'Failed to save tokens', details: insertError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // Fetch ALL tokens from this conversation to return complete history
    const { data: allTokens, error: fetchError } = await supabase
      .from('tokens')
      .select('id, start_ms, end_ms, text, tags')
      .eq('conversation_id', conversation_id)
      .order('start_ms', { ascending: true })

    if (fetchError) {
      console.error('Database fetch error:', fetchError)
      return new Response(
        JSON.stringify({ error: 'Failed to fetch conversation history', details: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Build full transcript from all tokens
    const fullTranscript = allTokens?.map(t => t.text).join(' ') || ''

    // Return response with new tokens and full conversation history
    return new Response(
      JSON.stringify({
        success: true,
        conversation_id,
        new_tokens: tokensToInsert.map(t => ({
          id: t.id,
          startMs: t.start_ms,
          endMs: t.end_ms,
          text: t.text,
          tags: t.tags
        })),
        all_tokens: allTokens?.map(t => ({
          id: t.id,
          startMs: t.start_ms,
          endMs: t.end_ms,
          text: t.text,
          tags: t.tags
        })) || [],
        full_transcript: fullTranscript,
        token_count: allTokens?.length || 0
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})