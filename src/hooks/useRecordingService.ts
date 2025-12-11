import { useState, useRef, useCallback } from 'react';
import { API_CONFIG, API_HEADERS } from '@/api/config';

interface RecordingState {
  isRecording: boolean;
  transcript: string;
  error: string | null;
  conversationId: string | null;
  duration: number;
  permissionStatus: 'pending' | 'granted' | 'denied' | 'unknown';
}

interface UseRecordingService {
  state: RecordingState;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<string | null>;
  checkPermission: () => Promise<boolean>;
}

/**
 * Creates a WAV file header for PCM audio data
 * Matches the iOS implementation for compatibility with the Supabase backend
 */
function createWavHeader(pcmDataLength: number, sampleRate: number, channels: number): ArrayBuffer {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  
  // "RIFF" chunk descriptor
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + pcmDataLength, true); // File size - 8
  view.setUint32(8, 0x57415645, false); // "WAVE"
  
  // "fmt " sub-chunk
  view.setUint32(12, 0x666D7420, false); // "fmt "
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
  view.setUint16(22, channels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * channels * 2, true); // ByteRate
  view.setUint16(32, channels * 2, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample
  
  // "data" sub-chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, pcmDataLength, true); // Subchunk2Size
  
  return header;
}

/**
 * Converts Float32Array audio samples to Int16Array (16-bit PCM)
 */
function float32ToInt16(float32Array: Float32Array): Int16Array {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return int16Array;
}

/**
 * Creates a WAV blob from PCM data
 */
function createWavBlob(pcmData: Int16Array, sampleRate: number): Blob {
  const pcmBuffer = pcmData.buffer as ArrayBuffer;
  const header = createWavHeader(pcmBuffer.byteLength, sampleRate, 1);
  return new Blob([header, pcmBuffer], { type: 'audio/wav' });
}

