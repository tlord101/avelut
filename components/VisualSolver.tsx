import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI } from '@google/genai';
import type { UserProfile } from '../types';
import { useApiLimiter } from '../hooks/useApiLimiter';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { useToast } from '../hooks/useToast';
import { GraduationCapIcon } from './icons/GraduationCapIcon';

// @ts-ignore
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// --- INLINE ICONS ---
const ShutterIcon: React.FC<{ className?: string }> = ({ className = 'w-16 h-16' }) => (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
        <circle cx="32" cy="32" r="30" fill="white" fillOpacity="0.2" />
        <circle cx="32" cy="32" r="26" stroke="white" strokeWidth="4" />
    </svg>
);
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
        <div className="w-full h-full flex flex-col bg-white">
            <div className="flex-shrink-0 h-[33vh] bg-gray-100 border-b border-gray-200">
                <img src={scannedImage} alt="Scanned problem" className="w-full h-full object-contain" />
            </div>
            <div className="flex-1 p-4 sm:p-6 overflow-hidden min-h-0">
                <div className="max-w-none text-gray-800 h-full overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[rehypeKatex]}
                        components={{
                            p: ({node, ...props}) => <p className="mb-4 text-base leading-relaxed" {...props} />,
                            h1: ({node, ...props}) => <h1 className="text-2xl font-bold text-gray-900 mb-4 border-b border-gray-200 pb-2" {...props} />,
                            h2: ({node, ...props}) => <h2 className="text-xl font-bold text-gray-900 mb-3" {...props} />,
                            strong: ({node, ...props}) => <strong className="font-bold text-gray-900" {...props} />,
                            ul: ({node, ...props}) => <ul className="list-disc list-inside space-y-2 my-4 pl-2" {...props} />,
                        }}
                    >
                        {tutorialText}
                    </ReactMarkdown>
                </div>
            </div>
            <div className="flex-shrink-0 p-4 border-t border-gray-200 bg-white/80 backdrop-blur-sm grid grid-cols-1 gap-3">
                <button onClick={onClose} className="w-full bg-gray-200 text-gray-800 font-bold py-3 px-4 rounded-lg hover:bg-gray-300 transition-colors">
                    Scan Another
                </button>
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
}


