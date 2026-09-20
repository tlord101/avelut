const fs = require('fs');

const path = 'components/tutorial/LiveSynchronizedTutorialView.tsx';
let content = fs.readFileSync(path, 'utf8');

// Imports
content = content.replace(
  "import { LiveTutorialSyncEngine } from '../../services/liveTutorialSyncEngine';",
  "import { GrokRealtimeTeacher } from '../../services/grok_realtime/GrokRealtimeTeacher';\nimport { BoardController } from '../../services/grok_realtime/BoardController';\nimport { BoardStateManager } from '../../services/boardStateManager';"
);

// Engine Refs
content = content.replace(
  "const syncEngineRef = useRef(new LiveTutorialSyncEngine());",
  "const realtimeTeacherRef = useRef<GrokRealtimeTeacher | null>(null);\n  const boardStateManagerRef = useRef(new BoardStateManager());"
);

// useEffect Hook
const useEffectRegex = /useEffect\(\(\) => \{[\s\S]*?\}, \[topicTitle, initialScript, topicComplexity, effectiveUserName\]\);/;
const newUseEffect = `useEffect(() => {
    // Setup Realtime AI Teacher with Board Controller
    const boardController = new BoardController(boardStateManagerRef.current);

    const teacher = new GrokRealtimeTeacher(boardController, {
      initialContext: \`We are learning about \${topicTitle}. Start the lesson naturally and write the topic on the board.\`,
      onInterruption: () => {
        setInterruptionQuery("Hold on, the tutor is listening...");
        setTutorClarificationText(null);
      },
      onError: (err) => {
        addToast(err.message, 'error');
      },
      onConnect: () => {
        addToast('Connected to AI Tutor!', 'success');
        setIsPlaying(true);
      },
      onDisconnect: () => {
        addToast('Tutor disconnected.', 'error');
        setIsPlaying(false);
      }
    });

    realtimeTeacherRef.current = teacher;

    // Subscribe to Board State Manager updates
    const unsubscribe = boardStateManagerRef.current.subscribe((state) => {
      // Map elements to array as expected by the canvas
      setBoardElements(Array.from(state.elements.values()) as BoardElement[]);

      if (state.focusedElementId) {
        // Find focused element
        const el = state.elements.get(state.focusedElementId);
        if (el && el.metadata && el.metadata.x) {
           setActiveFocusArea({ x: el.metadata.x, y: el.metadata.y, w: el.metadata.width || 100, h: el.metadata.height || 100, color: '#0066FF' });
        }
      } else {
        setActiveFocusArea(null);
      }
    });

    // Attempt connection
    teacher.connect();

    return () => {
      unsubscribe();
      teacher.disconnect();
    };
  }, [topicTitle, effectiveUserName]);`;

content = content.replace(useEffectRegex, newUseEffect);

// Replace handleMicToggle
const handleMicToggleRegex = /const handleMicToggle = \(\) => \{[\s\S]*?\};\s*\/\/ Student Asks a Question -> AI redraws \/ highlights board & clarifies warmly\s*const handleStudentSpokenQuery = \(query: string\) => \{[\s\S]*?\};\s*const togglePlayback = \(\) => \{[\s\S]*?\};\s*const handleStudentLassoSelect = \(elementIds: string\[\]\) => \{[\s\S]*?\};/;

const newHandlers = `const handleMicToggle = () => {
    if (isVoiceRecording) {
      realtimeTeacherRef.current?.setMuted(true);
      setIsVoiceRecording(false);
      addToast('Microphone muted.', 'info');
    } else {
      realtimeTeacherRef.current?.setMuted(false);
      setIsVoiceRecording(true);
      addToast('Microphone live.', 'success');
    }
  };

  const togglePlayback = () => {
    if (isPlaying) {
      realtimeTeacherRef.current?.disconnect();
      setIsPlaying(false);
    } else {
      realtimeTeacherRef.current?.connect();
    }
  };

  const handleStudentLassoSelect = (elementIds: string[]) => {
    const queryNotice = elementIds.length > 0
      ? \`Circled: \${elementIds.join(', ')}. What would you like explained?\`
      : 'Circled board area. What would you like explained?';
    setInterruptionQuery(queryNotice);
    addToast(queryNotice, 'info');
  };`;

content = content.replace(handleMicToggleRegex, newHandlers);

// Remove specific modal "syncEngineRef.current.play();" calls
content = content.replace(/syncEngineRef\.current\.play\(\);/g, "/* realtimeTeacherRef.current?.connect(); */");
content = content.replace(/syncEngineRef\.current\.pause\(\);/g, "/* realtimeTeacherRef.current?.disconnect(); */");

fs.writeFileSync(path, content, 'utf8');
console.log('Replaced');
