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
      syllabusContext: `Focus Areas:\n${description}`,
      source: 'live_tutorial_setup',
      customPrompt: topic
    };
    writeCachedJson('avelut_active_voice_tutorial', payload);
    onNavigate?.('voice_tutorial');
  };

  return (
    <div className="w-full h-full min-h-screen bg-[#FAFAF8] dark:bg-[#0A0A0A] p-4 sm:p-6 md:p-10 pb-32 text-[#111111] dark:text-[#F5F5F5]">
      <div className="max-w-2xl mx-auto p-6 md:p-8 bg-white dark:bg-[#171717] rounded-3xl border border-[#E5E5E0] dark:border-[#2A2A2A] mt-4 md:mt-8">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">Live Tutorial Setup</h1>
        <p className="text-sm text-[#666666] dark:text-[#A3A3A3] mb-8">Configure your AI teacher and jump straight into a real-time voice and visual classroom.</p>
        
        <div className="space-y-6">
          {/* Topic */}
          <div>
            <label className="block text-sm font-semibold mb-2">Topic I want to study</label>
            <input
              type="text"
              className="w-full p-4 rounded-2xl border border-[#E5E5E0] dark:border-[#2A2A2A] bg-[#FAFAF8] dark:bg-[#0A0A0A] text-[#111111] dark:text-[#F5F5F5] text-base focus:outline-none focus:border-black dark:focus:border-white transition-all"
              placeholder="e.g. Action Potentials, Linear Algebra, Macroeconomics"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          </div>

          {/* Description */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-semibold">Description / Focus Areas</label>
              <button 
                type="button"
                onClick={handleGenerate}
                disabled={isGenerating || !topic.trim()}
                className="inline-flex items-center gap-1.5 text-xs font-semibold bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-[#111111] dark:text-[#F5F5F5] px-3.5 py-2 rounded-full border border-[#E5E5E0] dark:border-[#2A2A2A] disabled:opacity-40 transition-colors cursor-pointer"
              >
                <i className="bi bi-stars text-xs" />
                <span>{isGenerating ? 'Generating...' : 'Generate Helper'}</span>
              </button>
            </div>
            <textarea
              className="w-full p-4 h-32 rounded-2xl border border-[#E5E5E0] dark:border-[#2A2A2A] bg-[#FAFAF8] dark:bg-[#0A0A0A] text-[#111111] dark:text-[#F5F5F5] text-base resize-none focus:outline-none focus:border-black dark:focus:border-white transition-all leading-relaxed"
              placeholder="What specifically do you want to cover?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Start */}
          <button
            type="button"
            onClick={handleStart}
            disabled={!topic.trim()}
            className="w-full py-4 mt-2 bg-black dark:bg-white text-white dark:text-black rounded-2xl font-bold text-lg hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors disabled:opacity-40 cursor-pointer flex items-center justify-center gap-2"
          >
            <i className="bi bi-broadcast text-lg" />
            <span>Start Teaching</span>
          </button>
        </div>
      </div>
    </div>
  );
};