export const VisualSolver: React.FC<VisualSolverProps> = ({ userProfile, onStartChat }) => {
    const [cameraState, setCameraState] = useState<CameraState>('initializing');
    const [scannedImage, setScannedImage] = useState<string | null>(null);
    const [analysisResult, setAnalysisResult] = useState<string>('');
    const [error, setError] = useState<string>('');
    const [cropBox, setCropBox] = useState<CropBox>({ x: 0.05, y: 0.125, width: 0.9, height: 0.75 });
    
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const interactionRef = useRef<{
        startX: number; startY: number; initialCropBox: CropBox; videoRect: DOMRect;
        type: 'drag' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br' | 'resize-t' | 'resize-b' | 'resize-l' | 'resize-r';
    } | null>(null);


    const { attemptApiCall } = useApiLimiter();
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
        window.removeEventListener('touchmove', handleMove);
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

    const handleAnalyze = useCallback(async () => {
        if (!scannedImage) return;

        setCameraState('analyzing');
        
        const result = await attemptApiCall(async () => {
            const base64Data = scannedImage.split(',')[1];
            if (!base64Data) throw new Error("Could not extract image data.");
            
            const promptText = `You are VANTUTOR, an expert AI educator. Analyze the problem in the image and provide a clear, step-by-step tutorial on how to solve it. Break down the solution into simple, easy-to-understand steps. Use Markdown for formatting and LaTeX for any mathematical equations.`;

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: { parts: [
                    { inlineData: { data: base64Data, mimeType: 'image/jpeg' } },
                    { text: promptText }
                ]},
            });

            setAnalysisResult(response.text);
        });
        
        if (result.success) {
            setCameraState('showingTutorial');
        } else {
            addToast(result.message || "Failed to analyze the image. Please try again.", 'error');
            setCameraState('preview');
        }
    }, [scannedImage, attemptApiCall, addToast]);

    const handleQuickAnswer = useCallback(async () => {
        if (!scannedImage) return;
    
        setCameraState('analyzing');
        
        const result = await attemptApiCall(async () => {
            const base64Data = scannedImage.split(',')[1];
            if (!base64Data) throw new Error("Could not extract image data.");
            
            const promptText = `Analyze the problem in the image and provide only the final answer, without any explanation or steps. Be direct and concise.`;
    
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: { parts: [
                    { inlineData: { data: base64Data, mimeType: 'image/jpeg' } },
                    { text: promptText }
                ]},
            });
    
            setAnalysisResult(response.text);
        });
        
        if (result.success) {
            setCameraState('showingTutorial');
        } else {
            addToast(result.message || "Failed to analyze the image. Please try again.", 'error');
            setCameraState('preview');
        }
    }, [scannedImage, attemptApiCall, addToast]);

    const handleSolution = useCallback(async () => {
        if (!scannedImage) return;
    
        setCameraState('analyzing');
        
        const result = await attemptApiCall(async () => {
            const base64Data = scannedImage.split(',')[1];
            if (!base64Data) throw new Error("Could not extract image data.");
            
            const promptText = `Answer the question or solve the problem shown in the image. Provide a clear, concise solution without unnecessary details or lengthy explanations. Give the answer directly as it was asked.`;
    
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: { parts: [
                    { inlineData: { data: base64Data, mimeType: 'image/jpeg' } },
                    { text: promptText }
                ]},
            });
    
            setAnalysisResult(response.text);
        });
        
        if (result.success) {
            setCameraState('showingTutorial');
        } else {
            addToast(result.message || "Failed to analyze the image. Please try again.", 'error');
            setCameraState('preview');
        }
    }, [scannedImage, attemptApiCall, addToast]);

    const handleRetake = () => {
        setScannedImage(null);
        setAnalysisResult('');
        setError('');
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
                return <div className="flex flex-col items-center justify-center h-full"><svg className="w-12 h-12 loader-logo" viewBox="0 0 52 42" fill="none" xmlns="http://www.w3.org/2000/svg"><path className="loader-path-1" d="M4.33331 17.5L26 4.375L47.6666 17.5L26 30.625L4.33331 17.5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path className="loader-path-2" d="M41.5 21V29.75C41.5 30.825 40.85 32.55 39.4166 33.25L27.75 39.375C26.6666 39.9 25.3333 39.9 24.25 39.375L12.5833 33.25C11.15 32.55 10.5 30.825 10.5 29.75V21" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path className="loader-path-3" d="M47.6667 17.5V26.25" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg><p className="mt-4 text-gray-700">Starting camera...</p></div>;

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
                        <div className="flex-shrink-0 flex justify-center items-center gap-4 h-28 bg-gray-100">
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
                            <button onClick={handleScan} aria-label="Scan problem" className="p-2 bg-white/50 rounded-full transition-transform active:scale-95 shadow-lg">
                                <ShutterIcon />
                            </button>
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
                                <svg className="w-12 h-12 loader-logo" viewBox="0 0 52 42" fill="none" xmlns="http://www.w3.org/2000/svg"><path className="loader-path-1" d="M4.33331 17.5L26 4.375L47.6666 17.5L26 30.625L4.33331 17.5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path className="loader-path-2" d="M41.5 21V29.75C41.5 30.825 40.85 32.55 39.4166 33.25L27.75 39.375C26.6666 39.9 25.3333 39.9 24.25 39.375L12.5833 33.25C11.15 32.55 10.5 30.825 10.5 29.75V21" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path className="loader-path-3" d="M47.6667 17.5V26.25" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
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
                                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-6 pt-12">
                                    <div className="max-w-sm mx-auto space-y-3">
                                        <button 
                                            onClick={handleAnalyze} 
                                            className="w-full bg-gradient-to-r from-lime-600 to-lime-500 text-white font-bold py-4 px-6 rounded-xl hover:from-lime-700 hover:to-lime-600 transition-all shadow-xl text-lg flex items-center justify-center gap-2 active:scale-95"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                            </svg>
                                            Detailed Tutorial
                                        </button>
                                        <button 
                                            onClick={handleSolution} 
                                            className="w-full bg-white/20 backdrop-blur-sm border-2 border-white text-white font-bold py-4 px-6 rounded-xl hover:bg-white/30 transition-all shadow-xl text-lg flex items-center justify-center gap-2 active:scale-95"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                            Solution
                                        </button>
                                        <button 
                                            onClick={handleQuickAnswer} 
                                            className="w-full bg-white/20 backdrop-blur-sm border-2 border-white text-white font-bold py-4 px-6 rounded-xl hover:bg-white/30 transition-all shadow-xl text-lg flex items-center justify-center gap-2 active:scale-95"
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
            <div className="flex-1 bg-gray-300 rounded-xl border border-gray-200 overflow-hidden relative">
                <canvas ref={canvasRef} className="hidden"></canvas>
                {renderContent()}
            </div>
        </div>
    );
};