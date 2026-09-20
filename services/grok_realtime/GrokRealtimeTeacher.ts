import { BoardController } from './BoardController';

export interface GrokRealtimeOptions {
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (err: Error) => void;
  onAudioData?: (data: Float32Array) => void; // Used if we handle audio playback externally
  onInterruption?: () => void;
  onContextMessage?: (role: string, text: string) => void;
  systemPrompt?: string;
  initialContext?: string;
}

export class GrokRealtimeTeacher {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private boardController: BoardController;
  private options: GrokRealtimeOptions;

  private isConnected = false;
  private isMuted = false;

  // Audio Playback
  private playbackContext: AudioContext | null = null;
  private nextPlayTime = 0;

  constructor(boardController: BoardController, options: GrokRealtimeOptions = {}) {
    this.boardController = boardController;
    this.options = options;
  }


  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;

  public async connect() {
    if (this.isConnected) return;

    try {
      // 1. Get ephemeral token from backend
      const res = await fetch('/api/grok-realtime', {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to fetch realtime session token');
      const sessionData = await res.json();
      const clientSecret = sessionData.client_secret?.value;
      if (!clientSecret) throw new Error('Missing client_secret in session response');

      // 2. Setup WebRTC Peer Connection
      this.peerConnection = new RTCPeerConnection();

      this.peerConnection.ontrack = (event) => {
        // Handle incoming audio
        if (!this.playbackContext) {
          this.playbackContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }

        const audioEl = document.createElement('audio');
        audioEl.srcObject = event.streams[0];
        audioEl.play().catch(e => console.warn('Audio play failed', e));
      };

      // Set up data channel for events
      this.dataChannel = this.peerConnection.createDataChannel('oai-events');
      this.dataChannel.onopen = () => {
        this.isConnected = true;
        this.sendSessionUpdate();
        this.options.onConnect?.();
      };
      this.dataChannel.onmessage = this.handleMessage.bind(this);
      this.dataChannel.onclose = () => {
        this.isConnected = false;
        this.options.onDisconnect?.();
      };

      // 3. Start Mic and add track to PeerConnection
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaStream.getTracks().forEach(track => {
        if (this.peerConnection) this.peerConnection.addTrack(track, this.mediaStream!);
      });

      // 4. Create and send SDP Offer
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      const sdpResponse = await fetch(`https://api.x.ai/v1/realtime?model=grok-realtime`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${clientSecret}`,
          'Content-Type': 'application/sdp'
        },
        body: offer.sdp
      });

      if (!sdpResponse.ok) {
        throw new Error('WebRTC SDP Exchange failed');
      }

      const answerSdp = await sdpResponse.text();
      await this.peerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });

    } catch (err: any) {
      this.options.onError?.(err);
    }
  }

  private sendSessionUpdate() {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') return;

    const event = {
      type: 'session.update',
      session: {
        instructions: this.options.systemPrompt || 'You are a natural, patient, clear human teacher. When teaching, use the tools to visually update the board. Never sound robotic.',
        voice: 'altair',
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 200
        },
        tools: this.getToolDefinitions(),
        tool_choice: 'auto'
      }
    };

    this.dataChannel.send(JSON.stringify(event));

    // Optional: send initial context message
    if (this.options.initialContext) {
      this.dataChannel.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: this.options.initialContext }
          ]
        }
      }));
      this.dataChannel.send(JSON.stringify({ type: 'response.create' }));
    }
  }

  private handleMessage(event: MessageEvent) {
    try {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case 'input_audio_buffer.speech_started':
          // Student interrupted
          this.options.onInterruption?.();
          break;

        case 'response.function_call_arguments.done':
          // Handle board tools
          this.executeTool(msg.name, msg.call_id, msg.arguments);
          break;
      }
    } catch (e) {
      console.error('Error handling DataChannel message', e);
    }
  }

  private executeTool(name: string, callId: string, argsStr: string) {
    try {
      const args = JSON.parse(argsStr);
      let result: any = { status: 'error', message: 'Unknown tool' };

      const ctrl = this.boardController as any;
      if (typeof ctrl[name] === 'function') {
         result = ctrl[name](args);
      }

      // Send tool output back to the model
      if (this.dataChannel && this.dataChannel.readyState === 'open') {
        this.dataChannel.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify(result)
          }
        }));
        this.dataChannel.send(JSON.stringify({ type: 'response.create' }));
      }
    } catch (e: any) {
      console.error('Tool execution failed', e);
    }
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (this.mediaStream) {
       this.mediaStream.getAudioTracks().forEach(track => {
         track.enabled = !muted;
       });
    }
  }

  public disconnect() {
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }
    if (this.playbackContext) {
      this.playbackContext.close();
      this.playbackContext = null;
    }
    this.isConnected = false;
  }

  private getToolDefinitions() {
    return [
      {
        type: 'function',
        name: 'create_element',
        description: 'Create a new visual element on the board.',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', description: 'Type of element: illustration, text, etc.' },
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
            color: { type: 'string' },
            label: { type: 'string' }
          },
          required: ['type', 'x', 'y']
        }
      },
      {
        type: 'function',
        name: 'draw',
        description: 'Draw a path/line on the board.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'array', items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } } },
            color: { type: 'string' },
            width: { type: 'number' }
          },
          required: ['path']
        }
      },
      {
        type: 'function',
        name: 'write',
        description: 'Write text on the board.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            x: { type: 'number' },
            y: { type: 'number' },
            color: { type: 'string' },
            fontSize: { type: 'string' }
          },
          required: ['text', 'x', 'y']
        }
      },
      {
        type: 'function',
        name: 'highlight_element',
        description: 'Highlight a specific element on the board.',
        parameters: {
          type: 'object',
          properties: {
            target: { type: 'string', description: 'ID of the element to highlight' },
            color: { type: 'string' }
          },
          required: ['target']
        }
      },
      {
        type: 'function',
        name: 'erase_element',
        description: 'Erase a specific element from the board.',
        parameters: {
          type: 'object',
          properties: {
            target: { type: 'string' }
          },
          required: ['target']
        }
      },
      {
        type: 'function',
        name: 'clear_board',
        description: 'Clear all elements from the board.',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    ];
  }
}
