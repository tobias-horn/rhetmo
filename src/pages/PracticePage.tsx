import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, MicOff, Loader2, CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react';
import { useRecordingService } from '@/hooks/useRecordingService';
import clsx from 'clsx';

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function PracticePage() {
  const navigate = useNavigate();
  const { state, startRecording, stopRecording, checkPermission } = useRecordingService();
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState('Processing your recording...');

  // Check microphone permission on mount
  useEffect(() => {
    checkPermission();
  }, [checkPermission]);

  const handleStartRecording = async () => {
    try {
      await startRecording();
    } catch (error: unknown) {
      console.error('Failed to start recording:', error);
    }
  };

  const handleStopRecording = async () => {
    if (state.duration < 3) {
      // Minimum recording duration check
      return;
    }
    
    setIsProcessing(true);
    setProcessingMessage('Uploading your recording...');
    
    try {
      const conversationId = await stopRecording();
      
      if (conversationId) {
        setProcessingMessage('Analyzing your speech...');
        
        // Wait for processing, then navigate
        setTimeout(() => {
          setProcessingMessage('Preparing your results...');
          setTimeout(() => {
            navigate(`/sessions/${conversationId}`);
          }, 1500);
        }, 2000);
      } else {
        setIsProcessing(false);
      }
    } catch (error) {
      console.error('Failed to stop recording:', error);
      setIsProcessing(false);
    }
  };

  const handleCancel = async () => {
    if (state.isRecording) {
      await stopRecording();
    }
    navigate('/dashboard');
  };

  const canStopRecording = state.duration >= 3;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="mx-auto max-w-4xl px-4 py-8">
        {/* Back button */}
        <button 
          onClick={handleCancel}
          className="mb-6 flex items-center gap-2 text-slate-400 transition hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Dashboard</span>
        </button>

        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="font-display text-4xl font-bold text-white">Practice Session</h1>
          <p className="mt-2 text-slate-400">
            {!state.isRecording && !isProcessing && 'Press the record button to start your practice'}
            {state.isRecording && 'Recording in progress — speak naturally'}
            {isProcessing && processingMessage}
          </p>
        </div>

        {/* Main Recording Area */}
        <div className="glass-panel relative overflow-hidden rounded-3xl p-8">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-transparent" />
          
          <div className="relative">
            {/* Timer */}
            <div className="mb-8 text-center">
              <div className={clsx(
                'inline-flex items-center gap-3 rounded-2xl border px-6 py-3 transition-colors',
                state.isRecording 
                  ? 'border-red-500/30 bg-red-500/10' 
                  : 'border-white/10 bg-white/5'
              )}>
                <div className={clsx(
                  'h-3 w-3 rounded-full transition-colors',
                  state.isRecording ? 'animate-pulse bg-red-500' : 'bg-slate-600'
                )} />
                <span className="font-mono text-3xl font-semibold text-white">
                  {formatDuration(state.duration)}
                </span>
              </div>
              {state.isRecording && state.duration < 3 && (
                <p className="mt-2 text-xs text-amber-400">
                  Record at least 3 seconds
                </p>
              )}
            </div>

            {/* Transcript Display */}
            <div className="mb-8 min-h-[280px] rounded-2xl border border-white/10 bg-slate-950/50 p-6">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm uppercase tracking-[0.15em] text-slate-400">
                  Live Transcript
                </span>
                {state.transcript && (
                  <span className="text-xs text-emerald-400">
                    {state.transcript.split(' ').filter((w: string) => w.length > 0).length} words
                  </span>
                )}
              </div>
              
              <div className="max-h-[200px] overflow-y-auto">
                {state.transcript ? (
                  <p className="text-lg leading-relaxed text-slate-200">
                    {state.transcript}
                  </p>
                ) : (
                  <p className="text-lg italic text-slate-500">
                    {state.isRecording 
                      ? 'Listening... start speaking' 
                      : 'Your speech will appear here in real-time...'}
                  </p>
                )}
              </div>
            </div>

            {/* Error Display */}
            {state.error && (
              <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4">
                <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-400" />
                <div>
                  <p className="text-sm font-medium text-red-300">{state.error}</p>
                  {state.permissionStatus === 'denied' && (
                    <p className="mt-1 text-xs text-red-400/80">
                      Please enable microphone access in your browser settings and refresh the page.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Controls */}
            <div className="flex items-center justify-center gap-4">
              {!state.isRecording && !isProcessing && (
                <>
                  <button
                    onClick={handleStartRecording}
                    disabled={state.permissionStatus === 'denied'}
                    className={clsx(
                      'flex items-center gap-3 rounded-full px-8 py-4 text-lg font-semibold shadow-lg transition',
                      state.permissionStatus === 'denied'
                        ? 'cursor-not-allowed bg-slate-600 text-slate-400'
                        : 'bg-emerald-500 text-slate-950 shadow-emerald-500/30 hover:bg-emerald-400 hover:shadow-emerald-500/50'
                    )}
                  >
                    <Mic className="h-6 w-6" />
                    Start Recording
                  </button>
                </>
              )}

              {state.isRecording && (
                <button
                  onClick={handleStopRecording}
                  disabled={!canStopRecording}
                  className={clsx(
                    'flex items-center gap-3 rounded-full px-8 py-4 text-lg font-semibold shadow-lg transition',
                    canStopRecording
                      ? 'bg-red-500 text-white shadow-red-500/30 hover:bg-red-400 hover:shadow-red-500/50'
                      : 'cursor-not-allowed bg-slate-600 text-slate-400'
                  )}
                >
                  <MicOff className="h-6 w-6" />
                  Stop Recording
                </button>
              )}

              {isProcessing && (
                <div className="flex flex-col items-center gap-4">
                  <div className="flex items-center gap-3 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-8 py-4">
                    <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
                    <span className="text-lg font-semibold text-emerald-300">{processingMessage}</span>
                  </div>
                  <p className="text-sm text-slate-400">
                    This may take a few moments...
                  </p>
                </div>
              )}
            </div>

            {/* Tips */}
            {!state.isRecording && !isProcessing && (
              <div className="mt-8 rounded-xl border border-white/5 bg-white/5 p-6">
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.15em] text-slate-400">
                  Tips for best results
                </h3>
                <ul className="grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-400" />
                    <span>Speak clearly and at a natural pace</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-400" />
                    <span>Find a quiet environment</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-400" />
                    <span>Position mic at comfortable distance</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-400" />
                    <span>Session analyzed after recording</span>
                  </li>
                </ul>
              </div>
            )}

            {/* Recording indicator */}
            {state.isRecording && (
              <div className="mt-6 text-center">
                <p className="text-sm text-slate-400">
                  Recording will be automatically uploaded and analyzed
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
