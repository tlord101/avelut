import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { db } from '../firebase';
import { ref as dbRef, onValue } from 'firebase/database';
import { checkAICredits, deductAICredits, getFeatureCost, getFeatureModel } from '../utils/usage';
import { LimitExceededModal } from './LimitExceededModal';
import { createAvelutAI, getResponseText } from '../utils/inference';
import type { UserProfile } from '../types';
import { useApiLimiter } from '../hooks/useApiLimiter';
import { useAppSettings } from '../hooks/useAppSettings';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { useToast } from '../hooks/useToast';
// --- INLINE ICONS ---
const ErrorIcon: React.FC<{ className?: string }> = ({ className = 'w-8 h-8' }) => (
     <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
     </svg>
);
const ArrowLeftIcon: React.FC<{ className?: string }> = ({ className = 'w-6 h-6' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={className}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
);


// --- TUTORIAL DISPLAY COMPONENT ---
interface TutorialDisplayProps {
    scannedImage: string;
    tutorialText: string;
    onClose: () => void;
}

const TutorialDisplay: React.FC<TutorialDisplayProps> = ({ scannedImage, tutorialText, onClose }) => {
    return (
        <div className="w-full h-full flex flex-col bg-gradient-to-b from-gray-50 to-white">
            <div className="flex-shrink-0 h-[33vh] bg-gradient-to-br from-indigo-50 to-blue-50 border-b-2 border-indigo-200 shadow-sm">
                <img src={scannedImage} alt="Scanned problem" className="w-full h-full object-contain p-2" />
            </div>
            <div className="flex-1 px-4 py-6 sm:px-8 sm:py-8 overflow-hidden min-h-0">
                <div className="max-w-4xl mx-auto h-full">
                    <div className="h-full overflow-y-auto pr-2 [scrollbar-width:thin] [scrollbar-color:#cbd5e1_#f1f5f9] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-gray-100 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-gray-400">
                        <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkMath]}
                            rehypePlugins={[rehypeKatex]}
                            components={{
                                // Main headings - Problem Title
                                h1: ({node, ...props}) => (
                                    <h1 className="text-3xl sm:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-blue-600 mb-6 pb-4 border-b-2 border-indigo-200 mt-2" {...props} />
                                ),
                                // Section headings - Steps, Analysis, etc.
                                h2: ({node, ...props}) => (
                                    <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-4 mt-8 pt-4 border-t border-gray-200 flex items-center gap-3 before:content-['▸'] before:text-indigo-500" {...props} />
                                ),
                                // Sub-sections
                                h3: ({node, ...props}) => (
                                    <h3 className="text-xl sm:text-2xl font-semibold text-indigo-700 mb-3 mt-6 pl-4 border-l-4 border-indigo-400" {...props} />
                                ),
                                // Minor headings
                                h4: ({node, ...props}) => (
                                    <h4 className="text-lg sm:text-xl font-semibold text-gray-800 mb-2 mt-4" {...props} />
                                ),
                                // Paragraphs with better spacing and readability
                                p: ({node, ...props}) => (
                                    <p className="mb-5 text-base sm:text-lg leading-relaxed text-gray-700 tracking-wide" {...props} />
                                ),
                                // Bold text - for key concepts
                                strong: ({node, ...props}) => (
                                    <strong className="font-bold text-gray-900 bg-yellow-100 px-1.5 py-0.5 rounded" {...props} />
                                ),
                                // Italic text - for emphasis
                                em: ({node, ...props}) => (
                                    <em className="italic text-indigo-600 font-medium" {...props} />
                                ),
                                // Unordered lists with better styling
                                ul: ({node, ...props}) => (
                                    <ul className="list-none space-y-3 my-5 pl-1" {...props} />
                                ),
                                // List items with custom bullets
                                li: ({node, ...props}) => (
                                    <li className="flex items-start gap-3 text-base sm:text-lg text-gray-700 leading-relaxed before:content-['●'] before:text-indigo-500 before:font-bold before:text-xl before:mt-0.5 before:flex-shrink-0" {...props} />
                                ),
                                // Ordered lists for steps
                                ol: ({node, ...props}) => (
                                    <ol className="list-none space-y-4 my-6 counter-reset-[step]" {...props} />
                                ),
                                // Code blocks with syntax highlighting style
                                code: ({node, inline, ...props}: any) => 
                                    inline ? (
                                        <code className="bg-indigo-50 text-indigo-700 px-2 py-1 rounded font-mono text-sm border border-indigo-200" {...props} />
                                    ) : (
                                        <code className="block bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto my-4 font-mono text-sm leading-relaxed border-l-4 border-indigo-500" {...props} />
                                    ),
                                // Pre blocks for code
                                pre: ({node, ...props}) => (
                                    <pre className="bg-gray-900 rounded-lg overflow-hidden my-5 shadow-lg" {...props} />
                                ),
                                // Blockquotes for important notes
                                blockquote: ({node, ...props}) => (
                                    <blockquote className="border-l-4 border-amber-400 bg-amber-50 pl-6 pr-4 py-4 my-5 rounded-r-lg shadow-sm" {...props} />
                                ),
                                // Tables with better styling
                                table: ({node, ...props}) => (
                                    <div className="overflow-x-auto my-6 shadow-md rounded-lg">
                                        <table className="min-w-full divide-y divide-gray-200 border border-gray-200" {...props} />
                                    </div>
                                ),
                                thead: ({node, ...props}) => (
                                    <thead className="bg-indigo-600 text-white" {...props} />
                                ),
                                tbody: ({node, ...props}) => (
                                    <tbody className="bg-white divide-y divide-gray-200" {...props} />
                                ),
                                tr: ({node, ...props}) => (
                                    <tr className="hover:bg-gray-50 transition-colors" {...props} />
                                ),
                                th: ({node, ...props}) => (
                                    <th className="px-6 py-4 text-left text-sm font-bold uppercase tracking-wider" {...props} />
                                ),
                                td: ({node, ...props}) => (
                                    <td className="px-6 py-4 text-sm text-gray-700" {...props} />
                                ),
                                // Horizontal rules
                                hr: ({node, ...props}) => (
                                    <hr className="my-8 border-t-2 border-gray-200" {...props} />
                                ),
                            }}
                        >
                            {tutorialText}
                        </ReactMarkdown>
                    </div>
                </div>
            </div>
            <div className="flex-shrink-0 p-4 sm:p-6 border-t-2 border-gray-200 bg-white/90 backdrop-blur-md shadow-lg">
                <div className="max-w-4xl mx-auto">
                    <button 
                        onClick={onClose} 
                        className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-4 px-6 rounded-xl transition-all duration-200 transform active:scale-[0.98] flex items-center justify-center gap-2"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        Scan Another Problem
                    </button>
                </div>
            </div>
        </div>
    );
};


