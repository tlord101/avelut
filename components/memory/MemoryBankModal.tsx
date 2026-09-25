import React, { useState, useEffect, useMemo } from 'react';
import {
  AIMemoryBank,
  MemoryCategory,
  MemoryItem,
  getAIMemoryBank,
  addMemoryItem,
  updateMemoryItem,
  deleteMemoryItem,
  clearAllMemories,
  toggleMemoryBank,
} from '../../services/aiMemoryBankService';
import type { UserProfile } from '../../types';

interface MemoryBankModalProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile: UserProfile;
  onMemoryBankChange?: (bank: AIMemoryBank) => void;
}

const CATEGORIES: Array<{ id: 'all' | MemoryCategory; label: string; icon: string }> = [
  { id: 'all', label: 'All', icon: 'bi-grid' },
  { id: 'academic', label: 'Academic', icon: 'bi-mortarboard' },
  { id: 'learning_style', label: 'Learning Style', icon: 'bi-lightning' },
  { id: 'goals', label: 'Goals', icon: 'bi-trophy' },
  { id: 'strengths_weaknesses', label: 'Strengths & Weaknesses', icon: 'bi-bar-chart' },
  { id: 'preference', label: 'Preferences', icon: 'bi-sliders' },
];

const SUGGESTED_MEMORIES = [
  { text: 'Prefers step-by-step derivations before the final answer', category: 'learning_style' as MemoryCategory },
  { text: 'Loves everyday Nigerian analogies (POS, Danfo, market bargains)', category: 'learning_style' as MemoryCategory },
  { text: 'Targeting a First Class degree / 4.5+ GPA this session', category: 'goals' as MemoryCategory },
  { text: 'Prefers concise explanations without meta chatter or emojis', category: 'preference' as MemoryCategory },
  { text: 'Needs extra intuitive breakdowns for calculus & differential equations', category: 'strengths_weaknesses' as MemoryCategory },
];

