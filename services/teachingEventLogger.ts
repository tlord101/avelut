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
  if (passedUserId && passedUserId !== 'anon' && passedUserId !== 'anonymous') {
    return passedUserId;
  }
  try {
    const keys = ['avelut_user_profile', 'user_profile', 'avelut_user', 'sb-auth-token', 'firebase:authUser'];
    for (const k of keys) {
      const raw = localStorage.getItem(k);
      if (raw) {
        const parsed = JSON.parse(raw);
        const uid = parsed?.uid || parsed?.id || parsed?.user_id || parsed?.user?.id;
        if (uid) return uid;
      }
    }
  } catch (e) {
    // ignore
  }
  return 'anonymous';
}

let isTableMissing = false;

export async function flushTeachingEvents(): Promise<void> {
  if (eventQueue.length === 0 || isTableMissing) {
    return;
  }

  if (!supabaseDataService) {
    return;
  }

  const eventsToFlush = [...eventQueue];

  try {
    if (!isSupabaseConfigured || !supabase) {
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
      if (error.code === 'PGRST205' || (error.message && error.message.includes('Could not find the table'))) {
        // Table 'teaching_events' does not exist in DB schema cache; disable DB flushing cleanly
        isTableMissing = true;
        if (flushInterval) {
          clearInterval(flushInterval);
          flushInterval = null;
        }
        eventQueue = [];
      } else {
        console.warn('[TeachingEvent] Could not insert events:', error.message || error);
        // Put events back in queue for retry if temporary network error
        eventQueue = [...eventsToFlush, ...eventQueue].slice(0, 100);
      }
    } else {
      // Clear flushed events on success
      eventQueue = eventQueue.filter((ev) => !eventsToFlush.includes(ev));
    }
  } catch (err) {
    // Quiet exception handling
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
