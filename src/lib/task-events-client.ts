import type { TaskInfo } from './task-registry';
import { fetchSessionPayload } from './auth-session';

export interface TaskEvent {
  taskId: string;
  type: 'created' | 'updated' | 'completed' | 'failed' | 'cancelled' | 'timeout' | 'progress' | 'queued';
  task: TaskInfo;
}

type TaskEventHandler = (event: TaskEvent) => void;

interface SessionResponse {
  success?: boolean;
  user?: { id?: string } | null;
}

interface CancellationResponse {
  success?: boolean;
  message?: string;
  error?: string;
}

export class TaskEventsClient {
  private eventSource: EventSource | null = null;
  private handlers = new Set<TaskEventHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 30;
  private connected = false;
  private connecting = false;
  private connectionGeneration = 0;
  private connectionRequested = false;
  private suspendedForPageTransition = false;
  private lifecycleListenersAttached = false;

  private readonly handlePageTransition = (): void => {
    this.suspendedForPageTransition = true;
    this.closeConnection();
  };

  private readonly handlePageRestore = (): void => {
    if (!this.suspendedForPageTransition) return;
    this.suspendedForPageTransition = false;
    if (this.connectionRequested) this.startConnection();
  };

  connect(): void {
    this.connectionRequested = true;
    this.attachPageLifecycleListeners();
    this.startConnection();
  }

  private startConnection(): void {
    if (this.suspendedForPageTransition || !this.connectionRequested) return;
    if (this.eventSource || this.reconnectTimer || this.connecting) return;

    this.connecting = true;
    const generation = this.connectionGeneration;
    void this.openAfterSessionCheck(generation);
  }

  disconnect(): void {
    this.connectionRequested = false;
    this.suspendedForPageTransition = false;
    this.detachPageLifecycleListeners();
    this.closeConnection();
    this.reconnectAttempts = 0;
  }

  private closeConnection(): void {
    this.connectionGeneration++;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.eventSource?.close();
    this.eventSource = null;
    this.connected = false;
    this.connecting = false;
  }

  private attachPageLifecycleListeners(): void {
    if (this.lifecycleListenersAttached || typeof window === 'undefined') return;
    window.addEventListener('beforeunload', this.handlePageTransition);
    window.addEventListener('pagehide', this.handlePageTransition);
    window.addEventListener('pageshow', this.handlePageRestore);
    this.lifecycleListenersAttached = true;
  }

  private detachPageLifecycleListeners(): void {
    if (!this.lifecycleListenersAttached || typeof window === 'undefined') return;
    window.removeEventListener('beforeunload', this.handlePageTransition);
    window.removeEventListener('pagehide', this.handlePageTransition);
    window.removeEventListener('pageshow', this.handlePageRestore);
    this.lifecycleListenersAttached = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  onTaskEvent(handler: TaskEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async cancelTask(taskId: string): Promise<{ success: boolean; message?: string }> {
    try {
      console.info('[TaskEventsClient] cancel request started', { taskId });
      const response = await fetch(`${this.getBaseUrl()}/api/cancel-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      });
      const payload = await response.json() as CancellationResponse;
      console.info('[TaskEventsClient] cancel response received', {
        taskId,
        status: response.status,
        success: payload.success === true,
      });
      if (payload.success !== true) {
        return {
          success: false,
          message: payload.message || payload.error || `取消请求失败 (${response.status})`,
        };
      }
      return {
        success: true,
        message: payload.message,
      };
    } catch (error) {
      console.error('[TaskEventsClient] cancelTask error:', error);
      return { success: false, message: 'Failed to cancel task' };
    }
  }

  private async openAfterSessionCheck(generation: number): Promise<void> {
    const authenticated = await this.hasAuthenticatedSession();
    this.connecting = false;

    if (
      generation !== this.connectionGeneration
      || this.eventSource
      || !this.connectionRequested
      || this.suspendedForPageTransition
    ) return;
    if (!authenticated) return;

    try {
      this.eventSource = new EventSource(`${this.getBaseUrl()}/api/task-events`);
      this.eventSource.onopen = () => {
        this.connected = true;
        this.reconnectAttempts = 0;
      };
      this.eventSource.onmessage = (event) => {
        if (!event.data || event.data === 'heartbeat') return;
        try {
          const taskEvent = JSON.parse(event.data) as TaskEvent;
          this.handlers.forEach((handler) => {
            try {
              handler(taskEvent);
            } catch {
              // A consumer error must not break the shared event stream.
            }
          });
        } catch {
          // Ignore malformed SSE payloads from intermediaries.
        }
      };
      this.eventSource.onerror = () => {
        this.connected = false;
        this.eventSource?.close();
        this.eventSource = null;
        this.scheduleReconnect();
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private async hasAuthenticatedSession(): Promise<boolean> {
    try {
      const payload = await fetchSessionPayload(fetch, undefined, `${this.getBaseUrl()}/api/session`) as SessionResponse;
      return payload.success === true && Boolean(payload.user?.id);
    } catch {
      return false;
    }
  }

  private getBaseUrl(): string {
    if (typeof window !== 'undefined') {
      return `${window.location.protocol}//${window.location.host}`;
    }
    return '';
  }

  private scheduleReconnect(): void {
    if (
      !this.connectionRequested
      || this.suspendedForPageTransition
      || this.reconnectAttempts >= this.maxReconnectAttempts
      || this.reconnectTimer
    ) return;
    const delay = Math.min(2_000 * 2 ** this.reconnectAttempts, 30_000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.startConnection();
    }, delay);
  }
}

export const taskEventsClient = new TaskEventsClient();
