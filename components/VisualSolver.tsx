import { db, getDownloadURL, onValue, push, ref as dbRef, ref as storageRef, serverTimestamp, set, storage, update, uploadBytes } from '@/lib/backend';
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { checkAICredits, deductAICredits, getFeatureCost, getFeatureModel } from '../utils/usage';
import { LimitExceededModal } from './LimitExceededModal';
import { createAvelutAI, getResponseText } from '../utils/inference';
import { writeCachedJson } from '../utils/cache';
import type { UserProfile } from '../types';
import { useApiLimiter } from '../hooks/useApiLimiter';
import { useAppSettings } from '../hooks/useAppSettings';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { useToast } from '../hooks/useToast';
import html2canvas from 'html2canvas';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileOpener } from '@capawesome-team/capacitor-file-opener';
import { Share } from '@capacitor/share';
import { getMultipleUserProfiles } from '../services/userProfileService';

// --- INLINE ICONS ---
const ErrorIcon: React.FC<{ className?: string }> = ({ className = 'w-8 h-8' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);

const ArrowLeftIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
    </svg>
);

const MAX_CAPTURE_SLICE_HEIGHT = 1600;
const CAPTURE_SLICE_OVERLAP = 40;

const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> => {
    return new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), 'image/png', 0.95);
    });
};

const inferImageMimeType = (fileName: string = '', fallbackType: string = ''): string => {
    const normalizedName = fileName.toLowerCase();
    if (fallbackType && fallbackType.startsWith('image/')) return fallbackType;
    if (normalizedName.endsWith('.png')) return 'image/png';
    if (normalizedName.endsWith('.jpg') || normalizedName.endsWith('.jpeg')) return 'image/jpeg';
    if (normalizedName.endsWith('.webp')) return 'image/webp';
    if (normalizedName.endsWith('.gif')) return 'image/gif';
    if (normalizedName.endsWith('.bmp')) return 'image/bmp';
    if (normalizedName.endsWith('.heic') || normalizedName.endsWith('.heif')) return 'image/heic';
    return 'image/jpeg';
};

const readImageAsDataUrl = async (input: File | Blob | string): Promise<{ dataUrl: string; mimeType: string }> => {
    if (typeof input === 'string') {
        if (input.startsWith('data:')) {
            const mimeType = input.split(';')[0].split(':')[1] || 'image/jpeg';
            return { dataUrl: input, mimeType };
        }

        if (input.startsWith('blob:')) {
            const response = await fetch(input);
            const blob = await response.blob();
            return readImageAsDataUrl(blob);
        }

        if (input.startsWith('content://') || input.startsWith('file://')) {
            try {
                const rawPath = input.replace(/^file:\/\//, '').replace(/^content:\/\//, '');
                const fileData = await Filesystem.readFile({ path: rawPath });
                return {
                    dataUrl: `data:image/jpeg;base64,${fileData.data}`,
                    mimeType: 'image/jpeg'
                };
            } catch (error) {
                console.warn('Unable to read shared image path:', error);
                throw error;
            }
        }
    }

    const source = input instanceof Blob ? input : new Blob([input as any], { type: (input as any).type || 'image/jpeg' });
    const mimeType = inferImageMimeType((input instanceof File ? input.name : ''), (source as Blob).type);

    try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error("Could not read image file."));
            reader.readAsDataURL(source);
        });
        if (dataUrl.startsWith('data:image/')) {
            const detectedMime = dataUrl.split(';')[0].split(':')[1] || mimeType;
            if (!detectedMime.includes('heic') && !detectedMime.includes('heif')) {
                return { dataUrl, mimeType: detectedMime };
            }
        }
    } catch (error) {
        console.warn('Falling back to canvas conversion for image input:', error);
    }

    const objectUrl = URL.createObjectURL(source);
    try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Image could not be decoded.'));
            img.src = objectUrl;
        });

        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not prepare canvas for image conversion.');
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

        const outputMime = mimeType.includes('png') ? 'image/png' : mimeType.includes('webp') ? 'image/webp' : 'image/jpeg';
        return {
            dataUrl: canvas.toDataURL(outputMime, 0.92),
            mimeType: outputMime
        };
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
};

