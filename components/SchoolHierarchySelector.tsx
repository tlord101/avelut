import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabaseDataService } from '../services/supabaseDataService';
import { NIGERIAN_FACULTIES } from '../lib/academic-constants';
import type { School, College, Department } from '../types';
import { useAppSettings } from '../hooks/useAppSettings';
import { createAvelutAI, getResponseText } from '../utils/inference';

const sanitizeId = (name: string) => 
  name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

interface Option {
  id: string;
  name: string;
  short_name?: string;
}

interface CustomSearchableSelectProps {
  label: string;
  stepNumber: number;
  options: Option[];
  value: string;
  onChange: (opt: Option) => void;
  placeholder: string;
  disabled?: boolean;
  onAddNew?: (name: string) => Promise<void>;
  searchFn?: (query: string) => Promise<Option[]>;
}

const CustomSearchableSelect: React.FC<CustomSearchableSelectProps> = ({ 
  label, stepNumber, options, value, onChange, placeholder, disabled, onAddNew, searchFn 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [asyncOptions, setAsyncOptions] = useState<Option[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    if (searchFn && searchQuery.trim().length >= 2) {
      setIsSearching(true);
      searchFn(searchQuery.trim()).then(res => {
        if (active) {
          setAsyncOptions(res);
          setIsSearching(false);
        }
      }).catch(() => {
        if (active) setIsSearching(false);
      });
    } else {
      setAsyncOptions([]);
    }
    return () => { active = false; };
  }, [searchQuery, searchFn]);

  const filteredOptions = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const localMatches = options.filter(opt => 
      opt.name.toLowerCase().includes(q) || 
      (opt.short_name && opt.short_name.toLowerCase().includes(q))
    );
    if (searchFn) {
      const seen = new Set(localMatches.map(l => l.name.toLowerCase()));
      const additional = asyncOptions.filter(opt => !seen.has(opt.name.toLowerCase()));
      return [...localMatches, ...additional];
    }
    return localMatches;
  }, [options, searchQuery, asyncOptions, searchFn]);

  const selectedOption = useMemo(() => {
    return options.find(opt => opt.id === value) || 
           asyncOptions.find(opt => opt.id === value) || 
           { id: value, name: value.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') };
  }, [options, value, asyncOptions]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (opt: Option) => {
    onChange(opt);
    setIsOpen(false);
    setSearchQuery('');
  };

  const handleAddNew = async () => {
    if (onAddNew && searchQuery.trim()) {
      setIsAddingNew(true);
      try {
        await onAddNew(searchQuery.trim());
        setIsOpen(false);
        setSearchQuery('');
      } finally {
        setIsAddingNew(false);
      }
    }
  };

  const showAddNew = onAddNew && searchQuery.trim().length > 0 && 
                     !filteredOptions.some(opt => opt.name.toLowerCase() === searchQuery.trim().toLowerCase());

  return (
    <div className="relative" ref={dropdownRef}>
      <label className="flex items-center gap-2 text-sm font-bold text-[#0F172A] dark:text-white mb-2">
        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#0066FF] text-white text-xs font-black">
          {stepNumber}
        </span>
        {label}
      </label>

      <div 
        className={`w-full bg-[#F1F5F9]/80 dark:bg-white/5 border border-[#E3E9F1] dark:border-white/10 rounded-2xl py-3.5 px-4 flex items-center justify-between text-[#0F172A] dark:text-white transition-all duration-200 focus-within:ring-2 focus-within:ring-[#0066FF] hover:border-[#0066FF]/50 cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed bg-gray-100 dark:bg-white/5' : ''}`}
        onClick={() => !disabled && setIsOpen(!isOpen)}
      >
        <span className={value ? 'text-[#0F172A] dark:text-white font-semibold line-clamp-1' : 'text-[#64748B] dark:text-gray-400 line-clamp-1'}>
          {value ? selectedOption.name : placeholder}
        </span>
        <i className={`bi bi-chevron-${isOpen ? 'up' : 'down'} text-[#64748B] shrink-0 transition-transform`}></i>
      </div>

      {isOpen && (
        <div className="absolute z-30 w-full mt-2 bg-white dark:bg-[#0A0A0A] border border-[#E3E9F1] dark:border-white/10 rounded-2xl shadow-2xl max-h-72 flex flex-col overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="p-3 border-b border-[#E3E9F1] dark:border-white/10 flex items-center bg-[#F8FAFC] dark:bg-white/5">
            <i className="bi bi-search text-[#64748B] ml-1 mr-2 shrink-0"></i>
            <input
              type="text"
              className="w-full bg-transparent border-none focus:outline-none text-sm text-[#0F172A] dark:text-white placeholder-[#64748B]"
              placeholder={searchFn ? "Type name or acronym (e.g. UNILAG, FUPRE)..." : "Search options..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              autoFocus
            />
            {searchQuery && (
              <button 
                type="button" 
                onClick={() => setSearchQuery('')}
                className="text-[#64748B] hover:text-[#0F172A] dark:hover:text-white text-xs px-1"
              >
                <i className="bi bi-x-circle-fill"></i>
              </button>
            )}
          </div>

          <div className="overflow-y-auto p-1.5 flex-1 space-y-1">
            {isSearching ? (
              <div className="p-4 text-sm text-[#64748B] dark:text-gray-400 text-center flex items-center justify-center gap-2">
                <i className="bi bi-arrow-repeat animate-spin text-[#0066FF]"></i>
                <span>Smart AI search & deduplication...</span>
              </div>
            ) : filteredOptions.length === 0 && !showAddNew ? (
              <div className="p-4 text-sm text-[#64748B] dark:text-gray-400 text-center">
                No matching options found.
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = value === opt.id;
                return (
                  <div
                    key={opt.id}
                    className={`p-3 text-sm rounded-xl cursor-pointer flex items-center justify-between transition-colors ${
                      isSelected 
                        ? 'bg-[#0066FF]/10 text-[#0066FF] dark:text-[#38BDF8] font-bold border border-[#0066FF]/20' 
                        : 'hover:bg-[#F1F5F9] dark:hover:bg-white/5 text-[#0F172A] dark:text-gray-200'
                    }`}
                    onClick={() => handleSelect(opt)}
                  >
                    <div className="flex flex-col min-w-0 pr-2">
                      <span className="line-clamp-1 font-medium">{opt.name}</span>
                      {opt.short_name && opt.short_name !== opt.name && (
                        <span className="text-[11px] text-[#64748B] dark:text-gray-400 uppercase tracking-wide">
                          {opt.short_name}
                        </span>
                      )}
                    </div>
                    {isSelected && <i className="bi bi-check-circle-fill text-[#0066FF] shrink-0 text-base"></i>}
                  </div>
                );
              })
            )}
            
            {showAddNew && (
              <div
                className={`p-3 text-sm rounded-xl flex items-center justify-center gap-2 bg-[#0066FF]/10 text-[#0066FF] dark:text-[#38BDF8] border border-dashed border-[#0066FF]/40 font-bold transition-all ${
                  isAddingNew ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer hover:bg-[#0066FF]/20'
                }`}
                onClick={!isAddingNew ? handleAddNew : undefined}
              >
                {isAddingNew ? (
                  <>
                    <i className="bi bi-arrow-repeat animate-spin"></i>
                    <span>Verifying & standardizing with AI...</span>
                  </>
                ) : (
                  <>
                    <i className="bi bi-plus-circle-fill"></i>
                    <span className="line-clamp-1">Add & Standardize "{searchQuery}"</span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface SchoolHierarchySelectorProps {
  schoolId: string;
  setSchoolId: (val: string) => void;
  collegeId: string;
  setCollegeId: (val: string) => void;
  departmentId: string;
  setDepartmentId: (val: string) => void;
  disabled?: boolean;
}

export const SchoolHierarchySelector: React.FC<SchoolHierarchySelectorProps> = ({
  schoolId, setSchoolId, collegeId, setCollegeId, departmentId, setDepartmentId, disabled
}) => {
  const [schools, setSchools] = useState<Array<{ id: string; name: string; short_name?: string }>>([]);
  const [colleges, setColleges] = useState<Array<{ id: string; name: string; school_id?: string }>>([]);
  const [departments, setDepartments] = useState<Array<{ id: string; name: string; college_id?: string }>>([]);
  const { settings: appSettings } = useAppSettings();

  // 1. Fetch live schools from Supabase
  useEffect(() => {
    let isMounted = true;
    void supabaseDataService.fetchSchools().then(res => {
      if (isMounted && res.length > 0) {
        setSchools(res);
      }
    });
    return () => { isMounted = false; };
  }, []);

  // 2. Fetch live colleges when schoolId changes
  useEffect(() => {
    let isMounted = true;
    if (schoolId) {
      void supabaseDataService.fetchColleges(schoolId).then(res => {
        if (isMounted) setColleges(res);
      });
    } else {
      setColleges([]);
    }
    return () => { isMounted = false; };
  }, [schoolId]);

  // 3. Fetch live departments when collegeId or schoolId changes
  useEffect(() => {
    let isMounted = true;
    if (schoolId) {
      void supabaseDataService.fetchDepartments(schoolId, collegeId || undefined).then(res => {
        if (isMounted) setDepartments(res);
      });
    } else {
      setDepartments([]);
    }
    return () => { isMounted = false; };
  }, [schoolId, collegeId]);

  // ── Smart AI Deduplication & Global University Search ───────────────────
  const searchGlobalUniversities = async (query: string): Promise<Option[]> => {
    const q = query.toLowerCase().trim();
    const localMatches = schools
      .filter(s => s.name.toLowerCase().includes(q) || (s.short_name && s.short_name.toLowerCase().includes(q)))
      .map(s => ({ id: s.id, name: s.name, short_name: s.short_name }));
    
    // Quick acronym / common name resolver before calling AI
    const acronyms: Record<string, { id: string; name: string }> = {
      'unilag': { id: 'unilag', name: 'University of Lagos' },
      'fupre': { id: 'fupre', name: 'Federal University of Petroleum Resources Effurun' },
      'uniben': { id: 'uniben', name: 'University of Benin' },
      'oau': { id: 'oau', name: 'Obafemi Awolowo University' },
      'ui': { id: 'ui', name: 'University of Ibadan' },
      'unn': { id: 'unn', name: 'University of Nigeria Nsukka' },
      'futa': { id: 'futa', name: 'Federal University of Technology Akure' },
      'futo': { id: 'futo', name: 'Federal University of Technology Owerri' },
      'abu': { id: 'abu', name: 'Ahmadu Bello University Zaria' },
      'lasu': { id: 'lasu', name: 'Lagos State University' },
      'covenant': { id: 'covenant', name: 'Covenant University' },
    };

    if (acronyms[q]) {
      const match = acronyms[q];
      const exists = localMatches.some(m => m.id === match.id);
      if (!exists) localMatches.unshift({ id: match.id, name: match.name, short_name: q.toUpperCase() });
    }

    try {
      const ai = createAvelutAI(appSettings, null);
      if (!ai) return localMatches;

      const existingNames = schools.map(s => s.name).join(', ');
      const prompt = `You are an academic database assistant for universities.
Existing schools in database: [${existingNames}].
User typed: "${query}".
Task:
1. If the input matches an existing university (including abbreviations like UNILAG, UNIBEN, FUPRE), identify the canonical standard name.
2. If it is a new Nigerian university, return its official full name.
Return ONLY a valid JSON array of up to 4 university names (e.g. ["University of Lagos", "Federal University of Petroleum Resources Effurun"]). No markdown blocks or commentary.`;

      const response = await ai.models.generateContent({
        model: 'qwen/qwen3.7-flash',
        contents: prompt,
        config: { maxOutputTokens: 200 }
      });

      const text = getResponseText(response).trim();
      let parsed: string[] = [];
      try {
        const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        parsed = JSON.parse(cleanText);
      } catch (err) {
        console.warn("[SchoolSelector] Parse error from AI school search:", text);
      }

      const globalMatches: Option[] = [];
      const seen = new Set(localMatches.map(l => l.name.toLowerCase()));
      
      if (Array.isArray(parsed)) {
        for (const name of parsed) {
          if (typeof name === 'string' && !seen.has(name.toLowerCase())) {
            seen.add(name.toLowerCase());
            globalMatches.push({ id: sanitizeId(name), name });
          }
        }
      }
      return [...localMatches, ...globalMatches];
    } catch (e) {
      console.warn('[SchoolSelector] AI search failed:', e);
      return localMatches;
    }
  };

  // ── Smart AI Duplicate Prevention for Faculties & Departments ──────────
  const deduplicateAndStandardize = async (
    inputName: string, 
    type: 'College/Faculty' | 'Department', 
    existingList: Option[]
  ): Promise<{ id: string; name: string; isDuplicate: boolean }> => {
    const cleanInput = inputName.trim().toLowerCase();
    
    // 1. Direct or fuzzy local match check
    for (const item of existingList) {
      const itemName = item.name.toLowerCase();
      if (itemName === cleanInput || itemName.includes(cleanInput) || cleanInput.includes(itemName)) {
        return { id: item.id, name: item.name, isDuplicate: true };
      }
    }

    const school = schools.find(s => s.id === schoolId);
    const schoolName = school?.name || 'the university';

    try {
      const ai = createAvelutAI(appSettings, null);
      if (!ai) {
        const fallbackName = type === 'College/Faculty' && !inputName.toLowerCase().startsWith('faculty') 
          ? `Faculty of ${inputName}` 
          : inputName;
        return { id: sanitizeId(fallbackName), name: fallbackName, isDuplicate: false };
      }

      const existingNamesStr = existingList.map(e => `"${e.name}" (id: "${e.id}")`).join(', ');
      const prompt = `You are an academic database deduplication engine for ${schoolName}.
Existing ${type}s: [${existingNamesStr}].
User entered: "${inputName}".
Task:
1. Check if "${inputName}" is a duplicate, synonym, or abbreviation of any existing item in the list above (e.g. "CS" or "Comp Sci" vs "Computer Science", "Pet Eng" vs "Petroleum Engineering").
2. If it is a duplicate, return: {"isDuplicate": true, "matchedId": "<existing_id>", "canonicalName": "<existing_name>"}
3. If it is genuinely a new ${type}, standardize its name (e.g. "Faculty of Engineering", "Department of Chemical Engineering") and return: {"isDuplicate": false, "canonicalName": "<Standardized Name>"}
Return ONLY valid JSON.`;

      const response = await ai.models.generateContent({
        model: 'qwen/qwen3.7-flash',
        contents: prompt,
        config: { maxOutputTokens: 250 }
      });

      const rawJson = getResponseText(response).replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(rawJson);

      if (parsed.isDuplicate && parsed.matchedId) {
        return { id: parsed.matchedId, name: parsed.canonicalName, isDuplicate: true };
      }

      const canonicalName = parsed.canonicalName || inputName;
      return { id: sanitizeId(canonicalName), name: canonicalName, isDuplicate: false };
    } catch (err) {
      console.warn('[SchoolSelector] Deduplication AI fallback:', err);
      const fallbackName = type === 'College/Faculty' && !inputName.toLowerCase().startsWith('faculty') && !inputName.toLowerCase().startsWith('college')
        ? `Faculty of ${inputName}` 
        : inputName;
      return { id: sanitizeId(fallbackName), name: fallbackName, isDuplicate: false };
    }
  };

  const handleAddCollege = async (name: string) => {
    if (!schoolId) return;
    const res = await deduplicateAndStandardize(name, 'College/Faculty', collegesOptions);
    if (!res.isDuplicate) {
      await supabaseDataService.upsertCollege({ id: res.id, name: res.name, school_id: schoolId });
      setColleges(prev => [...prev, { id: res.id, name: res.name, school_id: schoolId }]);
    }
    setCollegeId(res.id);
  };

  const handleAddDepartment = async (name: string) => {
    if (!schoolId) return;
    const res = await deduplicateAndStandardize(name, 'Department', departmentOptions);
    if (!res.isDuplicate) {
      await supabaseDataService.upsertDepartment({
        id: res.id,
        name: res.name,
        school_id: schoolId,
        college_id: collegeId || undefined
      });
      setDepartments(prev => [...prev, { id: res.id, name: res.name, college_id: collegeId }]);
    }
    setDepartmentId(res.id);
  };

  const schoolOptions = useMemo(() => schools.map(s => ({ id: s.id, name: s.name, short_name: s.short_name })), [schools]);
  
  const collegesOptions = useMemo(() => {
    const options: Option[] = colleges.map(c => ({ id: c.id, name: c.name }));
    const existingNames = new Set(options.map(o => o.name.toLowerCase()));
    
    // Inject Nigerian standard faculties if not present
    NIGERIAN_FACULTIES.forEach(fac => {
      if (!existingNames.has(fac.name.toLowerCase())) {
        options.push({ id: fac.id, name: fac.name });
      }
    });
    return options;
  }, [colleges]);

  const departmentOptions = useMemo(() => {
    const options: Option[] = departments.map(d => ({ id: d.id, name: d.name }));
    const existingNames = new Set(options.map(o => o.name.toLowerCase()));

    // Try to find the matching predefined faculty to inject standard departments
    const predefinedFaculty = NIGERIAN_FACULTIES.find(fac => fac.id === collegeId);
    if (predefinedFaculty) {
      predefinedFaculty.departments.forEach(deptName => {
        if (!existingNames.has(deptName.toLowerCase())) {
          options.push({ id: sanitizeId(deptName), name: deptName });
        }
      });
    }
    return options;
  }, [departments, collegeId]);

  const handleOptionSelected = async (level: 'school'|'college'|'department', opt: Option) => {
    const id = opt.id;
    const name = opt.name;

    if (level === 'school') {
      setSchoolId(id);
      const isLocal = schools.some(s => s.id === id);
      if (!isLocal) {
        await supabaseDataService.upsertSchool({ id, name, short_name: opt.short_name });
        setSchools(prev => [...prev, { id, name, short_name: opt.short_name }]);
      }
    } else if (level === 'college') {
      setCollegeId(id);
      if (schoolId) {
        const isLocal = colleges.some(c => c.id === id);
        if (!isLocal) {
          await supabaseDataService.upsertCollege({ id, name, school_id: schoolId });
          setColleges(prev => [...prev, { id, name, school_id: schoolId }]);
        }
      }
    } else if (level === 'department') {
      setDepartmentId(id);
      if (schoolId) {
        const isLocal = departments.some(d => d.id === id);
        if (!isLocal) {
          await supabaseDataService.upsertDepartment({ id, name, school_id: schoolId, college_id: collegeId });
          setDepartments(prev => [...prev, { id, name, college_id: collegeId }]);
        }
      }
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-left">
      <CustomSearchableSelect 
        stepNumber={1}
        label="University / Institution"
        options={schoolOptions}
        value={schoolId}
        onChange={(opt) => handleOptionSelected('school', opt)}
        placeholder="Select or search university..."
        disabled={disabled}
        searchFn={searchGlobalUniversities}
      />

      <CustomSearchableSelect 
        stepNumber={2}
        label="Faculty / College"
        options={collegesOptions}
        value={collegeId}
        onChange={(opt) => handleOptionSelected('college', opt)}
        placeholder="Select faculty..."
        disabled={disabled || !schoolId}
        onAddNew={handleAddCollege}
      />

      <CustomSearchableSelect 
        stepNumber={3}
        label="Department"
        options={departmentOptions}
        value={departmentId}
        onChange={(opt) => handleOptionSelected('department', opt)}
        placeholder="Select department..."
        disabled={disabled || !collegeId}
        onAddNew={handleAddDepartment}
      />
    </div>
  );
};
