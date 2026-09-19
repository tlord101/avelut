import { auth, db, equalTo, functions, get, getDownloadURL, orderByChild, query, ref as dbRef, ref as storageRef, storage, type AuthUser, update, uploadBytes, uploadBytesResumable } from '@/lib/backend';
import React, { useState, useEffect, useRef } from 'react';
import type { UserProfile } from '../types';
import { readCachedJson, writeCachedJson } from '../utils/cache';
import { useToast } from '../hooks/useToast';
import { Avatar } from './Avatar';
import { VerificationBadge } from './VerificationBadge';
import { SchoolHierarchySelector } from './SchoolHierarchySelector';


interface UserProfileProps {
  user: AuthUser | null;
  userProfile: UserProfile;
  onProfileUpdate: (updatedData: Partial<UserProfile>) => Promise<{ success: boolean; error?: string }>;
}

export const UserProfileScreen: React.FC<UserProfileProps> = ({ user, userProfile, onProfileUpdate }) => {
  const [isEditingName, setIsEditingName] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState(userProfile.display_name);
  const [bio, setBio] = useState(userProfile.bio || '');
  const [contactDetails, setContactDetails] = useState(userProfile.contact_details || '');
  const [privacySettings, setPrivacySettings] = useState(userProfile.privacy_settings || {
    public_contact: true,
    public_school: true,
    public_department: true,
    public_level: true
  });
  const [isSaving, setIsSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{type: 'avatar' | 'cover' | null, progress: number}>({type: null, progress: 0});
  
  const [departmentName, setDepartmentName] = useState<string>(() => {
    const cached = readCachedJson<any>(`avelut_dept_data_${userProfile.department_id}`, null);
    return cached?.name || cached?.department_name || (userProfile.department_id ? userProfile.department_id.replace(/_/g, ' ') : '');
  });
  const [isDepartmentLoading, setIsDepartmentLoading] = useState(() => !departmentName);
  
  const [levels, setLevels] = useState<string[]>(() => {
    const cached = readCachedJson<any>(`avelut_dept_data_${userProfile.department_id}`, null);
    if (!cached?.levels) return [];
    return Array.isArray(cached.levels) ? cached.levels : Object.keys(cached.levels);
  });
  const [isLevelsLoading, setIsLevelsLoading] = useState(() => levels.length === 0);
  
  const [isEditingAcademics, setIsEditingAcademics] = useState(false);
  const [editSchoolId, setEditSchoolId] = useState(userProfile.school_id || '');
  const [editCollegeId, setEditCollegeId] = useState(userProfile.college_id || '');
  const [editDepartmentId, setEditDepartmentId] = useState(userProfile.department_id || '');
  const [editLevel, setEditLevel] = useState(userProfile.level || '100');

  const startEditingAcademics = () => {
    setEditSchoolId(userProfile.school_id || '');
    setEditCollegeId(userProfile.college_id || '');
    setEditDepartmentId(userProfile.department_id || '');
    setEditLevel(userProfile.level || '100');
    setIsEditingAcademics(true);
  };

  const [referralCodeInput, setReferralCodeInput] = useState('');
  const [isSubmittingReferral, setIsSubmittingReferral] = useState(false);

  const { addToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user && !userProfile.referral_code) {
      const newCode = user.uid.substring(0, 8).toUpperCase();
      onProfileUpdate({ referral_code: newCode, referrals_count: 0 });
    }
  }, [user, userProfile.referral_code, onProfileUpdate]);

  useEffect(() => {
    const fetchDepartmentData = async () => {
      if (!userProfile.school_id || !userProfile.college_id || !userProfile.department_id) {
        setDepartmentName('Not Set');
        setIsDepartmentLoading(false);
        setIsLevelsLoading(false);
        return;
      }
      if (!departmentName) setIsDepartmentLoading(true);
      if (levels.length === 0) setIsLevelsLoading(true);
      try {
        const snapshot = await get(dbRef(db, `schools_data/${userProfile.school_id}/colleges/${userProfile.college_id}/departments/${userProfile.department_id}`));
        const departmentData = snapshot.val();

        if (departmentData) {
          setDepartmentName(departmentData.name || departmentData.department_name || userProfile.department_id.replace(/_/g, ' '));
          
          let fetchedLevels: string[] = [];
          if (Array.isArray(departmentData.levels)) {
              fetchedLevels = departmentData.levels;
          } else if (departmentData.levels && typeof departmentData.levels === 'object') {
              fetchedLevels = Object.keys(departmentData.levels);
          }
          setLevels(fetchedLevels);
        } else {
          setDepartmentName(userProfile.department_id.replace(/_/g, ' '));
          setLevels([]);
        }
      } catch (error) {
        console.error("Failed to fetch department data:", error);
        setDepartmentName(userProfile.department_id.replace(/_/g, ' '));
        setLevels([]);
        addToast("Could not load department details.", "error");
      } finally {
        setIsDepartmentLoading(false);
        setIsLevelsLoading(false);
      }
    };

    fetchDepartmentData();
  }, [userProfile.school_id, userProfile.college_id, userProfile.department_id, addToast]);

  const handleSaveName = async () => {
    if (newDisplayName.trim() === '' || newDisplayName.trim() === userProfile.display_name) {
      setIsEditingName(false);
      setNewDisplayName(userProfile.display_name);
      return;
    }
    setIsSaving(true);
    const result = await onProfileUpdate({ display_name: newDisplayName.trim() });
    if (result.success) {
      setIsEditingName(false);
      addToast('Display name updated successfully!', 'success');
    } else {
      addToast(result.error || "Failed to save new display name.", 'error');
    }
    setIsSaving(false);
  };

  const handleSaveBioAndContact = async () => {
    setIsSaving(true);
    const result = await onProfileUpdate({ bio, contact_details: contactDetails });
    if (result.success) {
      addToast('Profile info updated successfully!', 'success');
    } else {
      addToast(result.error || "Failed to update profile info.", 'error');
    }
    setIsSaving(false);
  };

  const handleTogglePrivacy = async (key: keyof typeof privacySettings) => {
    const newSettings = { ...privacySettings, [key]: !privacySettings[key] };
    setPrivacySettings(newSettings);
    setIsSaving(true);
    const result = await onProfileUpdate({ privacy_settings: newSettings });
    if (result.success) {
      addToast('Privacy settings updated.', 'success');
    } else {
      addToast('Failed to update privacy settings.', 'error');
      setPrivacySettings(privacySettings); // revert
    }
    setIsSaving(false);
  };

  const handleCancelEdit = () => {
    setIsEditingName(false);
    setNewDisplayName(userProfile.display_name);
  };

  const handleSubmitReferral = async () => {
    if (!referralCodeInput.trim()) return addToast('Please enter a referral code.', 'error');
    if (referralCodeInput.trim().toUpperCase() === userProfile.referral_code) return addToast('You cannot use your own referral code.', 'error');
    if (userProfile.referred_by) return addToast('You have already used a referral code.', 'error');

    setIsSubmittingReferral(true);
    try {
      const usersRef = dbRef(db, 'users');
      const q = query(usersRef, orderByChild('referral_code'), equalTo(referralCodeInput.trim().toUpperCase()));
      const snapshot = await get(q);

      if (snapshot.exists()) {
        const referrerData = snapshot.val();
        const referrerUid = Object.keys(referrerData)[0];
        const referrerProfile = referrerData[referrerUid];

        const updates: Record<string, any> = {};
        
        // Update current user
        updates[`users/${userProfile.uid}/referred_by`] = referrerUid;
        updates[`users/${userProfile.uid}/ai_credits_balance`] = (userProfile.ai_credits_balance || 0) + 500;
        
        // Update referrer
        updates[`users/${referrerUid}/referrals_count`] = (referrerProfile.referrals_count || 0) + 1;
        updates[`users/${referrerUid}/ai_credits_balance`] = (referrerProfile.ai_credits_balance || 0) + 500;

        await update(dbRef(db), updates);
        
        addToast('Referral successful! You both received 500 AI credits.', 'success');
        onProfileUpdate({ referred_by: referrerUid, ai_credits_balance: (userProfile.ai_credits_balance || 0) + 500 });
      } else {
        addToast('Invalid referral code.', 'error');
      }
    } catch (error) {
      console.error("Referral error", error);
      addToast('An error occurred. Please try again.', 'error');
    }
    setIsSubmittingReferral(false);
  };

  const handleLevelChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLevel = e.target.value;
    setIsSaving(true);
    const result = await onProfileUpdate({ level: newLevel });
    if (result.success) {
      addToast('Level updated successfully!', 'success');
    } else {
      addToast(result.error || "Failed to save new level.", 'error');
      e.target.value = userProfile.level || '';
    }
    setIsSaving(false);
  };

  const handleSaveAcademics = async () => {
      setIsSaving(true);
      const result = await onProfileUpdate({
          school_id: editSchoolId,
          college_id: editCollegeId,
          department_id: editDepartmentId,
          level: editLevel
      });
      if (result.success) {
          addToast('Academic details updated successfully!', 'success');
          setIsEditingAcademics(false);
      } else {
          addToast(result.error || "Failed to save academic details.", 'error');
      }
      setIsSaving(false);
  };

  const compressImage = (blob: Blob, maxWidth: number, maxHeight: number, quality: number = 0.8): Promise<Blob> => {
      return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(blob);
          reader.onload = event => {
              const img = new Image();
              img.src = event.target?.result as string;
              img.onload = () => {
                  const canvas = document.createElement('canvas');
                  let width = img.width;
                  let height = img.height;

                  if (width > height) {
                      if (width > maxWidth) {
                          height = Math.round((height *= maxWidth / width));
                          width = maxWidth;
                      }
                  } else {
                      if (height > maxHeight) {
                          width = Math.round((width *= maxHeight / height));
                          height = maxHeight;
                      }
                  }
                  
                  canvas.width = width;
                  canvas.height = height;
                  const ctx = canvas.getContext('2d');
                  ctx?.drawImage(img, 0, 0, width, height);
                  
                  canvas.toBlob((blobResult) => {
                      if (!blobResult) {
                          reject(new Error("Canvas to Blob failed"));
                          return;
                      }
                      resolve(blobResult);
                  }, 'image/jpeg', quality);
              };
              img.onerror = (e) => reject(e);
          };
          reader.onerror = (e) => reject(e);
      });
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>, type: 'avatar' | 'cover') => {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    if (file.size > 5 * 1024 * 1024) {
        addToast("File is too large. Please select an image under 5MB.", "error");
        return;
    }

    if (event.target) event.target.value = '';

    setIsSaving(true);
    setUploadProgress({ type, progress: 0 });

    let simulatedProgress = 0;
    const progressInterval = setInterval(() => {
        simulatedProgress = Math.min(simulatedProgress + 8, 85);
        setUploadProgress(prev => prev.type === type ? { type, progress: simulatedProgress } : prev);
    }, 300);

    const path = type === 'avatar'
        ? `profile-pictures/${user.uid}/profile.jpg`
        : `cover-photos/${user.uid}/cover.jpg`;
    const sRef = storageRef(storage, path);
    
    try {
        const compressedFile = await compressImage(
            file, 
            type === 'avatar' ? 800 : 1600, 
            type === 'avatar' ? 800 : 1600, 
            0.8 
        );
        
        const { supabaseStorageService } = await import('../services/supabaseStorageService');
        const uploadResult = await supabaseStorageService.uploadAvatar(user.uid, compressedFile);

        clearInterval(progressInterval);
        setUploadProgress({ type, progress: 100 });

        if (uploadResult.error || !uploadResult.url) {
            throw new Error(uploadResult.error || 'Upload failed');
        }

        const cacheBustURL = `${uploadResult.url}?t=${new Date().getTime()}`;
        const updateData = type === 'avatar' ? { photo_url: cacheBustURL } : { cover_photo: cacheBustURL };
        const updateResult = await onProfileUpdate(updateData);
        
        if (updateResult.success) {
            addToast(`${type === 'avatar' ? 'Profile' : 'Cover'} picture updated!`, "success");
        } else {
            addToast(updateResult.error || `Could not update ${type} picture.`, "error");
        }
    } catch (error: any) {
        clearInterval(progressInterval);
        console.error(`Failed to upload ${type}:`, error);
        addToast(`Could not update ${type === 'avatar' ? 'profile' : 'cover'} picture. Check your connection.`, "error");
    }

    setIsSaving(false);
    setUploadProgress({ type: null, progress: 0 });
  };

  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-black pb-20 sm:pb-8 animate-fade-in text-slate-900 dark:text-slate-100">
        {/* Cover Photo - Compact Banner */}
        <div className="relative w-full h-28 sm:h-36 bg-gradient-to-r from-slate-800 to-slate-900 shrink-0 overflow-hidden border-b border-slate-200 dark:border-white/10">
            {userProfile.cover_photo && (
                <img src={userProfile.cover_photo} alt="Cover" className="w-full h-full object-cover" />
            )}
            
            <input type="file" ref={coverInputRef} hidden accept="image/*" onChange={(e) => handleImageUpload(e, 'cover')} />
            
            {uploadProgress.type === 'cover' && (
                <div className="absolute inset-0 z-10 bg-black/50 flex items-center justify-center backdrop-blur-sm transition-all duration-200">
                    <div className="w-56 bg-white dark:bg-[#0A0A0A] p-3 rounded-xl border border-slate-200 dark:border-white/10 flex flex-col items-center gap-2">
                        <i className="bi bi-cloud-arrow-up-fill text-xl text-[#0066FF] animate-bounce"></i>
                        <div className="w-full bg-slate-200 dark:bg-white/10 rounded-full h-1.5 overflow-hidden">
                            <div className="bg-[#0066FF] h-1.5 rounded-full transition-all duration-200" style={{ width: `${Math.max(5, uploadProgress.progress)}%` }}></div>
                        </div>
                        <p className="text-slate-700 dark:text-slate-300 text-[10px] font-bold uppercase tracking-wider">Uploading... {Math.max(5, Math.round(uploadProgress.progress))}%</p>
                    </div>
                </div>
            )}

            <button
                onClick={() => coverInputRef.current?.click()}
                disabled={isSaving}
                className="absolute bottom-2.5 right-2.5 sm:bottom-3 sm:right-3 z-20 bg-white/90 dark:bg-black/80 backdrop-blur-md text-slate-800 dark:text-slate-200 px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-white dark:hover:bg-slate-900 transition flex items-center gap-1.5 border border-slate-200 dark:border-white/10 cursor-pointer"
            >
                <i className="bi bi-camera text-slate-600 dark:text-slate-300 text-xs"></i>
                <span>{userProfile.cover_photo ? 'Change Cover' : 'Add Cover'}</span>
            </button>
        </div>

        {/* Profile Info Header */}
        <div className="relative px-4 sm:px-6 max-w-4xl mx-auto w-full -mt-10 sm:-mt-12 z-10">
            <div className="flex flex-col sm:flex-row items-center sm:items-end gap-4 mb-4">
                {/* Avatar */}
                <div className="relative group shrink-0">
                    <div className="rounded-full p-1 bg-white dark:bg-black border border-slate-200 dark:border-white/10">
                        <Avatar className="w-20 h-20 sm:w-24 sm:h-24 rounded-full object-cover" photo_url={userProfile.photo_url} display_name={userProfile.display_name || 'User'} />
                    </div>
                    
                    <input type="file" ref={fileInputRef} hidden accept="image/*" onChange={(e) => handleImageUpload(e, 'avatar')} />

                    {uploadProgress.type === 'avatar' && (
                        <div className="absolute inset-0 z-20 bg-black/60 rounded-full flex items-center justify-center flex-col gap-1 backdrop-blur-sm">
                            <span className="text-white text-[11px] font-bold">{Math.round(uploadProgress.progress)}%</span>
                        </div>
                    )}

                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isSaving}
                        className="absolute bottom-0 right-0 bg-[#0066FF] text-white w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center hover:bg-[#0055D4] transition border-2 border-white dark:border-black cursor-pointer"
                        title="Upload Avatar"
                    >
                        <i className="bi bi-camera text-xs font-bold"></i>
                    </button>
                </div>

                {/* Name & Quick Info */}
                <div className="flex-1 text-center sm:text-left">
                    {isEditingName ? (
                        <div className="flex flex-col sm:flex-row items-center gap-2">
                            <input
                                type="text"
                                value={newDisplayName}
                                onChange={(e) => setNewDisplayName(e.target.value)}
                                className="w-full sm:w-60 bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-white/10 rounded-xl py-1.5 px-3 text-slate-900 dark:text-white font-bold text-sm focus:ring-1 focus:ring-[#0066FF] focus:outline-none"
                                disabled={isSaving}
                            />
                            <div className="flex gap-1.5">
                                <button onClick={handleSaveName} disabled={isSaving || newDisplayName.trim() === ''} className="px-3 py-1.5 bg-[#0066FF] text-white rounded-xl text-xs font-bold hover:bg-[#0055D4] transition disabled:opacity-50 cursor-pointer">
                                    Save
                                </button>
                                <button onClick={handleCancelEdit} disabled={isSaving} className="px-3 py-1.5 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-200 dark:hover:bg-white/10 transition cursor-pointer">
                                    Cancel
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-center sm:justify-start">
                            <div className="flex items-center gap-2 justify-center sm:justify-start">
                                <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                                    {userProfile.display_name}
                                </h1>
                                <VerificationBadge status={userProfile.subscription_status} />
                            </div>
                            <button onClick={() => setIsEditingName(true)} className="inline-flex items-center gap-1 self-center sm:self-auto px-2.5 py-1 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-semibold hover:bg-slate-200 dark:hover:bg-white/10 transition cursor-pointer">
                                <i className="bi bi-pencil text-[11px]"></i>
                                <span>Edit</span>
                            </button>
                        </div>
                    )}
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">{user?.email}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Left Column: Academic Profile & About */}
                <div className="lg:col-span-2 space-y-4">
                    {/* Academic Profile Card */}
                    <div className="bg-white dark:bg-[#0A0A0A] p-4 sm:p-5 rounded-2xl border border-slate-200/80 dark:border-white/10">
                        <div className="flex justify-between items-center mb-3">
                            <div className="flex items-center gap-2">
                                <i className="bi bi-mortarboard text-[#0066FF] text-base"></i>
                                <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">Academic Details</h3>
                            </div>
                            {!isEditingAcademics ? (
                                <button
                                    onClick={startEditingAcademics}
                                    className="px-3 py-1 rounded-lg text-xs font-bold text-[#0066FF] hover:bg-blue-50 dark:hover:bg-blue-950/40 border border-blue-200 dark:border-blue-900/50 transition cursor-pointer flex items-center gap-1"
                                >
                                    <i className="bi bi-pencil-square text-xs"></i>
                                    <span>Edit Academic Info</span>
                                </button>
                            ) : (
                                <button
                                    onClick={() => setIsEditingAcademics(false)}
                                    className="px-3 py-1 rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 border border-slate-200 dark:border-white/10 transition cursor-pointer"
                                >
                                    Cancel
                                </button>
                            )}
                        </div>

                        {isEditingAcademics ? (
                            <div className="space-y-4 pt-1">
                                <SchoolHierarchySelector
                                    schoolId={editSchoolId}
                                    setSchoolId={setEditSchoolId}
                                    collegeId={editCollegeId}
                                    setCollegeId={setEditCollegeId}
                                    departmentId={editDepartmentId}
                                    setDepartmentId={setEditDepartmentId}
                                />

                                {/* Academic Level Picker */}
                                <div className="space-y-1.5 pt-1">
                                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                                        <i className="bi bi-layers text-[#0066FF]"></i>
                                        <span>Select Academic Level</span>
                                    </label>
                                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                                        {['100', '200', '300', '400', '500', '600', 'Postgraduate'].map(lvl => (
                                            <button
                                                key={lvl}
                                                type="button"
                                                onClick={() => setEditLevel(lvl)}
                                                className={`py-2 px-2 rounded-xl text-xs font-bold transition border cursor-pointer text-center ${
                                                    editLevel === lvl
                                                        ? 'bg-[#0066FF] text-white border-[#0066FF]'
                                                        : 'bg-slate-50 dark:bg-white/[0.04] text-slate-700 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:border-slate-300'
                                                }`}
                                            >
                                                {lvl === 'Postgraduate' ? 'Postgraduate' : `${lvl} Level`}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="flex gap-2 justify-end pt-2 border-t border-slate-100 dark:border-white/5">
                                    <button
                                        type="button"
                                        onClick={() => setIsEditingAcademics(false)}
                                        disabled={isSaving}
                                        className="px-3.5 py-1.5 bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-200 dark:hover:bg-white/10 transition cursor-pointer"
                                    >
                                        Cancel
                                    </button>
                                    <button 
                                        type="button"
                                        onClick={handleSaveAcademics}
                                        disabled={isSaving || !editSchoolId || !editCollegeId || !editDepartmentId}
                                        className="px-4 py-1.5 bg-[#0066FF] hover:bg-[#0055D4] text-white rounded-xl text-xs font-bold transition disabled:opacity-50 cursor-pointer"
                                    >
                                        {isSaving ? 'Saving...' : 'Save All Academic Details'}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                <div className="p-3 bg-slate-50/80 dark:bg-white/[0.02] rounded-xl border border-slate-200/60 dark:border-white/5">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Institution / School</p>
                                    <p className="text-slate-900 dark:text-white font-bold text-xs mt-0.5 capitalize">
                                        {userProfile.school_id ? userProfile.school_id.replace(/_/g, ' ') : 'Not set'}
                                    </p>
                                </div>

                                <div className="p-3 bg-slate-50/80 dark:bg-white/[0.02] rounded-xl border border-slate-200/60 dark:border-white/5">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Faculty / College</p>
                                    <p className="text-slate-900 dark:text-white font-bold text-xs mt-0.5 capitalize">
                                        {userProfile.college_id ? userProfile.college_id.replace(/_/g, ' ') : 'Not set'}
                                    </p>
                                </div>

                                <div className="p-3 bg-slate-50/80 dark:bg-white/[0.02] rounded-xl border border-slate-200/60 dark:border-white/5">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Department</p>
                                    <p className="text-slate-900 dark:text-white font-bold text-xs mt-0.5 capitalize">
                                        {isDepartmentLoading ? 'Loading...' : (departmentName || (userProfile.department_id ? userProfile.department_id.replace(/_/g, ' ') : 'Not set'))}
                                    </p>
                                </div>

                                <div className="p-3 bg-slate-50/80 dark:bg-white/[0.02] rounded-xl border border-slate-200/60 dark:border-white/5">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Academic Level</p>
                                    <p className="text-slate-900 dark:text-white font-bold text-xs mt-0.5">
                                        {userProfile.level ? `${userProfile.level} Level` : 'Not set'}
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* About & Contact Card */}
                    <div className="bg-white dark:bg-[#0A0A0A] p-4 sm:p-5 rounded-2xl border border-slate-200/80 dark:border-white/10 space-y-4">
                        <div>
                            <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">About Me</h3>
                            <textarea
                                value={bio}
                                onChange={(e) => setBio(e.target.value)}
                                placeholder="Tell others about your study habits, academic goals, or interests..."
                                className="w-full bg-slate-50/80 dark:bg-white/[0.03] border border-slate-200/80 dark:border-white/10 rounded-xl p-3 text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0066FF] min-h-[90px] resize-none"
                                disabled={isSaving}
                            />
                        </div>

                        <div>
                            <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">Contact Information</h3>
                            <textarea
                                value={contactDetails}
                                onChange={(e) => setContactDetails(e.target.value)}
                                placeholder="Social links or study group contact handles..."
                                className="w-full bg-slate-50/80 dark:bg-white/[0.03] border border-slate-200/80 dark:border-white/10 rounded-xl p-3 text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0066FF] min-h-[75px] resize-none"
                                disabled={isSaving}
                            />
                        </div>

                        <div className="flex justify-end pt-1">
                            <button onClick={handleSaveBioAndContact} disabled={isSaving} className="px-4 py-2 bg-[#0066FF] hover:bg-[#0055D4] text-white rounded-xl text-xs font-bold transition disabled:opacity-50 cursor-pointer">
                                {isSaving ? 'Saving...' : 'Save Profile Info'}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Right Column: Privacy & Referral Settings */}
                <div className="space-y-4">
                    {/* Privacy Settings Card */}
                    <div className="bg-white dark:bg-[#0A0A0A] p-4 sm:p-5 rounded-2xl border border-slate-200/80 dark:border-white/10">
                        <div className="flex items-center gap-2 mb-3">
                            <i className="bi bi-shield-check text-[#0066FF] text-base"></i>
                            <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">Privacy & Visibility</h3>
                        </div>

                        <div className="space-y-2.5">
                            <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-white/5">
                                <div>
                                    <p className="text-xs font-bold text-slate-900 dark:text-white">Contact Details</p>
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400">Visible to students</p>
                                </div>
                                <button
                                    onClick={() => handleTogglePrivacy('public_contact')}
                                    disabled={isSaving}
                                    className={`w-10 h-5.5 rounded-full transition-colors relative cursor-pointer ${privacySettings.public_contact ? 'bg-[#0066FF]' : 'bg-slate-300 dark:bg-slate-700'}`}
                                >
                                    <span className={`absolute top-0.5 left-0.5 bg-white w-4.5 h-4.5 rounded-full transition-transform ${privacySettings.public_contact ? 'translate-x-4.5' : 'translate-x-0'}`} />
                                </button>
                            </div>

                            <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-white/5">
                                <div>
                                    <p className="text-xs font-bold text-slate-900 dark:text-white">School Info</p>
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400">Show institution</p>
                                </div>
                                <button
                                    onClick={() => handleTogglePrivacy('public_school')}
                                    disabled={isSaving}
                                    className={`w-10 h-5.5 rounded-full transition-colors relative cursor-pointer ${privacySettings.public_school ? 'bg-[#0066FF]' : 'bg-slate-300 dark:bg-slate-700'}`}
                                >
                                    <span className={`absolute top-0.5 left-0.5 bg-white w-4.5 h-4.5 rounded-full transition-transform ${privacySettings.public_school ? 'translate-x-4.5' : 'translate-x-0'}`} />
                                </button>
                            </div>

                            <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-white/5">
                                <div>
                                    <p className="text-xs font-bold text-slate-900 dark:text-white">Department</p>
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400">Show department</p>
                                </div>
                                <button
                                    onClick={() => handleTogglePrivacy('public_department')}
                                    disabled={isSaving}
                                    className={`w-10 h-5.5 rounded-full transition-colors relative cursor-pointer ${privacySettings.public_department ? 'bg-[#0066FF]' : 'bg-slate-300 dark:bg-slate-700'}`}
                                >
                                    <span className={`absolute top-0.5 left-0.5 bg-white w-4.5 h-4.5 rounded-full transition-transform ${privacySettings.public_department ? 'translate-x-4.5' : 'translate-x-0'}`} />
                                </button>
                            </div>

                            <div className="flex items-center justify-between py-2">
                                <div>
                                    <p className="text-xs font-bold text-slate-900 dark:text-white">Academic Level</p>
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400">Show level</p>
                                </div>
                                <button
                                    onClick={() => handleTogglePrivacy('public_level')}
                                    disabled={isSaving}
                                    className={`w-10 h-5.5 rounded-full transition-colors relative cursor-pointer ${privacySettings.public_level ? 'bg-[#0066FF]' : 'bg-slate-300 dark:bg-slate-700'}`}
                                >
                                    <span className={`absolute top-0.5 left-0.5 bg-white w-4.5 h-4.5 rounded-full transition-transform ${privacySettings.public_level ? 'translate-x-4.5' : 'translate-x-0'}`} />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Referrals & Rewards Card */}
                    <div className="bg-white dark:bg-[#0A0A0A] p-4 sm:p-5 rounded-2xl border border-slate-200/80 dark:border-white/10 space-y-3">
                        <div className="flex items-center gap-2 mb-1">
                            <i className="bi bi-gift text-[#0066FF] text-base"></i>
                            <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">Referrals & Rewards</h3>
                        </div>

                        <div className="bg-slate-50 dark:bg-white/[0.03] p-3 rounded-xl border border-slate-200/60 dark:border-white/5 text-center">
                            <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Your Referral Code</p>
                            <div className="flex items-center justify-center gap-2 mt-1">
                                <span className="text-xl font-black text-[#0066FF] tracking-widest">{userProfile.referral_code || '---'}</span>
                                {userProfile.referral_code && (
                                    <button onClick={() => {
                                        navigator.clipboard.writeText(userProfile.referral_code!);
                                        addToast('Referral code copied!', 'success');
                                    }} className="p-1.5 bg-blue-50 dark:bg-blue-950/40 text-[#0066FF] rounded-lg hover:bg-blue-100 transition cursor-pointer">
                                        <i className="bi bi-clipboard text-xs"></i>
                                    </button>
                                )}
                            </div>
                            <p className="text-[11px] text-slate-500 mt-1 font-medium">Referred friends: {userProfile.referrals_count || 0}</p>
                        </div>

                        {!userProfile.referred_by && (
                            <div className="pt-2 border-t border-slate-100 dark:border-white/5">
                                <p className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">Claim a Friend's Referral</p>
                                <div className="flex gap-1.5">
                                    <input
                                        type="text"
                                        value={referralCodeInput}
                                        onChange={(e) => setReferralCodeInput(e.target.value)}
                                        placeholder="Enter code"
                                        className="flex-1 bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#0066FF] uppercase"
                                    />
                                    <button
                                        onClick={handleSubmitReferral}
                                        disabled={isSubmittingReferral || !referralCodeInput.trim()}
                                        className="px-3 py-1.5 bg-[#0066FF] text-white rounded-xl text-xs font-bold hover:bg-[#0055D4] transition disabled:opacity-50 cursor-pointer"
                                    >
                                        {isSubmittingReferral ? '...' : 'Claim'}
                                    </button>
                                </div>
                            </div>
                        )}
                        {userProfile.referred_by && (
                            <div className="pt-2 border-t border-slate-100 dark:border-white/5 text-center">
                                <p className="text-xs font-bold text-emerald-500 flex items-center justify-center gap-1">
                                    <i className="bi bi-check-circle-fill"></i>
                                    <span>Referral reward claimed (+500 credits)</span>
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    </div>
  );
};
