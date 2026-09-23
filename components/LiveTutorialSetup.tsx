import React, { useState } from 'react';
import type { UserProfile, AppSettings } from '../types';
import { createAvelutAI, getResponseText } from '../utils/inference';
import { writeCachedJson } from '../utils/cache';

export interface LiveTutorialSetupProps {
  userProfile: UserProfile;
  appSettings: AppSettings;
  onNavigate?: (tab: string) => void;
}

export const LiveTutorialSetup: React.FC<LiveTutorialSetupProps> = ({
  userProfile,
  appSettings,
  onNavigate,
}) => {
  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');
  const [depth, setDepth] = useState('Detailed');
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = async () => {
    if (!topic.trim()) return;
    setIsGenerating(true);
    try {
      const ai = createAvelutAI(appSettings);
      const res = await ai.models.generateContent({
        contents: `Create a brief, educational syllabus or learning description for the topic: "${topic}". Keep it concise and list a few key areas of focus.`
      });
      setDescription(getResponseText(res));
    } catch (err) {
      console.error('Failed to generate description:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleStart = () => {
    if (!topic.trim()) return;
    const payload = {
      course: { course_id: 'custom_course', course_name: 'Custom Tutorial' },
      topic: { topic_id: `custom_${Date.now()}`, topic_name: topic, topic_context: description },
      syllabusContext: `Depth Level: ${depth}.\n\nFocus Areas:\n${description}`,
      source: 'live_tutorial_setup',
      customPrompt: topic
    };
    writeCachedJson('avelut_active_voice_tutorial', payload);
    onNavigate?.('voice_tutorial');
  };

  return (
    <div className="w-full h-full min-h-screen bg-slate-50 dark:bg-[#050505] p-4 sm:p-6 md:p-10 pb-32">
      <div className="max-w-2xl mx-auto p-6 md:p-8 bg-white dark:bg-[#0A0A0A] rounded-3xl shadow-sm border border-slate-200 dark:border-white/10 mt-4 md:mt-8 animate-fade-in-up">
        <h1 className="text-3xl font-bold text-[#002D62] dark:text-white mb-2">Live Tutorial Setup</h1>
        <p className="text-slate-500 dark:text-slate-400 mb-8">Configure your AI teacher and jump straight into a real-time voice and visual classroom.</p>
        
        <div className="space-y-8">
          {/* Topic */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Topic I want to study</label>
            <input
              type="text"
              className="w-full p-4 rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#1A1A1A] text-slate-900 dark:text-white text-lg focus:ring-2 focus:ring-[#0066FF] outline-none transition-all"
              placeholder="e.g. Action Potentials, Linear Algebra, Macroeconomics"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          </div>

          {/* Description */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">Description / Focus Areas</label>
              <button 
                onClick={handleGenerate}
                disabled={isGenerating || !topic.trim()}
                className="text-xs font-bold bg-[#E53935]/10 text-[#E53935] px-4 py-2 rounded-full disabled:opacity-50 hover:bg-[#E53935]/20 transition-colors"
              >
                {isGenerating ? 'Generating...' : '✨ Generate Helper'}
              </button>
            </div>
            <textarea
              className="w-full p-4 h-32 rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#1A1A1A] text-slate-900 dark:text-white text-base resize-none focus:ring-2 focus:ring-[#0066FF] outline-none transition-all leading-relaxed"
              placeholder="What specifically do you want to cover?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Depth */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Tutorial Depth</label>
            <div className="flex gap-3">
              {['Summary', 'Detailed', 'Comprehensive'].map(d => (
                <button
                  key={d}
                  onClick={() => setDepth(d)}
                  className={`flex-1 py-3 rounded-2xl text-sm font-semibold border transition-all ${
                    depth === d 
                      ? 'bg-[#002D62] border-[#002D62] text-white shadow-md'
                      : 'bg-white border-slate-200 text-slate-600 dark:bg-[#1A1A1A] dark:border-white/10 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#222]'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* Start */}
          <button
            onClick={handleStart}
            disabled={!topic.trim()}
            className="w-full py-5 mt-4 bg-[#E53935] text-white rounded-2xl font-bold text-xl shadow-xl shadow-[#E53935]/20 hover:bg-[#D32F2F] active:scale-95 transition-all disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-3"
          >
            Start Teaching
          </button>
        </div>
      </div>
    </div>
  );
};
