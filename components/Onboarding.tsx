

import React, { useState, useEffect } from 'react';
import { db, type FirebaseUser } from '../firebase';
import { ref as dbRef, get } from 'firebase/database';
import { LogoIcon } from './icons/LogoIcon';
import type { UserProfile } from '../types';

declare var __app_id: string;

interface Course {
  id: string;
  name: string;
  levels: string[];
}

interface OnboardingProps {
  user: FirebaseUser;
  onOnboardingComplete: (profileData: { courseId: string; level: string }) => void;
}

export const Onboarding: React.FC<OnboardingProps> = ({ user, onOnboardingComplete }) => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [levels, setLevels] = useState<string[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<string>('');
  const [selectedLevel, setSelectedLevel] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isLoadingData, setIsLoadingData] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCourses = async () => {
      try {
        const snapshot = await get(dbRef(db, 'courses_data'));
        const data = snapshot.val();
        
        if (data) {
            const fetchedCourses: Course[] = Object.keys(data).map(id => ({ 
              id, 
              name: data[id].course_name, 
              levels: data[id].levels || [] 
            }));

            setCourses(fetchedCourses);
            setSelectedCourse(fetchedCourses[0].id);
            const initialLevels = fetchedCourses[0].levels || [];
            setLevels(initialLevels);
            setSelectedLevel(initialLevels[0] || '');
        } else {
          setError("Could not find configuration data. Please contact support.");
        }
      } catch (err) {
        console.error("Error fetching courses data:", (err as any).message || err);
        setError("An error occurred during setup. Please try again later.");
      } finally {
        setIsLoadingData(false);
      }
    };

    fetchCourses();
  }, []);

  const handleCourseChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newCourseId = e.target.value;
    setSelectedCourse(newCourseId);
    
    const selectedCourseData = courses.find(c => c.id === newCourseId);
    if (selectedCourseData) {
        const courseLevels = selectedCourseData.levels || [];
        setLevels(courseLevels);
        setSelectedLevel(courseLevels[0] || '');
    } else {
        setLevels([]);
        setSelectedLevel('');
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedCourse || !selectedLevel) {
      setError("Please select both a course and a level.");
      return;
    }
    setIsSubmitting(true);
    
    setTimeout(() => {
      onOnboardingComplete({
        courseId: selectedCourse,
        level: selectedLevel,
      });
    }, 1500);
  };

  const renderFormContent = () => {
    if (isLoadingData) {
      return (
        <div className="flex justify-center items-center h-48">
           <svg className="w-12 h-12 loader-logo" viewBox="0 0 52 42" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path className="loader-path-1" d="M4.33331 17.5L26 4.375L47.6666 17.5L26 30.625L4.33331 17.5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path className="loader-path-2" d="M41.5 21V29.75C41.5 30.825 40.85 32.55 39.4166 33.25L27.75 39.375C26.6666 39.9 25.3333 39.9 24.25 39.375L12.5833 33.25C11.15 32.55 10.5 30.825 10.5 29.75V21" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path className="loader-path-3" d="M47.6667 17.5V26.25" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      );
    }

    if (error) {
        return <p className="text-red-600 text-center py-8">{error}</p>;
    }

    return (
      <form onSubmit={handleSubmit}>
        <div className="space-y-6">
          <div>
            <label htmlFor="course" className="block text-sm font-medium text-gray-700 mb-2">
              Choose your course
            </label>
            <select
              id="course"
              name="course"
              value={selectedCourse}
              onChange={handleCourseChange}
              className="w-full bg-gray-50 border border-gray-300 rounded-lg py-2 px-3 text-gray-900 focus:ring-2 focus:ring-lime-500 focus:outline-none"
            >
              {courses.map((course) => (
                <option key={course.id} value={course.id} className="bg-white">
                  {course.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="level" className="block text-sm font-medium text-gray-700 mb-2">
              Select your current level
            </label>
            <select
              id="level"
              name="level"
              value={selectedLevel}
              onChange={(e) => setSelectedLevel(e.target.value)}
              disabled={levels.length === 0}
              className="w-full bg-gray-50 border border-gray-300 rounded-lg py-2 px-3 text-gray-900 focus:ring-2 focus:ring-lime-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {levels.length === 0 && <option disabled value="" className="bg-white">Select a course</option>}
              {levels.map((level) => (
                <option key={level} value={level} className="bg-white">
                  {level}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-8">
          <button
            type="submit"
            disabled={isSubmitting || isLoadingData || !!error || !selectedCourse || !selectedLevel}
            className="w-full bg-gradient-to-r from-lime-500 to-teal-500 text-white font-bold py-3 px-4 rounded-lg hover:opacity-90 transition-opacity duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
          >
            {isSubmitting ? (
              <>
                <svg className="w-5 h-5 mr-2 animate-spin" viewBox="0 0 52 42" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M4.33331 17.5L26 4.375L47.6666 17.5L26 30.625L4.33331 17.5Z" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span>Saving...</span>
              </>
            ) : (
              'Start Learning'
            )}
          </button>
        </div>
      </form>
    );
  };
  
  return (
    <div className="flex items-center justify-center h-full bg-gray-100 p-4 overflow-y-auto">
      <div className="w-full max-w-md my-auto">
        <div className="bg-white border border-gray-200 rounded-2xl p-6 sm:p-8 shadow-2xl">
          <div className="flex justify-center items-center mb-6">
              <LogoIcon className="w-12 h-12 text-lime-500" />
              <h1 className="text-3xl font-bold bg-gradient-to-b from-lime-500 to-green-600 text-transparent bg-clip-text tracking-wider ml-3">
                  VANTUTOR
              </h1>
          </div>
          <div className="text-center mb-8">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-wider">Welcome!</h2>
            <p className="text-gray-600 mt-2">Let's set up your learning path.</p>
          </div>
          {renderFormContent()}
        </div>
      </div>
    </div>
  );
};