const compressImageForSolver = (dataUrl: string, maxDim: number = 1024, quality: number = 0.82): Promise<{ dataUrl: string; mimeType: string }> => {
    return new Promise((resolve) => {
        if (!dataUrl) return resolve({ dataUrl: '', mimeType: 'image/jpeg' });
        const img = new Image();
        img.onload = () => {
            let width = img.width;
            let height = img.height;
            if (width > maxDim || height > maxDim) {
                if (width > height) {
                    height = Math.round((height * maxDim) / width);
                    width = maxDim;
                } else {
                    width = Math.round((width * maxDim) / height);
                    height = maxDim;
                }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(img, 0, 0, width, height);
                const compressedUrl = canvas.toDataURL('image/jpeg', quality);
                resolve({ dataUrl: compressedUrl, mimeType: 'image/jpeg' });
                return;
            }
            resolve({ dataUrl, mimeType: 'image/jpeg' });
        };
        img.onerror = () => resolve({ dataUrl, mimeType: 'image/jpeg' });
        img.src = dataUrl;
    });
};

const sliceCanvasIntoBlobs = async (canvas: HTMLCanvasElement): Promise<Blob[]> => {
    if (canvas.height <= MAX_CAPTURE_SLICE_HEIGHT) {
        const blob = await canvasToBlob(canvas);
        return blob ? [blob] : [];
    }

    const blobs: Blob[] = [];
    const sliceWidth = canvas.width;
    const sliceHeight = MAX_CAPTURE_SLICE_HEIGHT;
    const step = Math.max(1, sliceHeight - CAPTURE_SLICE_OVERLAP);

    for (let sourceY = 0; sourceY < canvas.height; sourceY += step) {
        const currentSliceHeight = Math.min(sliceHeight, canvas.height - sourceY);
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = sliceWidth;
        sliceCanvas.height = currentSliceHeight;

        const sliceCtx = sliceCanvas.getContext('2d');
        if (!sliceCtx) continue;

        sliceCtx.drawImage(
            canvas,
            0,
            sourceY,
            sliceWidth,
            currentSliceHeight,
            0,
            0,
            sliceWidth,
            currentSliceHeight
        );

        const blob = await canvasToBlob(sliceCanvas);
        if (blob) blobs.push(blob);
    }

    return blobs;
};

import { formatLatexMath } from '../utils/latexFormatter';

/**
 * Pre-processes markdown text to ensure vertical flow on mobile screens,
 * converts squished horizontal tables into clean vertical block cards,
 * and ensures distinct equation lines with block LaTeX ($$...$$).
 */
