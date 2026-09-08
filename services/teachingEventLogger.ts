import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { supabaseDataService } from './supabaseDataService';

export type TeachingEventType =
  | 'prefetch_start'
  | 'prefetch_complete'
  | 'prefetch_fail'
  | 'prefetch_timeout'
  | 'session_start'
  | 'session_error'
  | 'board_load'
  | 'credit_deduct'
  | 'credit_fail'
  | 'fallback_used'
  | 'cache_hit'
  | 'cache_miss';

export interface TeachingEventPayload {
  type: TeachingEventType;
  topic: string;
  courseName?: string;
  duration?: number;
  durations?: number[];
  reason?: string;
  latencyMs?: number;
  error?: string;
  metadata?: Record<string, any>;
  userId?: string;
}

interface StoredTeachingEvent extends TeachingEventPayload {
  timestamp: number;
  userId: string;
}

let eventQueue: StoredTeachingEvent[] = [];
let flushInterval: ReturnType<typeof setInterval> | null = null;

const FLUSH_INTERVAL_MS = 30000;

function getUserId(passedUserId?: string): string {
  if (passedUserId) {
    return passedUserId;
  }
  try {
    const profileStr = localStorage.getItem('avelut_user_profile');
    if (profileStr) {
      const profile = JSON.parse(profileStr);
      return profile.id || profile.user_id || profile.uid || 'anonymous';
    }
  } catch (e) {
    // ignore
  }
  return 'anonymous';
}

export async function flushTeachingEvents(): Promise<void> {
  if (eventQueue.length === 0) {
    return;
  }

  // Double check that data service is available if user meant to check it
  if (!supabaseDataService) {
    console.warn('[TeachingEvent] supabaseDataService not available');
    return;
  }

  const eventsToFlush = [...eventQueue];
  eventQueue = [];

  try {
    if (!isSupabaseConfigured || !supabase) {
      console.warn('[TeachingEvent] Supabase client not configured for flushing');
      return;
    }

    const { error } = await supabase.from('teaching_events').insert(
      eventsToFlush.map((ev) => ({
        event_type: ev.type,
        topic: ev.topic,
        duration: ev.duration,
        latency_ms: ev.latencyMs,
        error_message: ev.error,
        metadata: ev.metadata,
        user_id: ev.userId,
        created_at: new Date(ev.timestamp).toISOString(),
      }))
    );

    if (error) {
      console.error('[TeachingEvent] Failed to flush events to Supabase:', error);
    }
  } catch (err) {
    console.error('[TeachingEvent] Exception while flushing events:', err);
  }
}

function startFlushInterval() {
  if (!flushInterval && typeof window !== 'undefined') {
    flushInterval = setInterval(flushTeachingEvents, FLUSH_INTERVAL_MS);
  }
}

export function logTeachingEvent(
  typeOrPayload: TeachingEventType | TeachingEventPayload,
  details?: Partial<TeachingEventPayload>
): void {
  const timestamp = Date.now();

  let payload: TeachingEventPayload;
  if (typeof typeOrPayload === 'string') {
    payload = {
      type: typeOrPayload,
      topic: details?.topic || 'unknown',
      ...details,
    };
  } else {
    payload = typeOrPayload;
  }

  const userId = getUserId(payload.userId);
  
  const eventToStore: StoredTeachingEvent = {
    ...payload,
    timestamp,
    userId,
  };

  console.log('[TeachingEvent]', JSON.stringify(eventToStore));

  eventQueue.push(eventToStore);
  startFlushInterval();
}