export const MemoryBankModal: React.FC<MemoryBankModalProps> = ({
  isOpen,
  onClose,
  userProfile,
  onMemoryBankChange,
}) => {
  const [bank, setBank] = useState<AIMemoryBank | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<'all' | MemoryCategory>('all');
  const [newMemoryText, setNewMemoryText] = useState('');
  const [newMemoryCategory, setNewMemoryCategory] = useState<MemoryCategory>('learning_style');
  const [isAdding, setIsAdding] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const uid = userProfile?.uid || 'anon';

  const loadBank = async () => {
    setIsLoading(true);
    try {
      const data = await getAIMemoryBank(uid, userProfile);
      setBank(data);
      onMemoryBankChange?.(data);
    } catch (e) {
      console.error('[MemoryBankModal] Failed to load memories:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void loadBank();
    }
  }, [isOpen, uid]);

  const filteredItems = useMemo(() => {
    if (!bank) return [];
    if (selectedCategory === 'all') return bank.items;
    return bank.items.filter((item) => item.category === selectedCategory);
  }, [bank, selectedCategory]);

  const handleToggleBank = async () => {
    if (!bank) return;
    const nextState = !bank.isEnabled;
    await toggleMemoryBank(uid, nextState);
    const updated = { ...bank, isEnabled: nextState };
    setBank(updated);
    onMemoryBankChange?.(updated);
  };

  const handleToggleItem = async (item: MemoryItem) => {
    if (!bank) return;
    const nextEnabled = !item.enabled;
    await updateMemoryItem(uid, item.id, { enabled: nextEnabled });
    const updatedItems = bank.items.map((m) =>
      m.id === item.id ? { ...m, enabled: nextEnabled } : m
    );
    const updatedBank = { ...bank, items: updatedItems };
    setBank(updatedBank);
    onMemoryBankChange?.(updatedBank);
  };

  const handleSaveNewMemory = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newMemoryText.trim()) return;
    setIsAdding(true);
    try {
      const added = await addMemoryItem(uid, newMemoryText.trim(), newMemoryCategory, 'manual');
      if (bank) {
        const updated = { ...bank, items: [added, ...bank.items.filter((m) => m.id !== added.id)] };
        setBank(updated);
        onMemoryBankChange?.(updated);
      }
      setNewMemoryText('');
    } finally {
      setIsAdding(false);
    }
  };

  const handleAddSuggested = async (suggested: { text: string; category: MemoryCategory }) => {
    const added = await addMemoryItem(uid, suggested.text, suggested.category, 'manual');
    if (bank) {
      const updated = { ...bank, items: [added, ...bank.items.filter((m) => m.id !== added.id)] };
      setBank(updated);
      onMemoryBankChange?.(updated);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    await deleteMemoryItem(uid, itemId);
    if (bank) {
      const updated = { ...bank, items: bank.items.filter((m) => m.id !== itemId) };
      setBank(updated);
      onMemoryBankChange?.(updated);
    }
  };

  const handleStartEdit = (item: MemoryItem) => {
    setEditingItemId(item.id);
    setEditText(item.content);
  };

  const handleSaveEdit = async (itemId: string) => {
    if (!editText.trim()) return;
    await updateMemoryItem(uid, itemId, { content: editText.trim() });
    if (bank) {
      const updatedItems = bank.items.map((m) =>
        m.id === itemId ? { ...m, content: editText.trim() } : m
      );
      const updatedBank = { ...bank, items: updatedItems };
      setBank(updatedBank);
      onMemoryBankChange?.(updatedBank);
    }
    setEditingItemId(null);
  };

  const handleClearAll = async () => {
    await clearAllMemories(uid);
    if (bank) {
      const updated = { ...bank, items: [] };
      setBank(updated);
      onMemoryBankChange?.(updated);
    }
    setShowClearConfirm(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-white dark:bg-[#121212] border border-neutral-200 dark:border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-neutral-200/80 dark:border-white/10 flex items-center justify-between bg-gradient-to-r from-blue-50/50 via-transparent to-purple-50/50 dark:from-blue-950/20 dark:via-transparent dark:to-purple-950/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#0066FF] to-[#7928CA] flex items-center justify-center text-white shadow-md shadow-blue-500/20">
              <i className="bi bi-cpu text-lg"></i>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-neutral-900 dark:text-white">
                  AI Memory Bank
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/40">
                  Adaptive
                </span>
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Avelut learns and adapts to your academic goals & style
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Master Toggle */}
            <button
              onClick={handleToggleBank}
              type="button"
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                bank?.isEnabled ? 'bg-[#0066FF]' : 'bg-neutral-300 dark:bg-neutral-700'
              }`}
              title={bank?.isEnabled ? 'Memory Bank is Active' : 'Memory Bank is Paused'}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  bank?.isEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>

            {/* Close Button */}
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
            >
              <i className="bi bi-x-lg text-sm"></i>
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4 space-y-4">
          {/* Status Banner when paused */}
          {bank && !bank.isEnabled && (
            <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 flex items-center gap-3 text-amber-800 dark:text-amber-200 text-xs">
              <i className="bi bi-pause-circle text-base shrink-0"></i>
              <span>
                Memory Bank is currently paused. Avelut will not recall past memories or save new ones until re-enabled.
              </span>
            </div>
          )}

          {/* Quick Add Form */}
          <form
            onSubmit={handleSaveNewMemory}
            className="p-3.5 rounded-2xl bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800 space-y-2.5"
          >
            <div className="flex items-center justify-between text-xs font-semibold text-neutral-700 dark:text-neutral-300">
              <span className="flex items-center gap-1.5">
                <i className="bi bi-plus-circle text-blue-600 dark:text-blue-400"></i>
                Teach Avelut something to remember
              </span>
              <select
                value={newMemoryCategory}
                onChange={(e) => setNewMemoryCategory(e.target.value as MemoryCategory)}
                className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200 rounded-lg px-2 py-1 text-xs outline-none cursor-pointer"
              >
                <option value="learning_style">Learning Style</option>
                <option value="academic">Academic Background</option>
                <option value="goals">Academic Goals</option>
                <option value="strengths_weaknesses">Strengths & Weaknesses</option>
                <option value="preference">General Preference</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newMemoryText}
                onChange={(e) => setNewMemoryText(e.target.value)}
                placeholder="e.g. Always use Nigerian real-world analogies, or I struggle with Integration by Parts..."
                className="flex-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3.5 py-2 text-xs sm:text-sm text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={!newMemoryText.trim() || isAdding}
                className="px-4 py-2 rounded-xl bg-[#0066FF] hover:bg-[#0052cc] disabled:opacity-40 text-white text-xs font-bold transition-all shrink-0 cursor-pointer active:scale-95 shadow-sm"
              >
                {isAdding ? 'Saving...' : 'Remember'}
              </button>
            </div>
          </form>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {CATEGORIES.map((cat) => {
              const isSelected = selectedCategory === cat.id;
              const count = cat.id === 'all'
                ? bank?.items.length || 0
                : bank?.items.filter((i) => i.category === cat.id).length || 0;
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer ${
                    isSelected
                      ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 shadow-sm'
                      : 'bg-neutral-100 dark:bg-neutral-800/80 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                  }`}
                >
                  <i className={`bi ${cat.icon} text-[11px]`}></i>
                  <span>{cat.label}</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${isSelected ? 'bg-white/20 dark:bg-black/20 text-current' : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Memory Items List */}
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center text-neutral-400 gap-2">
              <i className="bi bi-arrow-repeat animate-spin text-2xl"></i>
              <span className="text-xs">Loading memories...</span>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-8 text-center space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-400 mx-auto">
                <i className="bi bi-lightbulb text-xl"></i>
              </div>
              <div>
                <p className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  No memories in this category yet
                </p>
                <p className="text-xs text-neutral-400 mt-1 max-w-sm mx-auto">
                  Avelut automatically learns about you as you chat, or you can add suggestions below.
                </p>
              </div>

              {/* Suggestions */}
              <div className="pt-2 text-left space-y-1.5 max-w-md mx-auto">
                <span className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider block">
                  Suggested Ideas
                </span>
                {SUGGESTED_MEMORIES.map((s, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleAddSuggested(s)}
                    className="w-full p-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-900 hover:bg-blue-50 dark:hover:bg-blue-950/30 border border-neutral-200/80 dark:border-neutral-800 text-left text-xs text-neutral-700 dark:text-neutral-300 flex items-center justify-between group transition-colors cursor-pointer"
                  >
                    <span>{s.text}</span>
                    <i className="bi bi-plus-lg text-blue-600 dark:text-blue-400 opacity-60 group-hover:opacity-100 transition-opacity ml-2 shrink-0"></i>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredItems.map((item) => {
                const isEditing = editingItemId === item.id;
                return (
                  <div
                    key={item.id}
                    className={`p-3.5 rounded-2xl border transition-all ${
                      item.enabled
                        ? 'bg-white dark:bg-neutral-900 border-neutral-200 dark:border-white/10 shadow-xs'
                        : 'bg-neutral-50 dark:bg-neutral-900/40 border-neutral-200/50 dark:border-white/5 opacity-60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border border-neutral-200/60 dark:border-white/5">
                            {item.category.replace('_', ' ')}
                          </span>
                          {item.source === 'auto' ? (
                            <span className="text-[10px] text-blue-600 dark:text-blue-400 flex items-center gap-1 font-semibold">
                              <i className="bi bi-stars"></i> Auto-Learned
                            </span>
                          ) : (
                            <span className="text-[10px] text-neutral-400">Custom</span>
                          )}
                        </div>

                        {isEditing ? (
                          <div className="flex items-center gap-2 mt-2">
                            <input
                              type="text"
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              className="flex-1 bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-neutral-900 dark:text-white focus:outline-none"
                              autoFocus
                            />
                            <button
                              onClick={() => handleSaveEdit(item.id)}
                              className="px-2.5 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold cursor-pointer"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingItemId(null)}
                              className="px-2.5 py-1.5 rounded-lg bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300 text-xs cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <p className="text-xs sm:text-sm text-neutral-800 dark:text-neutral-200 leading-relaxed">
                            {item.content}
                          </p>
                        )}
                      </div>

                      {/* Item Actions */}
                      <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                        <button
                          onClick={() => handleToggleItem(item)}
                          className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                            item.enabled
                              ? 'text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50'
                              : 'text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800'
                          }`}
                          title={item.enabled ? 'Disable memory' : 'Enable memory'}
                        >
                          <i className={`bi ${item.enabled ? 'bi-toggle-on text-lg' : 'bi-toggle-off text-lg'}`}></i>
                        </button>
                        <button
                          onClick={() => handleStartEdit(item)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
                          title="Edit memory"
                        >
                          <i className="bi bi-pencil text-xs"></i>
                        </button>
                        <button
                          onClick={() => handleDeleteItem(item.id)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-neutral-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer"
                          title="Delete memory"
                        >
                          <i className="bi bi-trash text-xs"></i>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 sm:px-6 py-3.5 border-t border-neutral-200/80 dark:border-white/10 bg-neutral-50 dark:bg-neutral-900/60 flex items-center justify-between text-xs">
          <span className="text-neutral-500 dark:text-neutral-400">
            {bank?.items.filter((i) => i.enabled).length || 0} active memories personalizing your AI
          </span>

          {bank && bank.items.length > 0 && (
            <div>
              {showClearConfirm ? (
                <div className="flex items-center gap-2">
                  <span className="text-red-600 dark:text-red-400 text-xs font-semibold">Delete all?</span>
                  <button
                    onClick={handleClearAll}
                    className="px-2.5 py-1 rounded-lg bg-red-600 text-white font-bold text-xs cursor-pointer hover:bg-red-700"
                  >
                    Yes, Clear
                  </button>
                  <button
                    onClick={() => setShowClearConfirm(false)}
                    className="px-2 py-1 rounded-lg bg-neutral-200 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 text-xs cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowClearConfirm(true)}
                  className="text-neutral-400 hover:text-red-600 dark:hover:text-red-400 transition-colors cursor-pointer text-xs font-semibold flex items-center gap-1"
                >
                  <i className="bi bi-trash"></i>
                  <span>Clear All</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MemoryBankModal;