export function useRecordingService(): UseRecordingService {
  const [state, setState] = useState<RecordingState>({
    isRecording: false,
    transcript: '',
    error: null,
    conversationId: null,
    duration: 0,
    permissionStatus: 'unknown',
  });

  // Use refs to avoid stale closure issues
  const conversationIdRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);
  const audioBufferRef = useRef<Float32Array[]>([]);
  const lastUploadTimeRef = useRef<number>(0);
  const isRecordingRef = useRef<boolean>(false);

  // Supabase endpoints
  const ANALYZE_VOICE_URL = `${API_CONFIG.baseUrl}/analyze-voice`;
  const STATUS_UPDATE_URL = `${API_CONFIG.baseUrl}/dynamic-handler`;
  const CLEVER_SERVICE_URL = `${API_CONFIG.baseUrl}/clever-service`;

  const checkPermission = useCallback(async (): Promise<boolean> => {
    try {
      const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      const granted = result.state === 'granted';
      setState(prev => ({ 
        ...prev, 
        permissionStatus: result.state as RecordingState['permissionStatus']
      }));
      return granted;
    } catch {
      // Fallback for browsers that don't support permission query
      return true;
    }
  }, []);

  const updateConversationStatus = useCallback(async (conversationId: string, status: string) => {
    try {
      const response = await fetch(STATUS_UPDATE_URL, {
        method: 'POST',
        headers: API_HEADERS,
        body: JSON.stringify({ conversation_id: conversationId, status }),
      });
      if (!response.ok) {
        console.warn('Status update response:', response.status);
      }
    } catch (error) {
      console.error('Failed to update conversation status:', error);
    }
  }, [STATUS_UPDATE_URL]);

  const triggerCleverService = useCallback(async () => {
    try {
      const response = await fetch(CLEVER_SERVICE_URL, {
        method: 'POST',
        headers: API_HEADERS,
        body: JSON.stringify({ name: 'Functions' }),
      });
      if (response.ok) {
        console.log('Analysis triggered successfully');
      }
    } catch (error) {
      console.error('Failed to trigger analysis:', error);
    }
  }, [CLEVER_SERVICE_URL]);

  const uploadAudioChunk = useCallback(async (audioData: Float32Array, conversationId: string, timestamp: number) => {
    try {
      // Convert to 16-bit PCM and create WAV
      const pcmData = float32ToInt16(audioData);
      const wavBlob = createWavBlob(pcmData, 16000);
      
      const url = new URL(ANALYZE_VOICE_URL);
      url.searchParams.set('conversation_id', conversationId);
      url.searchParams.set('timestamp', timestamp.toFixed(2));
      url.searchParams.set('sample_rate', '16000');
      url.searchParams.set('channels', '1');

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_CONFIG.apiKey}`,
          'apikey': API_CONFIG.apiKey,
          'Content-Type': 'audio/wav',
        },
        body: wavBlob,
      });

      if (response.ok) {
        const data = await response.json();
        if (data.full_transcript) {
          setState(prev => ({ ...prev, transcript: data.full_transcript }));
        }
      } else {
        console.warn('Audio upload response:', response.status);
      }
    } catch (error) {
      console.error('Failed to upload audio chunk:', error);
    }
  }, [ANALYZE_VOICE_URL]);

  const processAudioBuffer = useCallback(() => {
    if (!isRecordingRef.current || audioBufferRef.current.length === 0) return;
    
    const conversationId = conversationIdRef.current;
    if (!conversationId) return;

    const now = Date.now();
    const timeSinceUpload = (now - lastUploadTimeRef.current) / 1000;
    
    // Upload every 2-4 seconds or when buffer is large enough
    const totalSamples = audioBufferRef.current.reduce((sum, chunk) => sum + chunk.length, 0);
    const bufferDuration = totalSamples / 16000; // seconds at 16kHz
    
    if (timeSinceUpload >= 2 || bufferDuration >= 4) {
      // Combine all buffered chunks
      const combinedLength = audioBufferRef.current.reduce((sum, chunk) => sum + chunk.length, 0);
      const combined = new Float32Array(combinedLength);
      let offset = 0;
      for (const chunk of audioBufferRef.current) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      
      // Clear buffer
      audioBufferRef.current = [];
      lastUploadTimeRef.current = now;
      
      // Upload
      const timestamp = (now - startTimeRef.current) / 1000;
      uploadAudioChunk(combined, conversationId, timestamp);
    }
  }, [uploadAudioChunk]);

  const startRecording = useCallback(async () => {
    try {
      // Generate new conversation ID
      const conversationId = crypto.randomUUID();
      conversationIdRef.current = conversationId;
      
      // Reset state
      setState({
        isRecording: true,
        transcript: '',
        error: null,
        conversationId,
        duration: 0,
        permissionStatus: 'granted',
      });
      
      audioBufferRef.current = [];
      startTimeRef.current = Date.now();
      lastUploadTimeRef.current = Date.now();
      isRecordingRef.current = true;

      // Update remote status
      await updateConversationStatus(conversationId, 'recording');

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        } 
      });
      streamRef.current = stream;

      // Setup AudioContext for raw PCM capture
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (event) => {
        if (!isRecordingRef.current) return;
        
        const inputData = event.inputBuffer.getChannelData(0);
        // Clone the data since the buffer gets reused
        audioBufferRef.current.push(new Float32Array(inputData));
        
        // Process and potentially upload
        processAudioBuffer();
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      // Setup Web Speech API for live transcription (as backup/preview)
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event: any) => {
          let transcript = '';
          for (let i = 0; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript + ' ';
          }
          setState(prev => ({ ...prev, transcript: transcript.trim() }));
        };

        recognition.onerror = (event: any) => {
          // Don't fail on speech recognition errors - audio upload is the primary method
          if (event.error !== 'no-speech') {
            console.warn('Speech recognition error:', event.error);
          }
        };

        recognition.onend = () => {
          // Restart if still recording
          if (isRecordingRef.current && recognitionRef.current) {
            try {
              recognitionRef.current.start();
            } catch {
              // Ignore - may already be starting
            }
          }
        };

        recognition.start();
        recognitionRef.current = recognition;
      }

      // Start duration timer
      timerRef.current = window.setInterval(() => {
        setState(prev => ({
          ...prev,
          duration: Math.floor((Date.now() - startTimeRef.current) / 1000),
        }));
      }, 1000);

    } catch (error: unknown) {
      isRecordingRef.current = false;
      
      let errorMessage = 'Failed to start recording';
      const err = error as Error & { name?: string };
      if (err.name === 'NotAllowedError') {
        errorMessage = 'Microphone permission denied. Please allow access to your microphone.';
      } else if (err.name === 'NotFoundError') {
        errorMessage = 'No microphone found. Please connect a microphone and try again.';
      }
      
      setState(prev => ({
        ...prev,
        isRecording: false,
        error: errorMessage,
        permissionStatus: err.name === 'NotAllowedError' ? 'denied' : prev.permissionStatus,
      }));
      throw error;
    }
  }, [updateConversationStatus, processAudioBuffer]);

  const stopRecording = useCallback(async (): Promise<string | null> => {
    const conversationId = conversationIdRef.current;
    isRecordingRef.current = false;
    
    if (!conversationId) {
      return null;
    }

    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Stop speech recognition
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore
      }
      recognitionRef.current = null;
    }

    // Stop audio processing
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current) {
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Upload any remaining audio
    if (audioBufferRef.current.length > 0) {
      const combinedLength = audioBufferRef.current.reduce((sum, chunk) => sum + chunk.length, 0);
      const combined = new Float32Array(combinedLength);
      let offset = 0;
      for (const chunk of audioBufferRef.current) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      audioBufferRef.current = [];
      
      const timestamp = (Date.now() - startTimeRef.current) / 1000;
      await uploadAudioChunk(combined, conversationId, timestamp);
    }

    // Stop media stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    setState(prev => ({ ...prev, isRecording: false }));

    // Update status to processing
    await updateConversationStatus(conversationId, 'processing');

    // Trigger analysis
    await triggerCleverService();

    // Update status to finished after a short delay
    setTimeout(() => {
      updateConversationStatus(conversationId, 'finished');
    }, 1000);

    return conversationId;
  }, [updateConversationStatus, uploadAudioChunk, triggerCleverService]);

  return {
    state,
    startRecording,
    stopRecording,
    checkPermission,
  };
}
