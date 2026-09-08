import { type FirebaseUser } from '@/lib/backend';
import React, { useState } from 'react';
import { SchoolHierarchySelector } from './SchoolHierarchySelector';

interface OnboardingProps {
  user: FirebaseUser;
  onOnboardingComplete: (profileData: { schoolId: string; collegeId: string; departmentId: string; level: string }) => void;
}

export const Onboarding: React.FC<OnboardingProps> = ({ user, onOnboardingComplete }) => {
  const [selectedSchool, setSelectedSchool] = useState<string>('');
  const [selectedCollege, setSelectedCollege] = useState<string>('');
  const [selectedDepartment, setSelectedDepartment] = useState<string>('');
  const [selectedLevel, setSelectedLevel] = useState<string>('');
  
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const levelOptions = [
    { id: '100', name: '100 Level', label: '1st Year' },
    { id: '200', name: '200 Level', label: '2nd Year' },
    { id: '300', name: '300 Level', label: '3rd Year' },
    { id: '400', name: '400 Level', label: '4th Year' },
    { id: '500', name: '500 Level', label: 'Final Year' },
  ];

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedSchool || !selectedCollege || !selectedDepartment || !selectedLevel) {
      setError("Please complete all 4 academic fields to personalize your learning path.");
      return;
    }
    setError(null);
    setIsSubmitting(true);
    
    setTimeout(() => {
      onOnboardingComplete({
        schoolId: selectedSchool,
        collegeId: selectedCollege,
        departmentId: selectedDepartment,
        level: selectedLevel,
      });
    }, 1200);
  };

  const isFormComplete = Boolean(selectedSchool && selectedCollege && selectedDepartment && selectedLevel);

  return (
    <div className="min-h-screen bg-[#F6F6F3] dark:bg-[#000000] flex items-center justify-center p-4 sm:p-8 md:p-12 relative z-50 transition-colors duration-200">
      {/* Ambient background glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-[#0066FF]/10 dark:bg-[#0066FF]/5 rounded-full blur-3xl pointer-events-none -z-10" />

      {/* Main Wide Card Surface */}
      <div className="w-full max-w-5xl bg-white dark:bg-[#0A0A0A] border border-[#E3E9F1] dark:border-white/10 rounded-3xl sm:rounded-[36px] p-6 sm:p-10 md:p-12 shadow-[0_20px_60px_-15px_rgba(15,23,42,0.08)] dark:shadow-[0_20px_60px_-15px_rgba(0,0,0,0.6)]">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-8 mb-8 border-b border-[#E3E9F1] dark:border-white/10">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-[#F1F5F9] dark:bg-white/5 border border-[#E3E9F1] dark:border-white/10 flex items-center justify-center p-2.5 shrink-0 shadow-sm">
              <img src="/logo_full_black.png" alt="AVELUT" className="w-full h-full object-contain dark:hidden" />
              <img src="/logo_full_white.png" alt="AVELUT" className="w-full h-full object-contain hidden dark:block" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0F172A] dark:text-white tracking-tight">
                Academic Onboarding
              </h1>
              <p className="text-sm sm:text-base text-[#64748B] dark:text-gray-400 mt-1 font-medium">
                Configure your institution and program for personalized AI study plans.
              </p>
            </div>
          </div>

          {/* User Preview Badge */}
          {user?.displayName && (
            <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-2xl bg-[#F1F5F9] dark:bg-white/5 border border-[#E3E9F1] dark:border-white/10 self-start md:self-auto">
              <div className="w-7 h-7 rounded-full bg-[#0066FF] text-white text-xs font-black flex items-center justify-center uppercase">
                {user.displayName.charAt(0)}
              </div>
              <span className="text-xs sm:text-sm font-bold text-[#0F172A] dark:text-white">
                {user.displayName}
              </span>
            </div>
          )}
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-sm font-semibold flex items-center gap-3 animate-in fade-in">
            <i className="bi bi-exclamation-triangle-fill text-lg shrink-0 text-rose-600 dark:text-rose-400"></i>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Steps 1, 2, 3: School, College, Department */}
          <div>
            <SchoolHierarchySelector 
              schoolId={selectedSchool}
              setSchoolId={setSelectedSchool}
              collegeId={selectedCollege}
              setCollegeId={setSelectedCollege}
              departmentId={selectedDepartment}
              setDepartmentId={setSelectedDepartment}
            />
          </div>

          {/* Step 4: Level Selector */}
          <div>
            <label className="flex items-center gap-2 text-sm font-bold text-[#0F172A] dark:text-white mb-3">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#0066FF] text-white text-xs font-black">
                4
              </span>
              Select Academic Level
            </label>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {levelOptions.map((opt) => {
                const isSelected = selectedLevel === opt.id;
                const isDisabled = !selectedDepartment;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => {
                      setSelectedLevel(opt.id);
                      if (error) setError(null);
                    }}
                    className={`py-3.5 px-4 rounded-2xl border text-center transition-all duration-200 cursor-pointer ${
                      isDisabled 
                        ? 'opacity-40 cursor-not-allowed bg-gray-100 dark:bg-white/5 border-transparent'
                        : isSelected
                        ? 'bg-[#0066FF] text-white font-bold border-[#0066FF] shadow-md shadow-[#0066FF]/20 scale-[1.02]'
                        : 'bg-[#F1F5F9]/80 dark:bg-white/5 border-[#E3E9F1] dark:border-white/10 text-[#0F172A] dark:text-white hover:border-[#0066FF]/50 hover:bg-white dark:hover:bg-white/10'
                    }`}
                  >
                    <div className="text-sm font-bold">{opt.name}</div>
                    <div className={`text-[11px] mt-0.5 ${isSelected ? 'text-blue-100' : 'text-[#64748B] dark:text-gray-400'}`}>
                      {opt.label}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Submit Action Area */}
          <div className="pt-4 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-[#E3E9F1] dark:border-white/10">
            <div className="text-xs text-[#64748B] dark:text-gray-400 flex items-center gap-2">
              <i className="bi bi-shield-check text-[#0066FF] text-sm"></i>
              <span>All past questions and syllabus blueprints will be tailored to your program.</span>
            </div>

            <button
              type="submit"
              disabled={isSubmitting || !isFormComplete}
              className="w-full sm:w-auto min-w-[220px] bg-[#0066FF] hover:bg-[#0052CC] text-white font-black py-4 px-8 rounded-2xl shadow-lg shadow-[#0066FF]/25 hover:shadow-xl hover:shadow-[#0066FF]/30 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-3 text-base cursor-pointer active:scale-[0.98]"
            >
              {isSubmitting ? (
                <>
                  <i className="bi bi-arrow-repeat animate-spin text-lg"></i>
                  <span>Personalizing Workspace...</span>
                </>
              ) : (
                <>
                  <span>Start Learning</span>
                  <i className="bi bi-arrow-right font-bold text-lg"></i>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};