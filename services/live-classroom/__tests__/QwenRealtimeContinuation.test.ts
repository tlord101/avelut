import { describe, it, expect, beforeEach, vi } from 'vitest';

const { MockWebSocket } = vi.hoisted(() => {
  class MockWebSocket {
    public static instances: MockWebSocket[] = [];
    public static CONNECTING = 0;
    public static OPEN = 1;
    public static CLOSING = 2;
    public static CLOSED = 3;

    public readyState: number = 1; // OPEN
    public url: string;
    private _onopen: (() => void) | null = null;
    public onmessage: ((evt: { data: string }) => void) | null = null;
    public onerror: ((err: any) => void) | null = null;
    public onclose: ((evt: any) => void) | null = null;
    public sentMessages: any[] = [];

    constructor(url: string) {
      this.url = url;
      MockWebSocket.instances.push(this);
    }

    get onopen() {
      return this._onopen;
    }

    set onopen(fn: (() => void) | null) {
      this._onopen = fn;
      if (fn) {
        setTimeout(() => {
          if (this._onopen === fn) fn();
        }, 0);
      }
    }

    send(data: string) {
      this.sentMessages.push(JSON.parse(data));
    }

    close() {
      this.readyState = 3; // CLOSED
      if (this.onclose) this.onclose({ code: 1000, reason: 'normal' });
    }

    emitServerEvent(event: any) {
      if (this.onmessage) {
        this.onmessage({ data: JSON.stringify(event) });
      }
    }
  }

  vi.stubGlobal('WebSocket', MockWebSocket);
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
        }),
      },
    },
    configurable: true,
    writable: true,
  });
  return { MockWebSocket };
});

vi.mock('../AvelutBoardController', () => ({
  avelutBoardController: {
    executeBoardAction: vi.fn().mockReturnValue({ status: 'ok' }),
    hasElements: vi.fn().mockReturnValue(false),
    writeText: vi.fn(),
    setSvgIllustration: vi.fn(),
    getTheme: vi.fn().mockReturnValue('dark'),
  },
}));

import { QwenRealtimeTeacherService } from '../QwenRealtimeTeacherService';

// Mock Web Audio API
class MockAudioContext {
  public state = 'running';
  public destination = {};
  public currentTime = 0;
  createGain() { return { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }; }
  createBufferSource() { return { buffer: null, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), onended: null }; }
  createBuffer() { return { copyToChannel: vi.fn() }; }
  createMediaStreamSource() { return { connect: vi.fn() }; }
  createScriptProcessor() {
    return {
      connect: vi.fn(),
      disconnect: vi.fn(),
      onaudioprocess: null,
    };
  }
  close() { return Promise.resolve(); }
  resume() { return Promise.resolve(); }
}
(globalThis as any).AudioContext = MockAudioContext;
if (typeof window !== 'undefined') {
  (window as any).AudioContext = MockAudioContext;
  (window as any).webkitAudioContext = MockAudioContext;
}

// Mock MediaDevices
if (typeof globalThis.navigator === 'undefined') {
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
        }),
      },
    },
    writable: true,
    configurable: true,
  });
} else if (!globalThis.navigator.mediaDevices) {
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    value: {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [{ stop: vi.fn() }],
      }),
    },
    writable: true,
    configurable: true,
  });
}

