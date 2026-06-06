import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { ref as dbRef, get, update, set } from 'firebase/database';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

interface Message {
    id: string;
    sender: 'user' | 'bot';
    text?: string;
    image_url?: string;
    timestamp: number;
}

interface SharedChatData {
    courseName: string;
    courseId?: string;
    course_id?: string;
    topicName: string;
    topicId: string;
    messages: Message[];
    ownerId: string;
    ownerName: string;
    timestamp: number;
}

interface SharedChatViewProps {
    shareId: string;
    user: any; // Firebase User or null
}

export const SharedChatView: React.FC<SharedChatViewProps> = ({ shareId, user }) => {
    const [sharedData, setSharedData] = useState<SharedChatData | null>(null);
    const [loading, setLoading] = useState(true);
    const [importing, setImporting] = useState(false);
    const [importSuccess, setImportSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!shareId) {
            setError('Invalid share link.');
            setLoading(false);
            return;
        }

        const fetchSharedChat = async () => {
            try {
                const chatRef = dbRef(db, `shared_chats/${shareId}`);
                const snap = await get(chatRef);
                if (snap.exists()) {
                    setSharedData(snap.val() as SharedChatData);
                } else {
                    setError('Shared chat session not found or has been deleted.');
                }
            } catch (err: any) {
                console.error('Error fetching shared chat:', err);
                setError('Failed to load shared chat: ' + err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchSharedChat();
    }, [shareId]);

    const handleImport = async () => {
        if (!user || !sharedData) return;
        setImporting(true);
        try {
            const userProfileRef = dbRef(db, `users/${user.uid}`);
            const userSnap = await get(userProfileRef);
            if (!userSnap.exists()) {
                throw new Error('User profile not found.');
            }

            const courseId = sharedData.courseId || sharedData.course_id || 'unspecified';
            
            // 1. Unlock course if missing
            const unlockPath = `users/${user.uid}/usage_stats/unlocked_courses/${courseId}`;
            await update(dbRef(db), { [unlockPath]: true });

            // 2. Import chat messages
            const messagesRef = dbRef(db, `study_guide_messages/${user.uid}/${sharedData.topicId}`);
            
            // Format messages to write
            const updates: Record<string, any> = {};
            sharedData.messages.forEach((msg, index) => {
                const newMsgId = `imported_${index}_${Date.now()}`;
                updates[newMsgId] = {
                    sender: msg.sender,
                    text: msg.text || '',
                    image_url: msg.image_url || null,
                    timestamp: Date.now() + index * 100 // keep ordering
                };
            });

            await update(messagesRef, updates);

            // 3. Mark progress topic unlocked/initialised in user_progress
            const progressRef = dbRef(db, `user_progress/${user.uid}/${sharedData.topicId}`);
            await update(progressRef, {
                is_complete: false,
                timestamp: Date.now(),
                course_id: courseId,
                course_name: sharedData.courseName,
                level: userSnap.val().level || '100'
            });

            setImportSuccess(true);
            setTimeout(() => {
                window.location.href = '/'; // Go to main page to load study guide
            }, 1500);

        } catch (err: any) {
            console.error('Failed to import chat:', err);
            alert('Failed to import shared chat: ' + err.message);
        } finally {
            setImporting(false);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 text-white gap-3">
                <div className="w-10 h-10 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
                <span className="text-sm font-semibold tracking-wider text-slate-400">Loading Shared Lesson...</span>
            </div>
        );
    }

    if (error || !sharedData) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 text-white p-6 text-center">
                <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center text-red-500 text-2xl mb-4">⚠️</div>
                <h2 className="text-xl font-bold mb-2">{error || 'An error occurred'}</h2>
                <p className="text-slate-400 text-sm max-w-md mb-6">Check the share link or make sure the chat was shared publicly.</p>
                <a href="/" className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 font-bold text-xs uppercase tracking-wider rounded-xl transition">Go to AVELUT</a>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-screen w-full bg-slate-950 text-slate-100 overflow-hidden font-sans">
            {/* Header */}
            <header className="flex-shrink-0 flex items-center justify-between p-4 bg-slate-900 border-b border-slate-800 z-10">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center p-1 flex-shrink-0">
                        <img src="/logo_icon.png" alt="AVELUT" className="w-full h-full object-contain" />
                    </div>
                    <div>
                        <h2 className="text-sm font-black text-white">{sharedData.topicName}</h2>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{sharedData.courseName}</p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {user ? (
                        <button
                            onClick={handleImport}
                            disabled={importing || importSuccess}
                            className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-xl transition ${importSuccess ? 'bg-emerald-600 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50'}`}
                        >
                            {importSuccess ? 'Imported successfully!' : importing ? 'Importing...' : 'Import to Study Guide'}
                        </button>
                    ) : (
                        <a
                            href="/"
                            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 text-xs font-black uppercase tracking-widest rounded-xl transition"
                        >
                            Log In to Import
                        </a>
                    )}
                </div>
            </header>

            {/* Message Area */}
            <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden bg-slate-950">
                <div className="max-w-3xl mx-auto space-y-6">
                    <div className="text-center py-4 bg-slate-900/50 border border-slate-800/80 rounded-2xl p-4 mb-8">
                        <span className="text-[10px] font-black uppercase tracking-widest bg-blue-500/10 text-blue-400 px-3 py-1 rounded-full">Shared Study Guide Chat</span>
                        <p className="text-xs text-slate-400 mt-2 leading-relaxed font-semibold">Shared by <strong>{sharedData.ownerName}</strong>. Log in to your AVELUT account to import these chat messages into your curriculum roadmaps.</p>
                    </div>

                    {sharedData.messages.map((message) => (
                        <div key={message.id} className={`flex items-start gap-4 ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                            {message.sender === 'bot' && (
                                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-600 flex-shrink-0 flex items-center justify-center font-bold text-xs text-white">
                                    AI
                                </div>
                            )}

                            <div className="flex flex-col max-w-[85%] sm:max-w-lg md:max-w-xl">
                                <div className={`p-4 rounded-2xl border ${message.sender === 'user' ? 'bg-blue-600 text-white border-blue-500 rounded-br-none' : 'bg-slate-900 text-slate-200 border-slate-800 rounded-bl-none'}`}>
                                    {message.image_url && (
                                        <div className="mb-3">
                                            <img src={message.image_url} alt="Shared visualization" className="rounded-lg w-full" />
                                        </div>
                                    )}
                                    <div className="text-sm prose prose-invert prose-sm max-w-none">
                                        <ReactMarkdown
                                            remarkPlugins={[remarkGfm, remarkMath]}
                                            rehypePlugins={[rehypeKatex]}
                                            components={{
                                                h1: ({node, ...props}) => <h1 className="text-lg font-bold text-white mb-2 mt-1" {...props} />,
                                                h2: ({node, ...props}) => <h2 className="text-base font-bold text-white mb-1.5 mt-2" {...props} />,
                                                p: ({node, ...props}) => <p className="mb-2 last:mb-0 leading-relaxed" {...props} />,
                                                strong: ({node, ...props}) => <strong className="font-bold text-white bg-slate-800 px-1 py-0.5 rounded" {...props} />,
                                                code: ({node, inline, ...props}: any) => 
                                                    inline ? (
                                                        <code className="bg-slate-800 text-slate-100 px-1 py-0.5 rounded text-xs" {...props} />
                                                    ) : (
                                                        <code className="block bg-slate-950 text-slate-200 p-3 rounded-lg overflow-x-auto my-2 text-xs font-mono" {...props} />
                                                    ),
                                                pre: ({node, ...props}) => <pre className="bg-slate-950 rounded-lg overflow-hidden my-2" {...props} />,
                                                ul: ({node, ...props}) => <ul className="list-disc list-outside space-y-1 my-2 pl-4" {...props} />,
                                                ol: ({node, ...props}) => <ol className="list-decimal list-outside space-y-1 my-2 pl-4" {...props} />,
                                                li: ({node, ...props}) => <li className="pl-0.5 text-slate-300" {...props} />,
                                            }}
                                        >
                                            {message.text || ''}
                                        </ReactMarkdown>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
