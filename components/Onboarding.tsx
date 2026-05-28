

import React, { useState, useEffect } from 'react';
import { db, type FirebaseUser } from '../firebase';
import { ref as dbRef, get } from 'firebase/database';
import { LogoIcon } from './icons/LogoIcon';
import type { UserProfile } from '../types';

declare var __app_id: string;

interface Department {
  id: string;
  name: string;
  levels: string[];
}

interface OnboardingProps {
  user: FirebaseUser;
  onOnboardingComplete: (profileData: { departmentId: string; level: string }) => void;
}

export const Onboarding: React.FC<OnboardingProps> = ({ user, onOnboardingComplete }) => {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [levels, setLevels] = useState<string[]>([]);
  const [selectedDepartment, setSelectedDepartment] = useState<string>('');
  const [selectedLevel, setSelectedLevel] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isLoadingData, setIsLoadingData] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDepartments = async () => {
      try {
        const snapshot = await get(dbRef(db, 'departments_data'));
        const data = snapshot.val();
        
        if (data) {
            const fetchedDepartments: Department[] = Object.keys(data).map(id => ({ 
              id, 
              name: data[id].department_name, 
              levels: data[id].levels || [] 
            }));

            setDepartments(fetchedDepartments);
            setSelectedDepartment(fetchedDepartments[0].id);
            const initialLevels = fetchedDepartments[0].levels || [];
            setLevels(initialLevels);
            setSelectedLevel(initialLevels[0] || '');
        } else {
          setError("Could not find configuration data. Please contact support.");
        }
      } catch (err) {
        console.error("Error fetching departments data:", (err as any).message || err);
        setError("An error occurred during setup. Please try again later.");
      } finally {
        setIsLoadingData(false);
      }
    };

    fetchDepartments();
  }, []);

  const handleDepartmentChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newDeptId = e.target.value;
    setSelectedDepartment(newDeptId);
    
    const selectedDeptData = departments.find(d => d.id === newDeptId);
    if (selectedDeptData) {
        const deptLevels = selectedDeptData.levels || [];
        setLevels(deptLevels);
        setSelectedLevel(deptLevels[0] || '');
    } else {
        setLevels([]);
        setSelectedLevel('');
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedDepartment || !selectedLevel) {
      setError("Please select both a department and a level.");
      return;
    }
    setIsSubmitting(true);
    
    setTimeout(() => {
      onOnboardingComplete({
        departmentId: selectedDepartment,
        level: selectedLevel,
      });
    }, 1500);
  };

  const renderFormContent = () => {
    if (isLoadingData) {
      return (
        <div className="flex justify-center items-center h-48">
          <LogoIcon className="w-12 h-12 loader-logo" />
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
            <label htmlFor="department" className="block text-sm font-medium text-gray-700 mb-2">
              Choose your department
            </label>
            <select
              id="department"
              name="department"
              value={selectedDepartment}
              onChange={handleDepartmentChange}
              className="w-full bg-gray-50 border border-gray-300 rounded-lg py-2 px-3 text-gray-900 focus:ring-2 focus:ring-lime-500 focus:outline-none"
            >
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id} className="bg-white">
                  {dept.name}
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
              {levels.length === 0 && <option disabled value="" className="bg-white">Select a department</option>}
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
            disabled={isSubmitting || isLoadingData || !!error || !selectedDepartment || !selectedLevel}
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