const formatMathMarkdown = (text: string): string => {
    if (!text) return '';
    let formatted = text;

    // Convert horizontal markdown tables into vertical mobile-friendly block cards
    const tableRegex = /(?:^|\n)(\|[^\n]+\|\r?\n\|[-:\s|]+\|\r?\n(?:\|[^\n]+\|\r?\n?)+)/g;
    formatted = formatted.replace(tableRegex, (match) => {
        const lines = match.trim().split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length < 3) return match;
        
        const parseRow = (row: string) => row.split('|').map(c => c.trim()).filter((_c, i, arr) => i > 0 && i < arr.length);
        const headers = parseRow(lines[0]);
        const dataRows = lines.slice(2).map(parseRow);

        let output = '\n\n';
        dataRows.forEach((row) => {
            const title = row[0] || 'Key Point';
            output += `\n> **${title}**\n`;
            for (let i = 1; i < row.length; i++) {
                if (row[i]) {
                    const headerLabel = headers[i] ? `*${headers[i]}:* ` : '';
                    output += `> - ${headerLabel}${row[i]}\n`;
                }
            }
            output += '\n';
        });
        return output + '\n\n';
    });

    // Normalize block equations $$...$$ so they are always preceded and followed by empty lines
    formatted = formatted.replace(/([^\n])\s*\$\$([\s\S]*?)\$\$\s*([^\n])/g, '$1\n\n$$$$2$$\n\n$3');
    formatted = formatted.replace(/([^\n])\s*\$\$([\s\S]*?)\$\$/g, '$1\n\n$$$$2$$');
    formatted = formatted.replace(/\$\$([\s\S]*?)\$\$\s*([^\n])/g, '$$$$1$$\n\n$2');

    // Clean up Step headers like "Step 1:", "**Step 1:**", "### Step 1" so they have clear spacing
    formatted = formatted.replace(/(?:^|\n)(?:#{1,4}\s*)?(?:\*\*)?(Step\s+\d+[:.]?)(?:\*\*)?/gi, '\n\n### 🔹 $1\n');

    // Ensure double newlines around horizontal rules
    formatted = formatted.replace(/\n\s*---\s*\n/g, '\n\n---\n\n');

    return formatLatexMath(formatted);
};

// --- TUTORIAL DISPLAY COMPONENT ---
interface TutorialDisplayProps {
    scannedImage: string;
    tutorialText: string;
    onClose: () => void;
    userProfile: UserProfile;
    onStartChat?: (payload: any, tutorialText?: string) => void;
}

const TutorialDisplay: React.FC<TutorialDisplayProps> = ({ scannedImage, tutorialText, onClose, userProfile, onStartChat }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const scrollContentRef = useRef<HTMLDivElement>(null);
    const sheetRef = useRef<HTMLDivElement>(null);
    const dragStartRef = useRef<{ y: number; initialOffset: number; allowClose: boolean } | null>(null);
    const [isSharing, setIsSharing] = useState(false);
    const { addToast } = useToast();
    const [showForwardModal, setShowForwardModal] = useState(false);
    const [showActionModal, setShowActionModal] = useState(false);
    const [studyPartners, setStudyPartners] = useState<Record<string, boolean>>({});
    const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [isSending, setIsSending] = useState(false);
    const [dragOffsetY, setDragOffsetY] = useState(0);
    const [isClosing, setIsClosing] = useState(false);

    const closeSheet = useCallback(() => {
        setIsClosing(true);
        window.setTimeout(() => {
            setIsClosing(false);
            setShowActionModal(false);
            setDragOffsetY(0);
            onClose();
        }, 180);
    }, [onClose]);

    const handleDetailedTutorial = useCallback(() => {
        if (!onStartChat) return;
        const sessionData = {
            course: {
                course_id: 'visual_problem_solving',
                course_name: 'Visual Problem Tutorial',
                level: userProfile?.level || 'Academic',
                topics: [{
                    topic_id: 'scanned_problem_breakdown',
                    topic_name: 'Scanned Problem Breakdown',
                    topic_context: tutorialText ? tutorialText.slice(0, 300) : 'Step-by-step interactive lesson based on scanned image',
                }],
            },
            topic: {
                topic_id: 'scanned_problem_breakdown',
                topic_name: 'Scanned Problem Breakdown',
                topic_context: tutorialText ? tutorialText.slice(0, 300) : 'Step-by-step interactive lesson based on scanned image',
            },
            image: scannedImage,
            customPrompt: tutorialText || '',
            source: 'visual_solver'
        };
        writeCachedJson('avelut_active_voice_tutorial', sessionData);
        onStartChat(sessionData);
    }, [onStartChat, userProfile, tutorialText, scannedImage]);

    const handleDragStart = (clientY: number) => {
        const sheetTop = sheetRef.current?.getBoundingClientRect().top ?? window.innerHeight;
        const allowClose = clientY <= sheetTop + 60;
        dragStartRef.current = { y: clientY, initialOffset: dragOffsetY, allowClose };
    };

    const handleDragMove = (clientY: number) => {
        if (!dragStartRef.current || !dragStartRef.current.allowClose) return;
        const delta = clientY - dragStartRef.current.y;
        if (delta <= 0) {
            setDragOffsetY(0);
            return;
        }
        setDragOffsetY(Math.min(220, Math.max(0, dragStartRef.current.initialOffset + delta)));
    };

    const handleDragEnd = () => {
        if (dragOffsetY > 140) {
            closeSheet();
        } else {
            setDragOffsetY(0);
        }
        dragStartRef.current = null;
    };

    useEffect(() => {
        if (!userProfile) return;
        const partnersRef = dbRef(db, `study_partners/${userProfile.uid}`);

        const unsubPartners = onValue(partnersRef, async (snap) => {
            const data = snap.val() || {};
            setStudyPartners(data);
            const partnerUids = Object.keys(data).filter(key => data[key] === true);
            if (partnerUids.length > 0) {
                const partnerProfiles = await getMultipleUserProfiles(partnerUids);
                setAllUsers(partnerProfiles);
            } else {
                setAllUsers([]);
            }
        });

        return () => {
            unsubPartners();
        };
    }, [userProfile]);

    const captureImages = async (): Promise<Blob[]> => {
        if (!containerRef.current) return [];
        setIsSharing(true);

        const originalHeight = containerRef.current.style.height;
        const originalOverflow = containerRef.current.style.overflow;
        const scrollContent = scrollContentRef.current;
        const originalScrollHeight = scrollContent?.style.height;
        const originalScrollOverflow = scrollContent?.style.overflow;
        const originalScrollMaxHeight = scrollContent?.style.maxHeight;
        containerRef.current.style.height = 'auto';
        containerRef.current.style.overflow = 'visible';
        if (scrollContent) {
            scrollContent.style.height = 'auto';
            scrollContent.style.overflow = 'visible';
            scrollContent.style.maxHeight = 'none';
        }

        try {
            const canvas = await html2canvas(containerRef.current, {
                useCORS: true,
                scale: 1.5,
                backgroundColor: '#ffffff',
                windowWidth: containerRef.current.scrollWidth,
                windowHeight: containerRef.current.scrollHeight
            });
            return await sliceCanvasIntoBlobs(canvas);
        } catch (err) {
            console.error('Failed to capture image', err);
            return [];
        } finally {
            containerRef.current.style.height = originalHeight;
            containerRef.current.style.overflow = originalOverflow;
            if (scrollContent) {
                scrollContent.style.height = originalScrollHeight || '';
                scrollContent.style.overflow = originalScrollOverflow || '';
                scrollContent.style.maxHeight = originalScrollMaxHeight || '';
            }
            setIsSharing(false);
        }
    };

    const handleShareNative = async () => {
        setIsSharing(true);
        try {
            const blobs = await captureImages();
            if (!blobs.length) {
                addToast('Failed to generate image for sharing.', 'error');
                return;
            }

            if (Capacitor.isNativePlatform()) {
                try {
                    const savedFiles = await Promise.all(blobs.map(async (blob, index) => {
                        const base64Data = await new Promise<string>((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onloadend = () => {
                                const b64 = (reader.result as string).split(',')[1];
                                resolve(b64);
                            };
                            reader.onerror = reject;
                            reader.readAsDataURL(blob);
                        });

                        const fileName = `avelut_solution_${Date.now()}_${index + 1}.png`;
                        const savedFile = await Filesystem.writeFile({
                            path: fileName,
                            data: base64Data,
                            directory: Directory.Cache
                        });
                        return { uri: savedFile.uri };
                    }));

                    try {
                        await Share.share({
                            title: 'Avelut Solution',
                            text: 'Check out this step-by-step solution from Avelut Visual Solver!',
                            files: savedFiles.map(file => file.uri),
                            dialogTitle: 'Share Solution'
                        });
                    } catch (shareErr: any) {
                        if (shareErr.message !== 'Share canceled') {
                            console.error('Share plugin error, falling back to FileOpener:', shareErr);
                            await FileOpener.openFile({
                                path: savedFiles[0].uri,
                                mimeType: 'image/png'
                            });
                            addToast(blobs.length > 1 ? 'Images saved! Use the menu to share.' : 'Image saved! Use the menu to share.', 'success');
                        }
                    }
                } catch (err) {
                    console.error('Native share error:', err);
                    addToast('Failed to share image.', 'error');
                }
            } else {
                const files = blobs.map((blob, index) => new File([blob], `avelut_solution_${index + 1}.png`, { type: 'image/png' }));
                if (navigator.share && navigator.canShare && navigator.canShare({ files })) {
                    try {
                        await navigator.share({
                            title: 'Avelut Solution',
                            text: 'Check out this step-by-step solution from Avelut Visual Solver!',
                            files
                        });
                    } catch (err) {
                        console.error('Error sharing', err);
                    }
                } else {
                    blobs.forEach((blob, index) => {
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `avelut_solution_${index + 1}.png`;
                        a.click();
                        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
                    });
                    addToast(blobs.length > 1 ? 'Images downloaded! You can share them manually.' : 'Image downloaded! You can share it manually.', 'success');
                }
            }
        } finally {
            setIsSharing(false);
        }
    };

    const handleForwardToPartner = async () => {
        if (selectedIds.length === 0) return;
        const targetRecipientIds = [...selectedIds];
        setShowForwardModal(false);
        setSelectedIds([]);
        setIsSending(true);
        addToast('Forwarding solution to study partners...', 'info');

        try {
            const blobs = await captureImages();
            if (!blobs.length) {
                addToast('Failed to generate image for forwarding.', 'error');
                setIsSending(false);
                return;
            }

            // WhatsApp-style: upload each slice once in parallel, then broadcast to all recipient threads
            const uploadedUrls = await Promise.all(blobs.map(async (blob, sliceIndex) => {
                const cloudPath = `solution_shares/${userProfile.uid}/${Date.now()}_slice_${sliceIndex + 1}.png`;
                const fileBucketRef = storageRef(storage, cloudPath);
                const snapshot = await uploadBytes(fileBucketRef, blob);
                return await getDownloadURL(snapshot.ref);
            }));

            // Sync concurrently to all recipient chats
            await Promise.all(targetRecipientIds.map(async (recipientId) => {
                const chatId = [userProfile.uid, recipientId].sort().join('_');
                const participantIds = [userProfile.uid, recipientId];
                const updates: any = {};

                for (let sliceIndex = 0; sliceIndex < uploadedUrls.length; sliceIndex++) {
                    const fileDownloadUrl = uploadedUrls[sliceIndex];
                    const localTimestamp = Date.now() + sliceIndex;
                    const text = `![Avelut Solution ${sliceIndex + 1}](${fileDownloadUrl})`;
                    const msgRef = push(dbRef(db, `messages/${chatId}`));
                    const data = {
                        senderId: userProfile.uid,
                        text,
                        type: 'image',
                        timestamp: localTimestamp,
                        is_forwarded: true,
                        partIndex: sliceIndex + 1,
                        totalParts: uploadedUrls.length,
                    };
                    await set(msgRef, data);

                    participantIds.forEach((participantId) => {
                        updates[`user_chats/${participantId}/${chatId}/last_message`] = {
                            text: uploadedUrls.length > 1 ? `📷 Solution Image (${sliceIndex + 1}/${uploadedUrls.length})` : '📷 Solution Image',
                            senderId: userProfile.uid,
                            timestamp: localTimestamp,
                            type: 'image',
                        };
                        updates[`user_chats/${participantId}/${chatId}/timestamp`] = localTimestamp;
                        updates[`user_chats/${participantId}/${chatId}/otherUserId`] = participantId === userProfile.uid
                            ? recipientId
                            : userProfile.uid;
                    });
                    updates[`user_chats/${userProfile.uid}/${chatId}/unreadCount`] = 0;
                    updates[`user_chats/${recipientId}/${chatId}/unreadCount`] = 1;
                }

                await update(dbRef(db), updates);
            }));

            addToast('Forwarded successfully to study partners!', 'success');
        } catch (err: any) {
            console.error('Failed to forward', err);
            addToast('Failed to forward solution.', 'error');
        } finally {
            setIsSending(false);
        }
    };


    return (
        <div className="absolute inset-0 z-40 flex items-end justify-center bg-slate-950/60 backdrop-blur-md p-0 sm:p-3 animate-fade-in">
            {/* Bottom Drawer Container */}
            <div
                ref={sheetRef}
                className={`relative flex flex-col w-full max-w-5xl h-[88vh] rounded-t-[36px] sm:rounded-[36px] border border-slate-200/80 dark:border-white/10 bg-white/95 dark:bg-[#0A0A0A]/95 shadow-[0_-20px_60px_rgba(0,0,0,0.5)] backdrop-blur-2xl transition-transform duration-300 overflow-hidden ${isClosing ? 'translate-y-full' : 'translate-y-0'}`}
                style={{ transform: `translateY(${dragOffsetY}px)` }}
            >
                {/* Drag Handle */}
                <div 
                    className="flex items-center justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing select-none"
                    onTouchStart={(e) => handleDragStart(e.touches[0].clientY)}
                    onTouchMove={(e) => handleDragMove(e.touches[0].clientY)}
                    onTouchEnd={handleDragEnd}
                    onMouseDown={(e) => handleDragStart(e.clientY)}
                    onMouseMove={(e) => handleDragMove(e.clientY)}
                    onMouseUp={handleDragEnd}
                    onMouseLeave={handleDragEnd}
                >
                    <div className="h-1.5 w-14 rounded-full bg-slate-300 dark:bg-slate-700" />
                </div>

                {/* Header Bar */}
                <div className="flex items-center justify-between px-5 sm:px-8 pb-3 border-b border-slate-100 dark:border-white/10">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="flex h-2 w-2 rounded-full bg-[#0066FF]" />
                            <p className="text-[11px] font-black uppercase tracking-[0.25em] text-[#0066FF] dark:text-blue-400">Step-By-Step Solution</p>
                        </div>
                        <h3 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white tracking-tight mt-0.5">Problem Breakdown</h3>
                    </div>

                    <button
                        type="button"
                        onClick={closeSheet}
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                        aria-label="Close solution"
                    >
                        ✕
                    </button>
                </div>

                {/* Scrollable Content Container */}
                <div ref={containerRef} className="flex-1 overflow-y-auto px-4 sm:px-8 py-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {/* Scanned Image Card */}
                    <div className="mb-6 overflow-hidden rounded-[24px] border border-slate-200/80 dark:border-slate-800 bg-gradient-to-br from-indigo-50/50 via-sky-50/30 to-white dark:from-slate-800/50 dark:to-slate-900/50 shadow-inner">
                        <img src={scannedImage} alt="Scanned problem" className="h-44 sm:h-52 w-full object-contain p-3" />
                    </div>

                    {/* Formatted Markdown Content */}
                    <div ref={scrollContentRef} className="max-w-4xl mx-auto pb-24 text-slate-800 dark:text-slate-100">
                        <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkMath]}
                            rehypePlugins={[rehypeKatex]}
                            components={{
                                h1: ({node, ...props}: any) => (
                                    <div className="mt-8 mb-4 border-b border-slate-200 dark:border-slate-800 pb-3">
                                        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-snug" {...props} />
                                    </div>
                                ),
                                h2: ({node, ...props}: any) => (
                                    <div className="mt-8 mb-4 flex items-center gap-2.5">
                                        <span className="h-2.5 w-2.5 rounded-full bg-[#0066FF]" />
                                        <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight" {...props} />
                                    </div>
                                ),
                                h3: ({node, children, ...props}: any) => {
                                    const isStep = String(children).includes('Step') || String(children).includes('🔹');
                                    return (
                                        <div className={`mt-6 mb-3 ${isStep ? 'p-3.5 bg-blue-50/70 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/50 rounded-2xl shadow-sm' : ''}`}>
                                            <h3 className="text-lg sm:text-xl font-bold text-[#002D62] dark:text-blue-200 tracking-tight flex items-center gap-2" {...props}>
                                                {children}
                                            </h3>
                                        </div>
                                    );
                                },
                                h4: ({node, ...props}: any) => <h4 className="text-base sm:text-lg font-semibold text-slate-800 dark:text-slate-200 mt-4 mb-2" {...props} />,
                                p: ({node, ...props}: any) => <p className="mb-4 text-[15px] sm:text-base text-slate-700 dark:text-slate-200 leading-relaxed tracking-normal font-normal" {...props} />,
                                a: ({node, ...props}: any) => <a className="text-sky-600 dark:text-sky-400 font-semibold hover:underline decoration-sky-300 decoration-2 transition-all" target="_blank" rel="noreferrer" {...props} />,
                                strong: ({node, ...props}: any) => <strong className="font-bold text-slate-900 dark:text-white" {...props} />,
                                em: ({node, ...props}: any) => <em className="italic text-indigo-600 dark:text-indigo-400 font-medium" {...props} />,
                                ul: ({node, ...props}: any) => <ul className="space-y-3 my-4 pl-1" {...props} />,
                                li: ({node, ...props}: any) => (
                                    <li className="flex items-start gap-2 text-[15px] sm:text-base text-slate-700 dark:text-slate-200 leading-relaxed before:content-['•'] before:text-sky-500 before:font-bold before:text-xl before:leading-none before:mt-0.5 before:flex-shrink-0" {...props} />
                                ),
                                ol: ({node, ...props}: any) => <ol className="space-y-4 my-5" {...props} />,
                                code: ({node, inline, className, children, ...props}: any) => {
                                    if (inline) {
                                        return <code className="bg-slate-100 dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded font-mono text-sm border border-slate-200 dark:border-slate-700 font-medium" {...props}>{children}</code>;
                                    }
                                    return (
                                        <div className="my-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-900 p-4 shadow-lg overflow-x-auto">
                                            <code className="block font-mono text-sm text-slate-100 leading-relaxed" {...props}>{children}</code>
                                        </div>
                                    );
                                },
                                blockquote: ({node, ...props}: any) => (
                                    <div className="my-4 rounded-2xl border-l-4 border-sky-500 bg-sky-50/60 dark:bg-sky-950/30 p-4 sm:p-5 shadow-sm border border-sky-100 dark:border-sky-900/40">
                                        <blockquote className="text-[15px] sm:text-base font-medium text-slate-800 dark:text-slate-200 leading-relaxed space-y-1.5" {...props} />
                                    </div>
                                ),
                                table: ({node, ...props}: any) => (
                                    <div className="overflow-x-auto my-5 shadow-sm rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                                        <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700 text-left" {...props} />
                                    </div>
                                ),
                                thead: ({node, ...props}: any) => <thead className="bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white font-bold" {...props} />,
                                tbody: ({node, ...props}: any) => <tbody className="bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-800" {...props} />,
                                tr: ({node, ...props}: any) => <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors" {...props} />,
                                th: ({node, ...props}: any) => <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300" {...props} />,
                                td: ({node, ...props}: any) => <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-200 align-top leading-relaxed whitespace-normal break-words" {...props} />,
                                hr: ({node, ...props}: any) => <hr className="my-8 border-t border-slate-200 dark:border-slate-800" {...props} />,
                            }}
                        >
                            {formatMathMarkdown(tutorialText)}
                        </ReactMarkdown>
                    </div>
                </div>

                {/* Circular Floating Action Button (FAB) */}
                <button
                    type="button"
                    onClick={() => setShowActionModal(true)}
                    className="absolute right-5 bottom-20 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 border border-slate-700 text-amber-400 shadow-xl ring-4 ring-slate-800/40 transition-all duration-300 hover:scale-110 active:scale-95 cursor-pointer"
                    aria-label="Actions menu"
                >
                    <i className="bi bi-three-dots-vertical text-xl"></i>
                </button>

                {/* Bottom Footer Bar */}
                <div className="sticky bottom-0 inset-x-0 z-20 flex items-center justify-between gap-3 border-t border-slate-200/80 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 px-4 sm:px-8 py-3.5 backdrop-blur-lg">
                    <button 
                        type="button" 
                        onClick={closeSheet} 
                        className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-slate-100 dark:bg-slate-800 px-5 py-3.5 font-bold text-sm text-slate-700 dark:text-slate-200 transition-all hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-[0.98] cursor-pointer"
                    >
                        <i className="bi bi-arrow-counterclockwise text-base"></i>
                        <span>Retake & Scan Another</span>
                    </button>
                </div>
            </div>

            {/* Floating Action Mini Menu Modal */}
            {showActionModal && (
                <div 
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-md animate-fade-in"
                    onClick={() => setShowActionModal(false)}
                >
                    <div 
                        className="w-full max-w-sm rounded-[28px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xl transition-all animate-scale-in"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                            <div className="flex items-center gap-2.5">
                                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-800 text-amber-400 border border-slate-700">
                                    <i className="bi bi-gear-wide-connected text-base"></i>
                                </div>
                                <div>
                                    <h3 className="text-base font-bold text-slate-900 dark:text-white">Solution Options</h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">Share or forward this answer</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowActionModal(false)}
                                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                            >
                                <i className="bi bi-x-lg text-xs"></i>
                            </button>
                        </div>

                        <div className="mt-4 flex flex-col gap-2.5">
                            {/* Start Interactive Voice Tutorial */}
                            {onStartChat && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowActionModal(false);
                                        void handleDetailedTutorial();
                                    }}
                                    className="flex items-center gap-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-3.5 text-left transition-all hover:bg-amber-500 hover:text-slate-950 dark:hover:bg-amber-500 dark:hover:text-slate-950 active:scale-[0.98] group cursor-pointer"
                                >
                                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-amber-400 border border-slate-700 group-hover:bg-slate-950 group-hover:text-amber-400">
                                        <i className="bi bi-mic-fill text-lg"></i>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h4 className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-slate-950">Start Voice Tutorial</h4>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 group-hover:text-slate-900">Step-by-step spoken lesson with blackboard math</p>
                                    </div>
                                </button>
                            )}

                            {/* Forward */}
                            <button
                                type="button"
                                onClick={() => {
                                    setShowActionModal(false);
                                    setShowForwardModal(true);
                                }}
                                disabled={isSending}
                                className="flex items-center gap-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-3.5 text-left transition-all hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-[0.98] cursor-pointer"
                            >
                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-slate-200 border border-slate-700">
                                    <i className="bi bi-send-fill text-base"></i>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">Forward to Partner</h4>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">Send directly to your study partners</p>
                                </div>
                            </button>

                            {/* Share */}
                            <button
                                type="button"
                                onClick={() => {
                                    setShowActionModal(false);
                                    void handleShareNative();
                                }}
                                disabled={isSharing}
                                className="flex items-center gap-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-3.5 text-left transition-all hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-[0.98] cursor-pointer"
                            >
                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-slate-200 border border-slate-700">
                                    <i className="bi bi-share-fill text-base"></i>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">Share Solution</h4>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">{isSharing ? 'Preparing images…' : 'Native share or download PNG'}</p>
                                </div>
                            </button>

                            {/* Report */}
                            <button
                                type="button"
                                onClick={async () => {
                                    setShowActionModal(false);
                                    try {
                                        const reportsRef = dbRef(db, 'reported_content');
                                        await push(reportsRef, {
                                            userId: userProfile.uid,
                                            messageText: tutorialText,
                                            timestamp: serverTimestamp(),
                                            type: 'visual_solver_response'
                                        });
                                        addToast('Content reported to moderators for review', 'success');
                                    } catch (err) {
                                        console.error('Failed to report:', err);
                                        addToast('Failed to report content', 'error');
                                    }
                                }}
                                className="flex items-center gap-3.5 rounded-2xl border border-rose-100 dark:border-rose-950/60 bg-rose-50/50 dark:bg-rose-950/30 p-3.5 text-left transition-all hover:bg-rose-100/60 dark:hover:bg-rose-900/40 active:scale-[0.98] cursor-pointer"
                            >
                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-600 text-white shadow-2xs">
                                    <i className="bi bi-flag-fill text-base"></i>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h4 className="text-sm font-bold text-rose-950 dark:text-rose-200">Report Inaccuracy</h4>
                                    <p className="text-xs text-rose-700 dark:text-rose-400">Flag an incorrect or faulty response</p>
                                </div>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Forward Modal */}
            {showForwardModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
                    <div className="flex max-h-[75vh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white dark:bg-[#0A0A0A] shadow-2xl border border-slate-200 dark:border-white/10">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/10 p-5">
                            <h2 className="text-base font-bold text-slate-900 dark:text-white">Forward Solution</h2>
                            <button onClick={() => setShowForwardModal(false)} disabled={isSending} className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 dark:bg-white/10 text-xs font-bold text-slate-500 dark:text-slate-400 transition hover:bg-slate-200 dark:hover:bg-white/20 cursor-pointer">
                                <i className="bi bi-x-lg text-xs"></i>
                            </button>
                        </div>
                        <div className="border-b border-slate-100 dark:border-white/10 p-4">
                            <input type="text" placeholder="Search partners..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 px-4 py-2 text-sm text-slate-900 dark:text-white focus:border-[#0066FF] focus:ring-1 focus:ring-[#0066FF] focus:outline-none" />
                        </div>
                        <div className="flex-1 space-y-2 overflow-y-auto p-4">
                            {filteredPartners.length === 0 ? (
                                <p className="py-8 text-center text-xs font-medium text-slate-500 dark:text-slate-400">No study partners found</p>
                            ) : (
                                filteredPartners.map(u => (
                                    <div key={u.uid} onClick={() => setSelectedIds(prev => prev.includes(u.uid) ? prev.filter(id => id !== u.uid) : [...prev, u.uid])} className={`flex items-center justify-between rounded-2xl border p-3 cursor-pointer transition-colors ${selectedIds.includes(u.uid) ? 'border-[#0066FF] bg-blue-50/50 dark:bg-blue-950/30' : 'border-slate-200 dark:border-white/10'}`}>
                                        <div className="text-sm font-semibold text-slate-900 dark:text-white">{u.display_name}</div>
                                        <div className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${selectedIds.includes(u.uid) ? 'border-[#0066FF] bg-[#0066FF] text-white' : 'border-slate-300 dark:border-slate-600'}`}>
                                            {selectedIds.includes(u.uid) && <i className="bi bi-check text-xs font-bold"></i>}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                        <div className="flex gap-3 border-t border-slate-100 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-4">
                            <button onClick={() => setShowForwardModal(false)} disabled={isSending} className="flex-1 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 py-3.5 text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300 cursor-pointer">Cancel</button>
                            <button onClick={handleForwardToPartner} disabled={isSending || selectedIds.length === 0} className="flex-[2] rounded-xl bg-[#0066FF] hover:bg-[#0055D4] text-white py-3.5 text-xs font-bold uppercase tracking-wide disabled:opacity-50 transition-colors cursor-pointer">
                                {isSending ? 'Sending...' : `Send to ${selectedIds.length} partner${selectedIds.length !== 1 ? 's' : ''}`}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};


// --- MAIN VISUAL SOLVER COMPONENT ---
type CameraState = 'initializing' | 'denied' | 'error' | 'ready' | 'scanning' | 'preview' | 'analyzing' | 'showingTutorial';
interface CropBox {
    x: number; y: number; width: number; height: number;
}
const MIN_CROP_SIZE = 0.2; // 20%

export interface VisualSolverChatPayload {
    id: string;
    source: string;
    prompt: string;
    image?: string;
    customPrompt?: string;
    tutorialText?: string;
}

interface VisualSolverProps {
  userProfile: UserProfile;
  onStartChat?: (payload: any, tutorialText?: string) => void;
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