// --- MAIN VISUAL SOLVER COMPONENT ---
type CameraState = 'initializing' | 'denied' | 'error' | 'ready' | 'scanning' | 'preview' | 'analyzing' | 'showingTutorial';
interface CropBox {
    x: number; y: number; width: number; height: number;
}
const MIN_CROP_SIZE = 0.2; // 20%

interface VisualSolverProps {
  userProfile: UserProfile;
  onStartChat: (image: string, tutorialText: string) => void;
  triggerScanRef?: React.MutableRefObject<(() => void) | null>;
}


export const VisualSolver: React.FC<VisualSolverProps> = ({ userProfile, onStartChat, triggerScanRef }) => {
    const [cameraState, setCameraState] = useState<CameraState>('initializing');
    const [scannedImage, setScannedImage] = useState<string | null>(null);
    const [analysisResult, setAnalysisResult] = useState<string>('');
    const [error, setError] = useState<string>('');
    const [cropBox, setCropBox] = useState<CropBox>({ x: 0.05, y: 0.125, width: 0.9, height: 0.75 });
    const [customPrompt, setCustomPrompt] = useState<string>('');

    const [showLimitModal, setShowLimitModal] = useState(false);
    const [limitModalData, setLimitModalData] = useState({ balance: 0, cost: 0 });
    
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const interactionRef = useRef<{
        startX: number; startY: number; initialCropBox: CropBox; videoRect: DOMRect;
        type: 'drag' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br' | 'resize-t' | 'resize-b' | 'resize-l' | 'resize-r';
    } | null>(null);


    const { attemptApiCall } = useApiLimiter();
    const { settings: appSettings } = useAppSettings();
    const geminiModel = getFeatureModel('visual_solve', appSettings);
    const aiClient = useMemo(() => createAvelutAI(appSettings, userProfile), [appSettings, userProfile]);
    const { addToast } = useToast();

    const cleanupCamera = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        if(videoRef.current) {
            videoRef.current.srcObject = null;
        }
    }, []);

    const handleInteractionEnd = useCallback(() => {
        interactionRef.current = null;
        document.body.style.overflow = '';
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('touchmove', handleMove, { passive: false } as any);
        window.removeEventListener('mouseup', handleInteractionEnd);
        window.removeEventListener('touchend', handleInteractionEnd);
    }, []);

    const handleMove = useCallback((e: MouseEvent | TouchEvent) => {
        if (!interactionRef.current) return;
        if (e.cancelable) e.preventDefault();

        const { startX, startY, initialCropBox, videoRect, type } = interactionRef.current;
        const currentX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const currentY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        const dx = (currentX - startX) / videoRect.width;
        const dy = (currentY - startY) / videoRect.height;

        let { x, y, width, height } = initialCropBox;

        if (type === 'drag') {
            x += dx; y += dy;
        } else {
            if (type.includes('l')) { x += dx; width -= dx; }
            if (type.includes('r')) { width += dx; }
            if (type.includes('t')) { y += dy; height -= dy; }
            if (type.includes('b')) { height += dy; }
        }
        
        if (width < 0) { x += width; width = Math.abs(width); }
        if (height < 0) { y += height; height = Math.abs(height); }

        width = Math.max(MIN_CROP_SIZE, width);
        height = Math.max(MIN_CROP_SIZE, height);

        x = Math.max(0, Math.min(x, 1 - width));
        y = Math.max(0, Math.min(y, 1 - height));
        
        if (x + width > 1) width = 1 - x;
        if (y + height > 1) height = 1 - y;

        setCropBox({ x, y, width, height });
    }, []);

    const handleInteractionStart = useCallback((
        e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>,
        type: NonNullable<typeof interactionRef.current>['type']
    ) => {
        e.stopPropagation();
        e.preventDefault();
        const video = videoRef.current;
        if (!video) return;

        document.body.style.overflow = 'hidden';

        interactionRef.current = {
            startX: 'touches' in e ? e.touches[0].clientX : e.clientX,
            startY: 'touches' in e ? e.touches[0].clientY : e.clientY,
            initialCropBox: cropBox,
            videoRect: video.getBoundingClientRect(),
            type,
        };

        window.addEventListener('mousemove', handleMove);
        window.addEventListener('touchmove', handleMove, { passive: false });
        window.addEventListener('mouseup', handleInteractionEnd);
        window.addEventListener('touchend', handleInteractionEnd);
    }, [cropBox, handleMove, handleInteractionEnd]);

    const initializeCamera = useCallback(async () => {
        cleanupCamera();
        setCameraState('initializing');
        setError('');

        try {
            const mediaStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: "environment" } }
            });
            streamRef.current = mediaStream;
            setCameraState('ready');
        } catch (err) {
            console.error("Error accessing camera:", err);
            if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
                setError("Camera permission denied. Please enable camera access in your browser settings to use this feature.");
                setCameraState('denied');
            } else {
                setError("Could not access camera. It might be in use by another application or not available on this device.");
                setCameraState('error');
            }
        }
    }, [cleanupCamera]);
    
    useEffect(() => {
        if (cameraState === 'ready' && videoRef.current && streamRef.current) {
            videoRef.current.srcObject = streamRef.current;
        }
    }, [cameraState]);

    useEffect(() => {
        initializeCamera();
        return cleanupCamera;
    }, [initializeCamera, cleanupCamera]);

    const handleScan = useCallback(() => {
        const video = videoRef.current;
        const canvas = canvasRef.current;

        if (!video || !canvas || video.readyState < 2) {
             addToast('Camera not ready. Please wait a moment.', 'error');
             setCameraState('error');
             return;
        }

        setCameraState('scanning');
        
        const videoWidth = video.videoWidth;
        const videoHeight = video.videoHeight;
        const videoElWidth = video.offsetWidth;
        const videoElHeight = video.offsetHeight;
        const videoAspectRatio = videoWidth / videoHeight;
        const videoElAspectRatio = videoElWidth / videoElHeight;

        let sWidth = videoWidth, sHeight = videoHeight, sX = 0, sY = 0;
        if (videoAspectRatio > videoElAspectRatio) {
            sWidth = videoHeight * videoElAspectRatio;
            sX = (videoWidth - sWidth) / 2;
        } else {
            sHeight = videoWidth / videoElAspectRatio;
            sY = (videoHeight - sHeight) / 2;
        }

        const { x: relX, y: relY, width: relW, height: relH } = cropBox;
        const cropX = sX + relX * sWidth;
        const cropY = sY + relY * sHeight;
        const cropWidth = relW * sWidth;
        const cropHeight = relH * sHeight;

        canvas.width = cropWidth;
        canvas.height = cropHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            addToast('Could not process image.', 'error');
            setCameraState('error');
            return;
        }
        ctx.filter = 'contrast(1.5) brightness(1.1) grayscale(0.2)';
        ctx.drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
        const imageDataUrl = canvas.toDataURL('image/jpeg', 0.9);
        setScannedImage(imageDataUrl);
        setTimeout(() => setCameraState('preview'), 500);
    }, [cropBox, addToast]);

    useEffect(() => {
        if (triggerScanRef) {
            triggerScanRef.current = handleScan;
        }
        return () => {
            if (triggerScanRef) {
                triggerScanRef.current = null;
            }
        };
    }, [handleScan, triggerScanRef]);

    const handleAnalyze = useCallback(async () => {
        if (!scannedImage) return;

        // Perform limit check
        const cost = getFeatureCost('visual_solve', appSettings);
        const limitCheck = checkAICredits(userProfile, cost, appSettings);
        if (!limitCheck.allowed) {
            setLimitModalData({
                balance: limitCheck.balance,
                cost: limitCheck.cost
            });
            setShowLimitModal(true);
            return;
        }

        setCameraState('analyzing');
        setError('');
        
        try {
            const result = await attemptApiCall(async () => {
                const base64Data = scannedImage.split(',')[1];
                if (!base64Data) throw new Error("Could not extract image data.");

                let retrievedContext = "";
                if (customPrompt) {
                    try {
                        const { searchPinecone } = await import('../utils/pinecone');
                        const searchResult = await searchPinecone(customPrompt, undefined, 3, appSettings);
                        if (searchResult.success && searchResult.results && searchResult.results.length > 0) {
                            retrievedContext = "\n\nRELEVANT TEXTBOOK EXCERPTS:\n" + searchResult.results.map((r: any) => r.text).join('\n\n');
                        }
                    } catch (err) {
                        console.warn("RAG retrieval failed:", err);
                    }
                }

                const basePrompt = `Expert AI educator. Solve the image problem fast. Use LaTeX for math ($...$, $$...$$).`;
                const customInstruction = customPrompt ? ` User instructions: ${customPrompt}` : '';
                const promptText = `${basePrompt}${customInstruction}
${retrievedContext}
# [Title]
## 📋 Summary
[Concise summary]
## 🔢 Solution
[Numbered steps with math]
## ✅ Answer
[Final Answer]`;

                if (!aiClient) throw new Error('AI client not available');
                const aiResult = await aiClient.models.generateContent({
                    model: geminiModel || 'gemini-3.1-flash-lite',
                    contents: [{ role: 'user', parts: [
                        { inlineData: { data: base64Data, mimeType: 'image/jpeg' } },
                        { text: promptText }
                    ]}],
                });

                const finalResult = getResponseText(aiResult);
                if (!finalResult) throw new Error("AI returned an empty analysis.");

                setAnalysisResult(finalResult);

                // Deduct credits as soon as we have a result
                await deductAICredits(userProfile.uid, cost, 'Visual Solver - Detailed', appSettings);

                // Allow UI to transition immediately after we have the data
                setCameraState('showingTutorial');
                return finalResult;
            });

            if (!result.success) {
                addToast(result.message || "Failed to analyze the image. Please try again.", 'error');
                setCameraState('preview');
            }
        } catch (err: any) {
            console.error("Analysis failed:", err);
            setError(err.message || "Failed to connect to the solver.");
            setCameraState('preview');
        }
    }, [scannedImage, attemptApiCall, customPrompt, aiClient, geminiModel, userProfile, appSettings, addToast]);

    const handleQuickAnswer = useCallback(async () => {
        if (!scannedImage) return;
    
        // Perform limit check
        const cost = getFeatureCost('visual_solve', appSettings);
        const limitCheck = checkAICredits(userProfile, cost, appSettings);
        if (!limitCheck.allowed) {
            setLimitModalData({
                balance: limitCheck.balance,
                cost: limitCheck.cost
            });
            setShowLimitModal(true);
            return;
        }

        setCameraState('analyzing');
        setError('');
        
        try {
            const result = await attemptApiCall(async () => {
                const base64Data = scannedImage.split(',')[1];
                if (!base64Data) throw new Error("Could not extract image data.");

                const basePrompt = `Analyze the problem in the image and provide only the final answer, without any explanation or steps. Be direct and concise.`;
                const customInstruction = customPrompt ? ` ${customPrompt}` : '';
                const promptText = `${basePrompt}${customInstruction}`;
        
                if (!aiClient) throw new Error('AI client not available');
                const aiResult = await aiClient.models.generateContent({
                    model: geminiModel || 'gemini-3.1-flash-lite',
                    contents: [{ role: 'user', parts: [
                        { inlineData: { data: base64Data, mimeType: 'image/jpeg' } },
                        { text: promptText }
                    ]}],
                });

                const finalResult = getResponseText(aiResult);
                if (!finalResult) throw new Error("AI returned an empty response.");

                setAnalysisResult(finalResult);
                await deductAICredits(userProfile.uid, cost, 'Visual Solver - Quick Answer', appSettings);
                setCameraState('showingTutorial');
                return finalResult;
            });

            if (!result.success) {
                addToast(result.message || "Failed to analyze the image. Please try again.", 'error');
                setCameraState('preview');
            }
        } catch (err: any) {
            console.error("Quick answer failed:", err);
            setError(err.message || "Failed to connect to the solver.");
            setCameraState('preview');
        }
    }, [scannedImage, attemptApiCall, customPrompt, aiClient, geminiModel, userProfile, appSettings, addToast]);

    const handleSolution = useCallback(async () => {
        if (!scannedImage) return;
    
        // Perform limit check
        const cost = getFeatureCost('visual_solve', appSettings);
        const limitCheck = checkAICredits(userProfile, cost, appSettings);
        if (!limitCheck.allowed) {
            setLimitModalData({
                balance: limitCheck.balance,
                cost: limitCheck.cost
            });
            setShowLimitModal(true);
            return;
        }

        setCameraState('analyzing');
        setError('');
        
        try {
            const result = await attemptApiCall(async () => {
                const base64Data = scannedImage.split(',')[1];
                if (!base64Data) throw new Error("Could not extract image data.");

                const basePrompt = `Answer the question or solve the problem shown in the image. Provide a clear, concise solution without unnecessary details or lengthy explanations. Give the answer directly as it was asked.`;
                const customInstruction = customPrompt ? ` ${customPrompt}` : '';
                const promptText = `${basePrompt}${customInstruction}`;
        
                if (!aiClient) throw new Error('AI client not available');
                const aiResult = await aiClient.models.generateContent({
                    model: geminiModel || 'gemini-3.1-flash-lite',
                    contents: [{ role: 'user', parts: [
                        { inlineData: { data: base64Data, mimeType: 'image/jpeg' } },
                        { text: promptText }
                    ]}],
                });

                const finalResult = getResponseText(aiResult);
                if (!finalResult) throw new Error("AI returned an empty solution.");

                setAnalysisResult(finalResult);
                await deductAICredits(userProfile.uid, cost, 'Visual Solver - Solution', appSettings);
                setCameraState('showingTutorial');
                return finalResult;
            });

            if (!result.success) {
                addToast(result.message || "Failed to analyze the image. Please try again.", 'error');
                setCameraState('preview');
            }
        } catch (err: any) {
            console.error("Solution failed:", err);
            setError(err.message || "Failed to connect to the solver.");
            setCameraState('preview');
        }
    }, [scannedImage, attemptApiCall, customPrompt, aiClient, geminiModel, userProfile, appSettings, addToast]);

    const handleRetake = () => {
        setScannedImage(null);
        setAnalysisResult('');
        setError('');
        setCustomPrompt('');
        initializeCamera();
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            addToast('Please select an image file.', 'error');
            return;
        }

        if (file.size > 5 * 1024 * 1024) { // 5MB limit
            addToast('Image must be under 5MB.', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            const imageDataUrl = event.target?.result as string;
            setScannedImage(imageDataUrl);
            setCameraState('preview');
        };
        reader.onerror = () => {
            addToast('Could not read the image file.', 'error');
        };
        reader.readAsDataURL(file);

        // Reset input so the same file can be selected again
        e.target.value = '';
    };

    const renderContent = () => {
        switch (cameraState) {
            case 'initializing':
                return <div className="flex flex-col items-center justify-center h-full"><img src="/logo_icon.png" alt="AVELUT" className="w-12 h-12 object-contain animate-pulse" /><p className="mt-4 text-gray-700">Starting camera...</p></div>;

            case 'denied':
                return <div className="flex flex-col items-center justify-center h-full text-center p-4"><ErrorIcon className="w-12 h-12 text-yellow-500 mb-4" /><h3 className="text-xl font-semibold">Camera Access Denied</h3><p className="text-gray-600 mt-2 max-w-sm">{error}</p><button onClick={initializeCamera} className="mt-6 bg-gray-200 text-gray-800 font-bold py-2 px-6 rounded-full hover:bg-gray-300 transition-colors">Retry</button></div>;

            case 'error':
                return <div className="flex flex-col items-center justify-center h-full text-center p-4"><ErrorIcon className="w-12 h-12 text-red-500 mb-4" /><h3 className="text-xl font-semibold">Camera Error</h3><p className="text-gray-600 mt-2 max-w-sm">{error}</p><button onClick={initializeCamera} className="mt-6 bg-gray-200 text-gray-800 font-bold py-2 px-6 rounded-full hover:bg-gray-300 transition-colors">Retry</button></div>;
            
            case 'ready':
            case 'scanning':
                const resizeHandles = [
                    { type: 'resize-tl', cursor: 'cursor-nwse-resize', pos: 'top-[-8px] left-[-8px] w-4 h-4' },
                    { type: 'resize-tr', cursor: 'cursor-nesw-resize', pos: 'top-[-8px] right-[-8px] w-4 h-4' },
                    { type: 'resize-bl', cursor: 'cursor-nesw-resize', pos: 'bottom-[-8px] left-[-8px] w-4 h-4' },
                    { type: 'resize-br', cursor: 'cursor-nwse-resize', pos: 'bottom-[-8px] right-[-8px] w-4 h-4' },
                    { type: 'resize-t', cursor: 'cursor-ns-resize', pos: 'top-[-5px] left-1/2 -translate-x-1/2 w-10 h-2.5' },
                    { type: 'resize-b', cursor: 'cursor-ns-resize', pos: 'bottom-[-5px] left-1/2 -translate-x-1/2 w-10 h-2.5' },
                    { type: 'resize-l', cursor: 'cursor-ew-resize', pos: 'left-[-5px] top-1/2 -translate-y-1/2 h-10 w-2.5' },
                    { type: 'resize-r', cursor: 'cursor-ew-resize', pos: 'right-[-5px] top-1/2 -translate-y-1/2 h-10 w-2.5' },
                ] as const;
                return (
                    <div className="w-full h-full flex flex-col bg-black">
                        {/* Camera View Area */}
                        <div className="flex-1 relative overflow-hidden">
                            <video ref={videoRef} playsInline autoPlay muted className="w-full h-full object-cover"></video>
                            <div 
                                style={{ 
                                    left: `${cropBox.x * 100}%`, top: `${cropBox.y * 100}%`,
                                    width: `${cropBox.width * 100}%`, height: `${cropBox.height * 100}%`
                                }}
                                className={`absolute border-4 border-dashed rounded-lg cursor-move transition-colors duration-300 
                                    ${cameraState === 'scanning' ? 'border-lime-400 animate-[scan-pulse_1s_ease-in-out_infinite]' : 'border-white/80'}`}
                                onMouseDown={(e) => handleInteractionStart(e, 'drag')}
                                onTouchStart={(e) => handleInteractionStart(e, 'drag')}
                            >
                                <div className="absolute inset-0" style={{ boxShadow: '0 0 0 2000px rgba(0,0,0,0.5)' }}></div>
                                {resizeHandles.map(handle => (
                                    <div key={handle.type} 
                                        className={`absolute ${handle.pos} ${handle.cursor} z-10`}
                                        onMouseDown={(e) => handleInteractionStart(e, handle.type)}
                                        onTouchStart={(e) => handleInteractionStart(e, handle.type)}
                                    >
                                        <div className="w-full h-full bg-lime-400/80 rounded-full border-2 border-white/80"></div>
                                    </div>
                                ))}
                            </div>
                            <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white bg-black/50 px-3 py-1 text-sm rounded-full pointer-events-none w-fit text-center">
                                Drag and resize to frame the problem
                            </div>
                        </div>
                        {/* Shutter Button Area */}
                        <div className="flex-shrink-0 flex items-center h-16 bg-gray-100 px-4 justify-end">
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                aria-label="Upload photo"
                                className="flex items-center gap-2 px-4 py-3 bg-gray-700 text-white rounded-full hover:bg-gray-800 transition-colors shadow-lg font-semibold"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                Upload Photo
                            </button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                onChange={handleFileUpload}
                                className="hidden"
                            />
                        </div>
                    </div>
                );
            
            case 'preview':
            case 'analyzing':
                return (
                    <div className="relative w-full h-full flex flex-col items-center justify-center bg-gray-900">
                        {scannedImage && <img src={scannedImage} alt="Scanned problem" className="w-full h-full object-contain" />}
                        {cameraState === 'analyzing' && (
                            <div className="absolute inset-0 bg-white/80 flex flex-col items-center justify-center text-gray-900">
                                <img src="/logo_icon.png" alt="AVELUT" className="w-12 h-12 object-contain animate-pulse" />
                                <p className="mt-4 text-lg font-semibold">Analyzing...</p>
                                <p className="text-gray-600">This may take a moment.</p>
                            </div>
                        )}
                        {cameraState === 'preview' && (
                            <>
                                <div className="absolute top-4 left-4">
                                    <button onClick={handleRetake} className="flex items-center gap-1 p-2 px-3 bg-black/40 text-white rounded-lg hover:bg-black/60 transition-colors shadow backdrop-blur-sm">
                                        <ArrowLeftIcon className="w-5 h-5" />
                                        <span className="font-semibold">Back</span>
                                    </button>
                                </div>
                                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-4 sm:p-6 pt-8 sm:pt-12 max-h-full overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                    <div className="max-w-sm mx-auto space-y-2 sm:space-y-3 pb-safe">
                                        <div className="mb-2 sm:mb-4">
                                            <textarea
                                                value={customPrompt}
                                                onChange={(e) => setCustomPrompt(e.target.value)}
                                                placeholder="Optional: Add custom instructions (e.g., 'Explain this step by step', 'Focus on the methodology', etc.)"
                                                className="w-full bg-white/20 backdrop-blur-sm border-2 border-white/50 text-white placeholder-white/70 rounded-xl p-2 sm:p-3 text-xs sm:text-sm resize-none focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400 transition-all"
                                                rows={2}
                                            />
                                        </div>
                                        <button 
                                            onClick={handleAnalyze} 
                                            className="w-full bg-emerald-600 text-white font-bold py-4 px-6 rounded-xl hover:bg-emerald-500 transition-all text-lg flex items-center justify-center gap-2 active:scale-95"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                            </svg>
                                            Detailed Tutorial
                                        </button>
                                        <button 
                                            onClick={handleSolution} 
                                            className="w-full bg-white/20 border border-white/50 text-white font-bold py-4 px-6 rounded-xl hover:bg-white/30 transition-all text-lg flex items-center justify-center gap-2 active:scale-95"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                            Solution
                                        </button>
                                        <button 
                                            onClick={handleQuickAnswer} 
                                            className="w-full bg-white/20 border border-white/50 text-white font-bold py-4 px-6 rounded-xl hover:bg-white/30 transition-all text-lg flex items-center justify-center gap-2 active:scale-95"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                            </svg>
                                            Quick Answer
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                );
            
            case 'showingTutorial':
                if (!scannedImage) return null;
                return <TutorialDisplay
                    scannedImage={scannedImage}
                    tutorialText={analysisResult}
                    onClose={handleRetake}
                />;

            default:
                return null;
        }
    };

    return (
        <div className="flex-1 flex flex-col w-full">
            <div className="h-[calc(100vh-90px)] bg-gray-300 rounded-xl border border-gray-200 overflow-hidden relative">
                <canvas ref={canvasRef} className="hidden"></canvas>
                {renderContent()}
            </div>
            <LimitExceededModal
                isOpen={showLimitModal}
                onClose={() => setShowLimitModal(false)}
                userProfile={userProfile}
                appSettings={appSettings}
                cost={limitModalData.cost}
                balance={limitModalData.balance}
                addToast={addToast}
                onSuccessPurchase={() => {}}
            />
        </div>
    );
};