describe('QwenRealtimeTeacherService Continuation Tests', () => {
  let service: QwenRealtimeTeacherService;

  beforeEach(() => {
    MockWebSocket.instances = [];
    service = new QwenRealtimeTeacherService();
  });

  it('Test 1 — Teacher response completes with askedQuestion=false triggers one continuation', async () => {
    console.log('BEFORE startSession, instances:', MockWebSocket.instances.length);
    const promise = service.startSession({ topicTitle: 'Maths' });
    console.log('AFTER startSession call, instances:', MockWebSocket.instances.length);
    await new Promise((r) => setTimeout(r, 50));
    await promise;
    console.log('AFTER startSession resolved, instances:', MockWebSocket.instances.length);
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

    service.triggerInitialGreeting();

    // Turn 1 created
    ws.emitServerEvent({ type: 'response.created' });
    ws.emitServerEvent({ type: 'response.audio_transcript.done' });
    ws.emitServerEvent({ type: 'response.audio.done' });
    ws.emitServerEvent({ type: 'response.done' });

    // Fast forward autoContinueTimer (500ms)
    await new Promise((r) => setTimeout(r, 600));

    const responseCreates = ws.sentMessages.filter((m) => m.type === 'response.create');
    // 1 greeting + 1 auto-continue = 2
    expect(responseCreates.length).toBe(2);
    expect(responseCreates[1].event_id).toContain('auto_continue_no_question');
  });

  it('Test 2 — Audio completion and response completion both fire resulting in ONE continuation only', async () => {
    await service.startSession({ topicTitle: 'Maths' });
    await new Promise((r) => setTimeout(r, 10));
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

    service.triggerInitialGreeting();

    ws.emitServerEvent({ type: 'response.created' });
    ws.emitServerEvent({ type: 'response.audio_transcript.done' });
    ws.emitServerEvent({ type: 'response.audio.done' });
    ws.emitServerEvent({ type: 'response.done' });

    (service as any).onTeacherAudioFinished();
    (service as any).onTeacherAudioFinished(); // duplicate call

    await new Promise((r) => setTimeout(r, 600));

    const responseCreates = ws.sentMessages.filter((m) => m.type === 'response.create');
    expect(responseCreates.length).toBe(2);
  });

  it('Test 3 — Tool call completes triggers one continuation', async () => {
    await service.startSession({ topicTitle: 'Maths' });
    await new Promise((r) => setTimeout(r, 10));
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

    service.triggerInitialGreeting();

    ws.emitServerEvent({ type: 'response.created' });
    ws.emitServerEvent({
      type: 'response.output_item.added',
      item: { id: 'call_1', call_id: 'call_1', type: 'function_call', name: 'board_action', arguments: '{"action":"write","text":"Formula"}' },
    });
    ws.emitServerEvent({
      type: 'response.function_call_arguments.done',
      call_id: 'call_1',
      name: 'board_action',
      arguments: '{"action":"write","text":"Formula"}',
    });
    ws.emitServerEvent({ type: 'response.done' });

    // Fast forward tool completion
    await new Promise((r) => setTimeout(r, 50));

    const responseCreates = ws.sentMessages.filter((m) => m.type === 'response.create');
    expect(responseCreates.length).toBe(2);
    expect(responseCreates[1].event_id).toContain('tool_done');
  });

  it('Test 4 — Tool completion followed by audio completion produces ONE continuation only', async () => {
    await service.startSession({ topicTitle: 'Maths' });
    await new Promise((r) => setTimeout(r, 10));
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

    service.triggerInitialGreeting();

    ws.emitServerEvent({ type: 'response.created' });
    ws.emitServerEvent({
      type: 'response.output_item.added',
      item: { id: 'call_2', call_id: 'call_2', type: 'function_call', name: 'board_action', arguments: '{"action":"write","text":"Note"}' },
    });
    ws.emitServerEvent({
      type: 'response.function_call_arguments.done',
      call_id: 'call_2',
      name: 'board_action',
      arguments: '{"action":"write","text":"Note"}',
    });
    ws.emitServerEvent({ type: 'response.done' });

    // Tool executes and schedules continuation
    await new Promise((r) => setTimeout(r, 50));

    // Now late audio finished fires for turn 1
    (service as any).onTeacherAudioFinished();
    await new Promise((r) => setTimeout(r, 600));

    const responseCreates = ws.sentMessages.filter((m) => m.type === 'response.create');
    expect(responseCreates.length).toBe(2);
  });

  it('Test 5 — Two continuation triggers arrive almost simultaneously produce one response.create', async () => {
    await service.startSession({ topicTitle: 'Maths' });
    await new Promise((r) => setTimeout(r, 10));
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

    service.triggerInitialGreeting();
    ws.emitServerEvent({ type: 'response.created' });
    ws.emitServerEvent({ type: 'response.audio.done' });
    ws.emitServerEvent({ type: 'response.done' });

    // Trigger two requests for current turn simultaneously
    (service as any).requestTeacherContinuation('reason_1');
    (service as any).requestTeacherContinuation('reason_2');

    const responseCreates = ws.sentMessages.filter((m) => m.type === 'response.create');
    expect(responseCreates.length).toBe(2); // 1 greet + 1 continuation
  });

  it('Test 6 — Teacher asks a question enters WAITING_FOR_STUDENT and zero automatic continuations', async () => {
    await service.startSession({ topicTitle: 'Maths' });
    await new Promise((r) => setTimeout(r, 10));
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

    service.triggerInitialGreeting();
    ws.emitServerEvent({ type: 'response.created' });
    ws.emitServerEvent({ type: 'response.audio_transcript.delta', delta: 'What is x?' });
    ws.emitServerEvent({ type: 'response.audio_transcript.done' });
    ws.emitServerEvent({ type: 'response.done' });

    (service as any).onTeacherAudioFinished();

    await new Promise((r) => setTimeout(r, 600));

    const responseCreates = ws.sentMessages.filter((m) => m.type === 'response.create');
    expect(responseCreates.length).toBe(1); // Only greeting
    expect(service.getLastResponseAskedQuestion()).toBe(true);
  });

  it('Test 7 — Student speaks after a question permits teacher response to resume', async () => {
    await service.startSession({ topicTitle: 'Maths' });
    await new Promise((r) => setTimeout(r, 10));
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

    service.triggerInitialGreeting();
    ws.emitServerEvent({ type: 'response.created' });
    ws.emitServerEvent({ type: 'response.audio_transcript.delta', delta: 'What is x?' });
    ws.emitServerEvent({ type: 'response.audio_transcript.done' });
    ws.emitServerEvent({ type: 'response.audio.done' });
    ws.emitServerEvent({ type: 'response.done' });

    (service as any).onTeacherAudioFinished();

    // Student uses push to talk
    service.beginPushToTalk();
    (service as any).hasUncommittedStudentAudio = true;
    service.endPushToTalk();

    const responseCreates = ws.sentMessages.filter((m) => m.type === 'response.create');
    expect(responseCreates.length).toBe(2);
    expect(responseCreates[1].event_id).toContain('push_to_talk_release');
  });

  it('Test 8 — Synthetic continuation user message does not set waitingForStudent=true', async () => {
    await service.startSession({ topicTitle: 'Maths' });
    await new Promise((r) => setTimeout(r, 10));
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

    service.triggerInitialGreeting();
    ws.emitServerEvent({ type: 'response.created' });
    ws.emitServerEvent({ type: 'response.audio.done' });
    ws.emitServerEvent({ type: 'response.done' });

    (service as any).requestTeacherContinuation('auto_continue_no_question', { injectUserHint: 'Continue teaching' });

    const userMessages = ws.sentMessages.filter((m) => m.type === 'conversation.item.create');
    expect(userMessages.length).toBe(2); // 1 kickoff + 1 hint
    expect(service.getLastResponseAskedQuestion()).toBe(false);
  });

  it('Test 9 — Old session events after reconnect are ignored', async () => {
    const promise = service.startSession({ topicTitle: 'Maths' });
    await new Promise((r) => setTimeout(r, 20));
    await promise;
    const oldWs = MockWebSocket.instances[0];

    // Force reconnect
    const reconnectPromise = (service as any).connectWebSocket();
    await new Promise((r) => setTimeout(r, 20));
    await reconnectPromise;

    // Old WS emits message
    oldWs.emitServerEvent({ type: 'response.created' });

    expect((service as any).currentTeachingTurnId).toBe(0); // Ignored old ws event
  });

  it('Test 10 — WebSocket reconnect maintains one active listener set', async () => {
    const promise = service.startSession({ topicTitle: 'Maths' });
    await new Promise((r) => setTimeout(r, 20));
    await promise;
    const oldWs = MockWebSocket.instances[0];

    const reconnectPromise = (service as any).connectWebSocket();
    await new Promise((r) => setTimeout(r, 20));
    await reconnectPromise;

    expect(oldWs.onmessage).toBeNull();
    expect(oldWs.onopen).toBeNull();
  });

  it('Test 11 — Repeated no-question responses are bounded by safety cap', async () => {
    await service.startSession({ topicTitle: 'Maths' });
    await new Promise((r) => setTimeout(r, 10));
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

    service.triggerInitialGreeting();

    for (let i = 0; i < 5; i++) {
      ws.emitServerEvent({ type: 'response.created' });
      ws.emitServerEvent({ type: 'response.audio_transcript.done' });
      ws.emitServerEvent({ type: 'response.audio.done' });
      ws.emitServerEvent({ type: 'response.done' });
      await new Promise((r) => setTimeout(r, 550));
    }

    const responseCreates = ws.sentMessages.filter((m) => m.type === 'response.create');
    // Safety cap at 3 consecutive auto-continues forces auto_continue_ask_question
    const askQuestionRequests = responseCreates.filter((r) => r.event_id?.includes('auto_continue_ask_question'));
    expect(askQuestionRequests.length).toBeGreaterThan(0);
  });

  it('Test 12 / Regression Sequence — Turn 7 to Turn 13 loop reproduction', async () => {
    await service.startSession({ topicTitle: 'Maths' });
    await new Promise((r) => setTimeout(r, 10));
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

    service.triggerInitialGreeting();

    // Turn 7: board_action -> tool_done continuation
    ws.emitServerEvent({ type: 'response.created' });
    ws.emitServerEvent({
      type: 'response.output_item.added',
      item: { id: 'call_7', call_id: 'call_7', type: 'function_call', name: 'board_action', arguments: '{"action":"write","text":"Turn 7"}' },
    });
    ws.emitServerEvent({
      type: 'response.function_call_arguments.done',
      call_id: 'call_7',
      name: 'board_action',
      arguments: '{"action":"write","text":"Turn 7"}',
    });
    ws.emitServerEvent({ type: 'response.done' });
    await new Promise((r) => setTimeout(r, 50));

    // Turn 8: audio.done + response.done -> auto_continue
    ws.emitServerEvent({ type: 'response.created' });
    ws.emitServerEvent({ type: 'response.audio.done' });
    ws.emitServerEvent({ type: 'response.done' });
    await new Promise((r) => setTimeout(r, 550));

    // Turn 9: audio.done + response.done -> auto_continue
    ws.emitServerEvent({ type: 'response.created' });
    ws.emitServerEvent({ type: 'response.audio.done' });
    ws.emitServerEvent({ type: 'response.done' });
    await new Promise((r) => setTimeout(r, 550));

    // Verify turn requests are clean without duplicates
    const responseCreates = ws.sentMessages.filter((m) => m.type === 'response.create');
    expect(responseCreates.length).toBe(4); // 1 greet + 1 tool_done + 2 auto_continues
  });

  it('Test 13 — Watchdog while tool pending does not force response.create', async () => {
    vi.useFakeTimers();
    try {
      const sessionPromise = service.startSession({ topicTitle: 'Maths' });
      await vi.advanceTimersByTimeAsync(50);
      await sessionPromise;
      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

      service.triggerInitialGreeting();
      ws.emitServerEvent({ type: 'response.created' });
      ws.emitServerEvent({
        type: 'response.output_item.added',
        item: { id: 'call_13', call_id: 'call_13', type: 'function_call', name: 'illustrate_object', arguments: '{"object_description":"Cell"}' },
      });

      // Directly start tool continuation watchdog
      (service as any).startToolContinuationWatchdog('illustrate_object');
      // Advance timers past watchdog timeout (25s)
      await vi.advanceTimersByTimeAsync(30000);

      const responseCreates = ws.sentMessages.filter((m) => m.type === 'response.create');
      expect(responseCreates.length).toBe(1); // Only greeting
    } finally {
      vi.useRealTimers();
    }
  });

  it('Test 14 — Push-to-talk when no active response does not send response.cancel', async () => {
    await service.startSession({ topicTitle: 'Maths' });
    await new Promise((r) => setTimeout(r, 10));
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

    // Ensure state is NO_RESPONSE / RESPONSE_COMPLETED
    (service as any).setResponseLifecycleState('NO_RESPONSE');

    service.beginPushToTalk();

    const cancelMessages = ws.sentMessages.filter((m) => m.type === 'response.cancel');
    expect(cancelMessages.length).toBe(0);
    expect(service.getIsPushToTalkActive()).toBe(true);
  });

  it('Test 15 — Server "none active response" reconciles local state', async () => {
    await service.startSession({ topicTitle: 'Maths' });
    await new Promise((r) => setTimeout(r, 10));
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

    // Emit server error
    ws.emitServerEvent({
      type: 'error',
      error: { type: 'invalid_request_error', message: 'Conversation has none active response' },
    });

    expect((service as any).responseLifecycleState).toBe('NO_RESPONSE');
    expect((service as any).continuationInFlight).toBe(false);
  });
});
