import { supabase, supabaseAdmin, isSupabaseConfigured } from '../lib/supabaseClient';
import type { UserProfile, Course, Topic } from '../types';

const normalizeLevel = (val?: string): string => {
  if (!val) return '';
  return val.toLowerCase().replace(/\s+/g, '').replace(/level/g, '').replace(/lvl/g, '');
};

const normalizeDept = (val?: string): string => {
  if (!val) return '';
  return val.toLowerCase().trim().replace(/[\s-]+/g, '_').replace(/[^\w_]/g, '').replace(/_+$/, '');
};

export interface UserSubscriptionInfo {
  plan_type: 'free' | 'weekly' | 'monthly' | 'semester';
  status: 'active' | 'expired' | 'cancelled';
  daily_topic_allowance: number;
  topics_used_today: number;
  unlocked_topics_pack: number;
  last_reset_date: string;
  expires_at?: string | null;
}

class SupabaseDataService {
  private static instance: SupabaseDataService;

  private constructor() {}

  public static getInstance(): SupabaseDataService {
    if (!SupabaseDataService.instance) {
      SupabaseDataService.instance = new SupabaseDataService();
    }
    return SupabaseDataService.instance;
  }

  // ── Profile Operations ─────────────────────────────────────────────────────

  public async fetchUserProfile(userId: string): Promise<UserProfile | null> {
    if (!isSupabaseConfigured || !userId) return null;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      return {
        uid: data.id,
        display_name: data.full_name || data.username || 'User',
        photo_url: data.avatar_url || '',
        email: data.email || '',
        school_id: data.school_id,
        department_id: data.department_id,
        level: data.level,
        xp: data.xp || 0,
        current_streak: data.streak || 0,
        last_activity_date: Date.now(),
        notifications_enabled: true,
        ai_credits_balance: data.ai_credits ?? 50,
        is_admin: data.is_admin || false,
        subscription_status: data.subscription_status || (data.is_paid_subscriber ? 'premium' : 'free'),
      };
    } catch (err) {
      console.warn('[SupabaseDataService] Exception fetching profile:', err);
      return null;
    }
  }

  public async upsertUserProfile(profile: Partial<UserProfile> & { uid: string }): Promise<void> {
    if (!isSupabaseConfigured || !profile.uid) return;
    try {
      const { error } = await supabase
        .from('profiles')
        .upsert({
          id: profile.uid,
          full_name: profile.display_name,
          avatar_url: profile.photo_url,
          email: profile.email,
          school_id: profile.school_id,
          department_id: profile.department_id,
          level: profile.level,
          xp: profile.xp,
          streak: profile.current_streak,
          ai_credits: profile.ai_credits_balance,
          is_admin: profile.is_admin,
          is_paid_subscriber: profile.subscription_status && profile.subscription_status !== 'none' && profile.subscription_status !== 'free',
          updated_at: new Date().toISOString(),
        });
      if (error) {
        console.error('[SupabaseDataService] Error saving profile:', error);
      }
    } catch (err) {
      console.error('[SupabaseDataService] Exception saving profile:', err);
    }
  }

  // ── Academic Hierarchy (Schools, Colleges, Departments) ───────────────────

  public async fetchSchools(): Promise<Array<{ id: string; name: string; short_name?: string }>> {
    if (!isSupabaseConfigured) return [];
    try {
      const { data, error } = await supabase
        .from('schools')
        .select('id, name, short_name')
        .order('name', { ascending: true });
      if (error) {
        console.warn('[SupabaseDataService] Error fetching schools:', error);
        return [];
      }
      return data || [];
    } catch (err) {
      console.warn('[SupabaseDataService] Exception fetching schools:', err);
      return [];
    }
  }

  public async fetchColleges(schoolId?: string): Promise<Array<{ id: string; name: string; school_id?: string }>> {
    if (!isSupabaseConfigured) return [];
    try {
      let query = supabase.from('colleges').select('id, name, school_id').order('name', { ascending: true });
      if (schoolId) query = query.eq('school_id', schoolId);
      const { data, error } = await query;
      if (error) {
        console.warn('[SupabaseDataService] Error fetching colleges:', error);
        return [];
      }
      return data || [];
    } catch (err) {
      console.warn('[SupabaseDataService] Exception fetching colleges:', err);
      return [];
    }
  }

  public async fetchDepartments(schoolId?: string, collegeId?: string): Promise<Array<{ id: string; name: string; college_id?: string; school_id?: string }>> {
    if (!isSupabaseConfigured) return [];
    try {
      let query = supabase.from('departments').select('id, name, college_id, school_id').order('name', { ascending: true });
      if (schoolId) query = query.eq('school_id', schoolId);
      if (collegeId) query = query.eq('college_id', collegeId);
      const { data, error } = await query;
      if (error) {
        console.warn('[SupabaseDataService] Error fetching departments:', error);
        return [];
      }
      return data || [];
    } catch (err) {
      console.warn('[SupabaseDataService] Exception fetching departments:', err);
      return [];
    }
  }

  public async upsertSchool(school: { id: string; name: string; short_name?: string }): Promise<void> {
    if (!isSupabaseConfigured || !school.id) return;
    try {
      const client = supabaseAdmin || supabase;
      await client.from('schools').upsert(school);
    } catch (err) {
      console.error('[SupabaseDataService] Error upserting school:', err);
    }
  }

  public async upsertCollege(college: { id: string; name: string; school_id: string }): Promise<void> {
    if (!isSupabaseConfigured || !college.id) return;
    try {
      const client = supabaseAdmin || supabase;
      await client.from('colleges').upsert(college);
    } catch (err) {
      console.error('[SupabaseDataService] Error upserting college:', err);
    }
  }

  public async upsertDepartment(department: { id: string; name: string; school_id?: string; college_id?: string }): Promise<void> {
    if (!isSupabaseConfigured || !department.id) return;
    try {
      const client = supabaseAdmin || supabase;
      await client.from('departments').upsert(department);
    } catch (err) {
      console.error('[SupabaseDataService] Error upserting department:', err);
    }
  }

  // ── Academic Courses & Topics ──────────────────────────────────────────────

  public async fetchCourses(departmentId?: string, level?: string): Promise<Course[]> {
    if (!isSupabaseConfigured) return [];
    try {
      const { data, error } = await supabase
        .from('courses')
        .select('*, topics(*)');

      if (error) {
        console.warn('[SupabaseDataService] Error fetching courses:', error);
        return [];
      }

      let filtered = data || [];
      if (departmentId) {
        const targetDeptNorm = normalizeDept(departmentId);
        filtered = filtered.filter((c: any) => {
          if (!c.department_id) return true;
          const courseDeptNorm = normalizeDept(c.department_id);
          return courseDeptNorm === targetDeptNorm || c.department_id === departmentId;
        });
      }

      if (level) {
        const targetLevelNorm = normalizeLevel(level);
        filtered = filtered.filter((c: any) => {
          if (!c.level) return true;
          return normalizeLevel(c.level) === targetLevelNorm;
        });
      }

      return filtered.map((c: any) => ({
        course_id: c.id,
        course_name: c.title || c.code,
        course_code: c.code,
        level: c.level || '100lvl',
        semester: c.semester === 2 ? 'second' : 'first',
        description: c.description || '',
        textbook_url: c.textbook_url || '',
        department_id: c.department_id,
        school_id: c.school_id,
        topics: ((c.topics || []) as any[]).map((t: any) => ({
          topic_id: t.id,
          topic_name: t.topic_name,
          topic_order: t.topic_order,
          topic_context: t.overview_json?.overview || t.overview_json?.topic_context || '',
          start_point: t.overview_json?.start_point || '',
          end_point: t.overview_json?.end_point || '',
          is_complete: false,
        })),
      })) as Course[];
    } catch (err) {
      console.warn('[SupabaseDataService] Exception fetching courses:', err);
      return [];
    }
  }

  public async upsertCourse(course: {
    course_id: string;
    course_code?: string;
    course_name?: string;
    title?: string;
    code?: string;
    level?: string;
    semester?: number | string;
    description?: string;
    department_id?: string;
    school_id?: string;
  }): Promise<boolean> {
    if (!isSupabaseConfigured || !course.course_id) return false;
    try {
      const code = course.course_code || course.code || course.course_id.toUpperCase();
      const title = course.course_name || course.title || code;
      const sem = course.semester === 'second' || course.semester === 2 ? 2 : 1;
      const payload: any = {
        id: course.course_id,
        code,
        title,
        level: course.level || '100lvl',
        semester: sem,
        description: course.description || null,
        updated_at: new Date().toISOString(),
      };
      if (course.department_id) payload.department_id = course.department_id;
      if (course.school_id) payload.school_id = course.school_id;

      const client = supabaseAdmin || supabase;
      const { error } = await client.from('courses').upsert(payload);
      if (error) {
        console.warn('[SupabaseDataService] Error upserting course:', error);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('[SupabaseDataService] Exception upserting course:', err);
      return false;
    }
  }

  public async deleteCourse(courseId: string): Promise<boolean> {
    if (!isSupabaseConfigured || !courseId) return false;
    try {
      const client = supabaseAdmin || supabase;
      const { error } = await client.from('courses').delete().eq('id', courseId);
      if (error) {
        console.warn('[SupabaseDataService] Error deleting course:', error);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('[SupabaseDataService] Exception deleting course:', err);
      return false;
    }
  }

  public async upsertTopic(topic: {
    topic_id: string;
    course_id: string;
    topic_name: string;
    topic_order?: number;
    topic_context?: string;
    start_point?: string;
    end_point?: string;
  }): Promise<boolean> {
    if (!isSupabaseConfigured || !topic.topic_id || !topic.course_id) return false;
    try {
      const client = supabaseAdmin || supabase;
      const { error } = await client.from('topics').upsert({
        id: topic.topic_id,
        course_id: topic.course_id,
        topic_name: topic.topic_name,
        topic_order: topic.topic_order || 1,
        overview_json: {
          overview: topic.topic_context || '',
          start_point: topic.start_point || null,
          end_point: topic.end_point || null,
        },
      });
      if (error) {
        console.warn('[SupabaseDataService] Error upserting topic:', error);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('[SupabaseDataService] Exception upserting topic:', err);
      return false;
    }
  }

  public async deleteTopic(topicId: string): Promise<boolean> {
    if (!isSupabaseConfigured || !topicId) return false;
    try {
      const client = supabaseAdmin || supabase;
      const { error } = await client.from('topics').delete().eq('id', topicId);
      if (error) {
        console.warn('[SupabaseDataService] Error deleting topic:', error);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('[SupabaseDataService] Exception deleting topic:', err);
      return false;
    }
  }

  public async fetchAllUsers(): Promise<UserProfile[]> {
    if (!isSupabaseConfigured) return [];
    try {
      const client = supabaseAdmin || supabase;
      const { data, error } = await client
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (error || !data) {
        console.warn('[SupabaseDataService] Error fetching all users:', error);
        return [];
      }

      return data.map((d: any) => ({
        uid: d.id,
        display_name: d.full_name || d.username || 'User',
        photo_url: d.avatar_url || '',
        email: d.email || '',
        school_id: d.school_id,
        school_name: d.school_name,
        college_id: d.college_id,
        department_id: d.department_id,
        department_name: d.department_name,
        level: d.level,
        xp: d.xp || 0,
        current_streak: d.streak || 0,
        last_activity_date: d.last_seen ? new Date(d.last_seen).getTime() : Date.now(),
        notifications_enabled: true,
        ai_credits_balance: d.ai_credits ?? 50,
        is_admin: d.is_admin || false,
        role: d.is_admin ? 'superadmin' : 'user',
        subscription_status: d.subscription_status || (d.is_paid_subscriber ? 'premium' : 'free'),
        is_online: d.is_online || false,
        last_seen: d.last_seen ? new Date(d.last_seen).getTime() : undefined,
      })) as UserProfile[];
    } catch (err) {
      console.warn('[SupabaseDataService] Exception fetching all users:', err);
      return [];
    }
  }

  // ── User Learning Progress ─────────────────────────────────────────────────

  public async saveTopicProgress(
    userId: string,
    courseId: string,
    topicId: string,
    completedBoards: number,
    isMastered: boolean = false,
    score: number = 0
  ): Promise<void> {
    if (!isSupabaseConfigured || !userId || !topicId) return;
    try {
      const { error } = await supabase
        .from('user_progress')
        .upsert({
          user_id: userId,
          course_id: courseId,
          topic_id: topicId,
          completed_boards: completedBoards,
          is_mastered: isMastered,
          score: score,
          last_studied_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id,topic_id',
        });

      if (error) {
        console.warn('[SupabaseDataService] Error saving progress:', error);
      }
    } catch (err) {
      console.warn('[SupabaseDataService] Exception saving progress:', err);
    }
  }

  public async fetchUserProgress(userId: string): Promise<any[]> {
    if (!isSupabaseConfigured || !userId) return [];
    try {
      const { data, error } = await supabase
        .from('user_progress')
        .select('*')
        .eq('user_id', userId);

      if (error) {
        console.warn('[SupabaseDataService] Error fetching user progress:', error);
        return [];
      }
      return data || [];
    } catch (err) {
      console.warn('[SupabaseDataService] Exception fetching user progress:', err);
      return [];
    }
  }

  // ── Subscription & Daily Topic Allowance ───────────────────────────────────

  public async fetchSubscription(userId: string): Promise<UserSubscriptionInfo> {
    const today = new Date().toISOString().split('T')[0];
    const defaultSub: UserSubscriptionInfo = {
      plan_type: 'free',
      status: 'active',
      daily_topic_allowance: 1,
      topics_used_today: 0,
      unlocked_topics_pack: 0,
      last_reset_date: today,
    };

    if (!isSupabaseConfigured || !userId) return defaultSub;

    try {
      const { data, error } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error || !data) return defaultSub;

      // Check if daily allowance needs resetting
      if (data.last_reset_date !== today) {
        await supabase
          .from('subscriptions')
          .update({
            topics_used_today: 0,
            last_reset_date: today,
          })
          .eq('user_id', userId);
        return {
          ...data,
          topics_used_today: 0,
          last_reset_date: today,
        };
      }

      return data as UserSubscriptionInfo;
    } catch (err) {
      console.warn('[SupabaseDataService] Error fetching subscription:', err);
      return defaultSub;
    }
  }

  public async consumeDailyVoiceTopic(userId: string): Promise<{ success: boolean; remainingToday: number; extraPacks: number }> {
    const sub = await this.fetchSubscription(userId);
    const today = new Date().toISOString().split('T')[0];

    if (sub.topics_used_today < sub.daily_topic_allowance) {
      // Consume from daily allowance
      const newUsed = sub.topics_used_today + 1;
      await supabase
        .from('subscriptions')
        .update({
          topics_used_today: newUsed,
          last_reset_date: today,
        })
        .eq('user_id', userId);

      return {
        success: true,
        remainingToday: Math.max(0, sub.daily_topic_allowance - newUsed),
        extraPacks: sub.unlocked_topics_pack,
      };
    } else if (sub.unlocked_topics_pack > 0) {
      // Consume from extra unlocked topics pack
      const newPack = sub.unlocked_topics_pack - 1;
      await supabase
        .from('subscriptions')
        .update({
          unlocked_topics_pack: newPack,
        })
        .eq('user_id', userId);

      return {
        success: true,
        remainingToday: 0,
        extraPacks: newPack,
      };
    }

    return {
      success: false,
      remainingToday: 0,
      extraPacks: 0,
    };
  }

  // ── Storage: Avatar Uploads ────────────────────────────────────────────────

  public async uploadAvatar(userId: string, file: Blob | File): Promise<string | null> {
    if (!isSupabaseConfigured || !userId) return null;
    try {
      const ext = file.type.split('/')[1] || 'jpg';
      const filePath = `${userId}/avatar_${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('profile_avatars')
        .upload(filePath, file, {
          upsert: true,
        });

      if (uploadError) {
        console.error('[SupabaseDataService] Avatar upload error:', uploadError);
        return null;
      }

      const { data } = supabase.storage
        .from('profile_avatars')
        .getPublicUrl(filePath);

      const publicUrl = data.publicUrl;
      await this.upsertUserProfile({ uid: userId, photo_url: publicUrl });
      return publicUrl;
    } catch (err) {
      console.error('[SupabaseDataService] Exception uploading avatar:', err);
      return null;
    }
  }

  // ── Topic Last Visited & Topic Structure DB Persistence ──────────────────

  public async saveTopicLastVisited(userId: string, topicTitle: string, courseName?: string): Promise<void> {
    if (!isSupabaseConfigured || !userId || !topicTitle) return;
    try {
      const topicKey = topicTitle.toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
      const payload = {
        user_id: userId,
        topic_title: topicTitle,
        course_name: courseName || 'General',
        topic_key: topicKey,
        last_seen_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('user_topic_views').upsert(payload, { onConflict: 'user_id,topic_key' });
      if (error) {
        console.warn('[SupabaseDataService] Error saving topic last visited:', error.message);
      }
    } catch (err) {
      console.warn('[SupabaseDataService] Exception saving topic last visited:', err);
    }
  }

  public async saveTopicTeachingStructureSupabase(
    topicTitle: string,
    courseName: string | undefined,
    durationMode: number,
    structure: any
  ): Promise<void> {
    if (!isSupabaseConfigured || !topicTitle || !structure) return;
    try {
      const cleanTopic = topicTitle.toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
      const structKey = `${cleanTopic}_${durationMode}min`;
      const payload = {
        topic_key: structKey,
        topic_title: topicTitle,
        course_name: courseName || 'General',
        duration_mode: durationMode,
        structure_json: structure,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('topic_teaching_structures').upsert(payload, { onConflict: 'topic_key' });
      if (error) {
        console.warn('[SupabaseDataService] Error saving topic teaching structure to Supabase:', error.message);
      }
    } catch (err) {
      console.warn('[SupabaseDataService] Exception saving topic teaching structure to Supabase:', err);
    }
  }

  public async getTopicTeachingStructureSupabase(
    topicTitle: string,
    courseName: string | undefined,
    durationMode: number
  ): Promise<any | null> {
    if (!isSupabaseConfigured || !topicTitle) return null;
    try {
      const cleanTopic = topicTitle.toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
      const structKey = `${cleanTopic}_${durationMode}min`;
      const { data, error } = await supabase
        .from('topic_teaching_structures')
        .select('structure_json')
        .eq('topic_key', structKey)
        .maybeSingle();

      if (error || !data || !data.structure_json) return null;
      return data.structure_json;
    } catch (err) {
      console.warn('[SupabaseDataService] Exception fetching topic teaching structure from Supabase:', err);
      return null;
    }
  }

  // ── Deduct Live Tutorial Minutes (2 mins per board generated/played) ─────

  public async deductLiveMinutes(userId: string, minutesToDeduct: number = 2): Promise<{ success: boolean; remainingMinutes: number }> {
    if (!isSupabaseConfigured || !userId || userId === 'anon') {
      return { success: true, remainingMinutes: 999 };
    }
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('live_tutorial_minutes, ai_credits')
        .eq('id', userId)
        .maybeSingle();

      const currentMinutes = profile?.live_tutorial_minutes ?? 120;
      const updatedMinutes = Math.max(0, currentMinutes - minutesToDeduct);

      await supabase
        .from('profiles')
        .update({
          live_tutorial_minutes: updatedMinutes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);

      return { success: true, remainingMinutes: updatedMinutes };
    } catch (err) {
      console.warn('[SupabaseDataService] Exception deducting live tutorial minutes:', err);
      return { success: true, remainingMinutes: 0 };
    }
  }
}

export const supabaseDataService = SupabaseDataService.getInstance();
export default supabaseDataService;
