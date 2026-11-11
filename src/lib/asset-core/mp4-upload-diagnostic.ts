import { AsyncLocalStorage } from 'node:async_hooks';

export type Mp4UploadDiagnostic =
  | { phase: 'request_admission' | 'import' | 'mp4_structure' | 'probe_input' | 'complete' }
  | {
      phase: 'ffprobe';
      error: 'launch_not_found' | 'launch_not_executable' | 'launch_failed'
        | 'exit_nonzero' | 'terminated' | 'execution_failed' | 'result_rejected';
      exitCode?: number;
    };

export interface Mp4UploadDiagnosticTrace { current: Mp4UploadDiagnostic }

// Populated only for an authenticated MP4 upload. No request or subprocess data is stored.
export const mp4UploadDiagnosticScope = new AsyncLocalStorage<Mp4UploadDiagnosticTrace>();
