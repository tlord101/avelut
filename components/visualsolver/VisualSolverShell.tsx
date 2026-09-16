import { db, getDownloadURL, onValue, push, ref as dbRef, ref as storageRef, serverTimestamp, set, storage, update, uploadBytes } from "@/lib/backend";
import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { checkAICredits, deductAICredits, getFeatureCost, getFeatureModel } from "../../utils/usage";
import { LimitExceededModal } from "../LimitExceededModal";
import { createAvelutAI, getResponseText } from "../../utils/inference";
import { writeCachedJson } from "../../utils/cache";
import type { UserProfile } from "../../types";
import { useApiLimiter } from "../../hooks/useApiLimiter";
import { useAppSettings } from "../../hooks/useAppSettings";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { useToast } from "../../hooks/useToast";
import html2canvas from "html2canvas";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { FileOpener } from "@capawesome-team/capacitor-file-opener";
import { Share } from "@capacitor/share";
import { getMultipleUserProfiles } from "../../services/userProfileService";
import { formatLatexMath } from "../../utils/latexFormatter";

export const VisualSolver: React.FC<VisualSolverProps> = ({ userProfile, onStartChat, triggerScanRef }) => {
        const [cameraState, setCameraState] = useState<CameraState>('initializing');
        const [scannedImage, setScannedImage] = useState<string | null>(null);
        const [analysisResult, setAnalysisResult] = useState<string>('');
        const [error, setError] = useState<string>('');
        const [cropBox, setCropBox] = useState<CropBox>({ x: 0.05, y: 0.125, width: 0.9, height: 0.75 });
        const [customPrompt, setCustomPrompt] = useState<string>('');
        const [showLimitModal, setShowLimitModal] = useState(false);
        const [limitModalData, setLimitModalData] = useState({ balance: 0, cost: 0 });

        const { addToast } = useToast();

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
        const aiModel = getFeatureModel('visual_solve', appSettings) || 'qwen-vl-plus';
        const aiClient = useMemo(() => createAvelutAI(appSettings, userProfile), [appSettings, userProfile]);

        const cleanupCamera = useCallback(() => {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
                streamRef.current = null;
            }
            if (videoRef.current) {
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
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

        const handleDetailedTutorial = useCallback(async (imageOverride?: string) => {
            const targetImage = imageOverride || scannedImage;
            if (!targetImage) return;

            // Use live_tutorial cost — this launches a full 10-board voice tutorial pipeline
            // (Qwen VL/Text × 2 + Grok TTS × 10 boards), NOT a simple visual_solve scan
            const cost = getFeatureCost('live_tutorial', appSettings);
            const limitCheck = checkAICredits(userProfile, cost, appSettings);
            if (!limitCheck.allowed) {
                setLimitModalData({
                    balance: limitCheck.balance,
                    cost: limitCheck.cost
                });
                setShowLimitModal(true);
                return;
            }

            try {
                const { dataUrl: normalizedImage } = await readImageAsDataUrl(targetImage);

                const sessionData = {
                    course: {
                        course_id: 'visual_problem_solving',
                        course_name: 'Visual Problem Tutorial',
                        level: userProfile?.level || 'Academic',
                        topics: [{
                            topic_id: 'scanned_problem_breakdown',
                            topic_name: customPrompt ? `Problem: ${customPrompt.slice(0, 35)}` : 'Scanned Problem Breakdown',
                            topic_context: customPrompt || 'Scanned visual problem breakdown and step-by-step resolution',
                        }],
                    },
                    topic: {
                        topic_id: 'scanned_problem_breakdown',
                        topic_name: customPrompt ? `Problem: ${customPrompt.slice(0, 35)}` : 'Scanned Problem Breakdown',
                        topic_context: customPrompt || 'Scanned visual problem breakdown and step-by-step resolution',
                    },
                    image: normalizedImage,
                    customPrompt: customPrompt || '',
                    source: 'visual_solver'
                };

                writeCachedJson('avelut_active_voice_tutorial', sessionData);
                deductAICredits(userProfile.uid, cost, 'Visual Solver - Voice Tutorial', appSettings).catch(console.error);

                if (onStartChat) {
                    onStartChat(sessionData);
                }
            } catch (err: any) {
                console.error('Failed to prepare voice tutorial from scan:', err);
                addToast('Could not process scanned image for tutorial', 'error');
            }
        }, [scannedImage, customPrompt, userProfile, appSettings, onStartChat, addToast]);

        const handleQuickAnswer = useCallback(async (imageOverride?: string) => {
            const targetImage = imageOverride || scannedImage;
            if (!targetImage) return;

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
                    const rawImage = await readImageAsDataUrl(targetImage);
                    const { dataUrl: payloadDataUrl, mimeType } = await compressImageForSolver(rawImage.dataUrl, 1024, 0.82);
                    const base64Data = payloadDataUrl.split(',')[1];
                    if (!base64Data) throw new Error("Could not extract image data.");

                    const basePrompt = `First, examine and understand the content in the image (Math, Science, History, Biology, Language, Literature, Code, Diagram, or Multiple-Choice Quiz).
Provide the direct, accurate answer or solution immediately.
If it is a multiple-choice question, explicitly state the correct choice first (e.g., **Correct Answer: B - [Option Text]**), followed by a concise 1-2 sentence rationale.
For math/formulas, place equations on separate lines ($$ ... $$).
Never use horizontal tables. Present all information vertically line-by-line with clear bold headings.`;
                    const customInstruction = customPrompt ? ` ${customPrompt}` : '';
                    const promptText = `${basePrompt}${customInstruction}`;

                    if (!aiClient) throw new Error('AI client not available');
                    const aiResult = await aiClient.models.generateContent({
                        model: aiModel,
                        config: {
                            temperature: 0.3,
                            maxOutputTokens: 1024,
                        },
                        contents: [{ role: 'user', parts: [
                            { inlineData: { data: base64Data, mimeType } },
                            { text: promptText }
                        ]}],
                    });

                    const finalResult = getResponseText(aiResult);
                    if (!finalResult) throw new Error("AI returned an empty response.");

                    setAnalysisResult(finalResult);
                    deductAICredits(userProfile.uid, cost, 'Visual Solver - Quick Answer', appSettings).catch(console.error);
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
        }, [scannedImage, attemptApiCall, customPrompt, aiClient, aiModel, userProfile, appSettings, addToast]);

        const handleSolution = useCallback(async (imageOverride?: string) => {
            const targetImage = imageOverride || scannedImage;
            if (!targetImage) return;

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
                    const rawImage = await readImageAsDataUrl(targetImage);
                    const { dataUrl: payloadDataUrl, mimeType } = await compressImageForSolver(rawImage.dataUrl, 1024, 0.82);
                    const base64Data = payloadDataUrl.split(',')[1];
                    if (!base64Data) throw new Error("Could not extract image data.");

                    const basePrompt = `First, examine and thoroughly understand the image content (e.g. Science, History, Biology, Literature, Mathematics, Programming, Economics, or Diagrams).

Analyze the problem or question and provide a clear, step-by-step solution:
1. **Content Overview**: Identify what the question, passage, diagram, or problem is asking.
2. **Direct Answer / Solution**: State the final answer clearly (for multiple-choice: **Correct Answer: B - [Option Text]**).
3. **Step-by-Step Explanation**:
   - Explain the core concepts, historical context, scientific principles, or reasoning line-by-line vertically.
   - For mathematical equations, place EVERY formula on its own separate block line ($$ equation $$).
   - For diagrams or code snippets, break down key components clearly.
4. **Layout**: Never use horizontal tables. Use vertical lists with bold headers for mobile clarity.`;
                    const customInstruction = customPrompt ? ` ${customPrompt}` : '';
                    const promptText = `${basePrompt}${customInstruction}`;

                    if (!aiClient) throw new Error('AI client not available');
                    const aiResult = await aiClient.models.generateContent({
                        model: aiModel,
                        config: {
                            temperature: 0.3,
                            maxOutputTokens: 1536,
                        },
                        contents: [{ role: 'user', parts: [
                            { inlineData: { data: base64Data, mimeType } },
                            { text: promptText }
                        ]}],
                    });

                    const finalResult = getResponseText(aiResult);
                    if (!finalResult) throw new Error("AI returned an empty solution.");

                    setAnalysisResult(finalResult);
                    deductAICredits(userProfile.uid, cost, 'Visual Solver - Solution', appSettings).catch(console.error);
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
        }, [scannedImage, attemptApiCall, customPrompt, aiClient, aiModel, userProfile, appSettings, addToast]);

        // Handle clipboard paste of images
        useEffect(() => {
            const handlePaste = async (e: ClipboardEvent) => {
                const items = e.clipboardData?.items;
                if (!items) return;

                for (let i = 0; i < items.length; i++) {
                    if (items[i].type.startsWith('image/')) {
                        const file = items[i].getAsFile();
                        if (file) {
                            e.preventDefault();
                            try {
                                const { dataUrl } = await readImageAsDataUrl(file);
                                setScannedImage(dataUrl);
                                setAnalysisResult('');
                                setError('');
                                setCameraState('preview');
                                addToast('Image pasted! Select an option to solve.', 'info');
                            } catch (err) {
                                console.error('Failed to process pasted image:', err);
                                addToast('Could not read pasted image.', 'error');
                            }
                            break;
                        }
                    }
                }
            };

            window.addEventListener('paste', handlePaste);
            return () => {
                window.removeEventListener('paste', handlePaste);
            };
        }, [addToast]);

        // Handle shared image intent & auto scan trigger
        useEffect(() => {
            const checkSharedImageIntent = async () => {
                const sharedImage = localStorage.getItem('shared_image_intent');
                localStorage.removeItem('shared_image_intent');
                localStorage.removeItem('auto_scan_shared_image');

                if (sharedImage) {
                    try {
                        let imageUri = sharedImage;
                        if (sharedImage.startsWith('content://') || sharedImage.startsWith('file://')) {
                            const normalized = await readImageAsDataUrl(sharedImage);
                            imageUri = normalized.dataUrl;
                        }
                        setScannedImage(imageUri);
                        setAnalysisResult('');
                        setError('');
                        setCameraState('preview');
                    } catch (err) {
                        console.error("Failed to load shared image intent:", err);
                        addToast("Failed to load shared image.", "error");
                        initializeCamera();
                    }
                } else {
                    initializeCamera();
                }
            };

            void checkSharedImageIntent();

            const handleDirectTriggerScan = (e: any) => {
                const image = e.detail?.image;
                if (image) {
                    setScannedImage(image);
                    setAnalysisResult('');
                    setError('');
                    setCameraState('preview');
                }
            };

            window.addEventListener('visual_solver_trigger_scan', handleDirectTriggerScan);

            return () => {
                cleanupCamera();
                window.removeEventListener('visual_solver_trigger_scan', handleDirectTriggerScan);
            };
        }, [initializeCamera, cleanupCamera, addToast]);

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
            setTimeout(() => setCameraState('preview'), 100);
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

        const handleRetake = () => {
            setScannedImage(null);
            setAnalysisResult('');
            setError('');
            setCustomPrompt('');
            initializeCamera();
        };

        const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (!file) return;

            const isImageLike = (file.type && file.type.startsWith('image/')) || /\.(jpe?g|png|gif|bmp|webp|heic|heif)$/i.test(file.name);
            if (!isImageLike) {
                addToast('Please upload a valid image file.', 'error');
                return;
            }

            if (file.size > 10 * 1024 * 1024) {
                addToast('Image must be under 10MB.', 'error');
                return;
            }

            try {
                const { dataUrl } = await readImageAsDataUrl(file);
                setScannedImage(dataUrl);
                setAnalysisResult('');
                setError('');
                setCameraState('preview');
            } catch (error) {
                console.error('Could not process uploaded image:', error);
                addToast('Could not read the image. Please try another photo.', 'error');
            } finally {
                e.target.value = '';
            }
        };

        const renderContent = () => {
            switch (cameraState) {
                case 'initializing':
                    return (
                        <div className="flex flex-col items-center justify-center h-full bg-slate-900 text-white">
                            <img src="/logo_icon.png" alt="AVELUT" className="w-12 h-12 object-contain animate-pulse" />
                            <p className="mt-4 text-sm font-semibold text-slate-300">Starting camera...</p>
                        </div>
                    );

                case 'denied':
                    return (
                        <div className="flex flex-col items-center justify-center h-full text-center p-6 bg-slate-900 text-white">
                            <i className="bi bi-exclamation-triangle-fill text-amber-400 text-4xl mb-4"></i>
                            <h3 className="text-xl font-bold">Camera Access Denied</h3>
                            <p className="text-slate-300 mt-2 max-w-sm text-sm">{error}</p>
                            <button onClick={initializeCamera} className="mt-6 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2.5 px-6 rounded-full transition-colors cursor-pointer">Retry</button>
                        </div>
                    );

                case 'error':
                    return (
                        <div className="flex flex-col items-center justify-center h-full text-center p-6 bg-slate-900 text-white">
                            <i className="bi bi-x-circle-fill text-rose-500 text-4xl mb-4"></i>
                            <h3 className="text-xl font-bold">Camera Error</h3>
                            <p className="text-slate-300 mt-2 max-w-sm text-sm">{error}</p>
                            <button onClick={initializeCamera} className="mt-6 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2.5 px-6 rounded-full transition-colors cursor-pointer">Retry</button>
                        </div>
                    );

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
                        <div className="w-full h-full flex flex-col bg-slate-950">
                            {/* Camera View Area */}
                            <div className="flex-1 relative overflow-hidden flex items-center justify-center p-2 sm:p-4 bg-slate-950">
                                <video ref={videoRef} playsInline autoPlay muted className="w-full h-full object-contain rounded-2xl shadow-lg"></video>
                                <div
                                    style={{
                                        left: `calc(${cropBox.x * 100}% + 8px)`, top: `calc(${cropBox.y * 100}% + 8px)`,
                                        width: `calc(${cropBox.width * 100}% - 16px)`, height: `calc(${cropBox.height * 100}% - 16px)`
                                    }}
                                    className={`absolute border-4 border-dashed rounded-2xl cursor-move transition-colors duration-300
                                    ${cameraState === 'scanning' ? 'border-amber-400 animate-[scan-pulse_1s_ease-in-out_infinite]' : 'border-white/80'}`}
                                    onMouseDown={(e) => handleInteractionStart(e, 'drag')}
                                    touch-action="none"
                                    onTouchStart={(e) => handleInteractionStart(e, 'drag')}
                                >
                                    <div className="absolute inset-0" style={{ boxShadow: '0 0 0 2000px rgba(0,0,0,0.5)' }}></div>
                                    {resizeHandles.map(handle => (
                                        <div key={handle.type}
                                            className={`absolute ${handle.pos} ${handle.cursor} z-10`}
                                            onMouseDown={(e) => handleInteractionStart(e, handle.type)}
                                            onTouchStart={(e) => handleInteractionStart(e, handle.type)}
                                        >
                                            <div className="w-full h-full bg-amber-400 rounded-full border-2 border-white shadow-md"></div>
                                        </div>
                                    ))}
                                </div>
                                <div className="absolute top-6 left-1/2 -translate-x-1/2 text-white bg-slate-900/80 backdrop-blur-md border border-slate-700/80 px-4 py-1.5 text-xs sm:text-sm font-semibold rounded-full pointer-events-none w-fit text-center shadow-lg">
                                    Drag and resize to frame the problem
                                </div>
                            </div>

                            {/* Shutter Button Area - Hidden Input */}
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                onChange={handleFileUpload}
                                className="hidden"
                            />

                            {/* Floating Upload Button */}
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                aria-label="Upload photo"
                                className="absolute right-5 top-1/2 -translate-y-1/2 flex items-center justify-center w-14 h-14 bg-slate-800 hover:bg-slate-700 text-amber-400 rounded-full transition-all active:scale-90 shadow-2xl border border-slate-700 z-50 cursor-pointer"
                            >
                                <i className="bi bi-cloud-arrow-up-fill text-2xl"></i>
                            </button>
                        </div>
                    );

                case 'preview':
                case 'analyzing':
                    return (
                        <div className="relative w-full h-full flex flex-col items-center justify-center bg-slate-950">
                            {scannedImage && <img src={scannedImage} alt="Scanned problem" className="w-full h-full object-contain" />}
                            {cameraState === 'analyzing' && (
                                <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-md flex flex-col items-center justify-center text-white p-6">
                                    <div className="relative flex items-center justify-center">
                                        <div className="absolute h-20 w-20 rounded-full border-4 border-amber-500/20 border-t-amber-500 animate-spin" />
                                        <img src="/logo_icon.png" alt="AVELUT" className="w-10 h-10 object-contain animate-pulse" />
                                    </div>
                                    <p className="mt-6 text-lg font-bold text-white tracking-wide">Solving Problem...</p>
                                    <p className="text-slate-400 text-sm mt-1">Generating step-by-step mathematical breakdown</p>
                                </div>
                            )}
                            {cameraState === 'preview' && (
                                <>
                                    <div className="absolute top-4 left-4 z-20">
                                        <button onClick={handleRetake} className="flex items-center gap-2 p-2.5 px-4 bg-slate-900/80 text-white rounded-2xl hover:bg-slate-800 transition-colors shadow-lg backdrop-blur-md border border-slate-700 text-sm font-bold cursor-pointer">
                                            <i className="bi bi-arrow-left text-sm"></i>
                                            <span>Back</span>
                                        </button>
                                    </div>
                                    <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm flex flex-col items-center justify-center p-4 sm:p-6 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                        <div className="w-full max-w-md space-y-3 sm:space-y-4">
                                            <div className="mb-2">
                                                <textarea
                                                    value={customPrompt}
                                                    onChange={(e) => setCustomPrompt(e.target.value)}
                                                    placeholder="Optional: Custom instructions (e.g. 'Explain step by step', 'Focus on calculus derivation', etc.)"
                                                    className="w-full bg-slate-900/90 backdrop-blur-md border border-slate-700 text-white placeholder-slate-400 rounded-2xl p-3.5 text-xs sm:text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400 transition-all shadow-inner"
                                                    rows={2}
                                                />
                                            </div>
                                            <button
                                                onClick={() => handleDetailedTutorial()}
                                                className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold py-4 px-6 rounded-2xl transition-all text-base sm:text-lg flex items-center justify-center gap-2.5 shadow-xl active:scale-95 cursor-pointer"
                                            >
                                                <i className="bi bi-lightning-charge-fill text-lg"></i>
                                                <span>Detailed Tutorial & Steps</span>
                                            </button>
                                            <button
                                                onClick={() => handleSolution()}
                                                className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-bold py-3.5 px-6 rounded-2xl transition-all text-sm sm:text-base flex items-center justify-center gap-2 active:scale-95 cursor-pointer"
                                            >
                                                <i className="bi bi-check2-circle text-lg text-amber-400"></i>
                                                <span>Direct Solution</span>
                                            </button>
                                            <button
                                                onClick={() => handleQuickAnswer()}
                                                className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-bold py-3.5 px-6 rounded-2xl transition-all text-sm sm:text-base flex items-center justify-center gap-2 active:scale-95 cursor-pointer"
                                            >
                                                <i className="bi bi-clock-history text-lg text-slate-400"></i>
                                                <span>Quick Final Answer</span>
                                            </button>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    );

                case 'showingTutorial':
                    if (!scannedImage) return null;
                    return (
                        <TutorialDisplay
                            scannedImage={scannedImage}
                            tutorialText={analysisResult}
                            onClose={handleRetake}
                            userProfile={userProfile}
                            onStartChat={onStartChat}
                        />
                    );

                default:
                    return null;
            }
        };

        return (
            <div className="flex-1 flex flex-col w-full pb-16 md:pb-0">
                <div className="h-[calc(100vh-160px)] md:h-[calc(100vh-90px)] bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden relative shadow-2xl">
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
