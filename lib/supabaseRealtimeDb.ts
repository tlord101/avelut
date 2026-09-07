/**
 * Path-style realtime DB API backed by Supabase (Postgres + Realtime WebSockets).
 * Replaces firebase/database for Messenger, notifications, presence, typing.
 *
 * Typing uses Realtime broadcast channels (no row writes → lower cost).
 * Messages / chats / notifications use tables + postgres_changes WebSockets.
 */

import { supabase, supabaseAdmin, isSupabaseConfigured } from './supabaseClient';

export type DbRef = { path: string };

type Unsub = () => void;

const listeners = new Map<string, Set<(snap: { val: () => any; exists: () => boolean }) => void>>();
const pathDataCache = new Map<string, any>();
const channelByPath = new Map<string, ReturnType<typeof supabase.channel>>();

let isAppKvAvailable: boolean | null = typeof window !== 'undefined' && window.sessionStorage?.getItem('avelut_app_kv_missing') === '1' ? false : null;

function getLocalCache(path: string): any {
  if (pathDataCache.has(path)) return pathDataCache.get(path);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(`rtdb_kv_${path}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        pathDataCache.set(path, parsed);
        return parsed;
      }
    } catch {}
  }
  return null;
}

function setLocalCache(path: string, val: any) {
  pathDataCache.set(path, val);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      if (val === null || val === undefined) {
        window.localStorage.removeItem(`rtdb_kv_${path}`);
      } else {
        window.localStorage.setItem(`rtdb_kv_${path}`, JSON.stringify(val));
      }
    } catch {}
  }
}

function makeSnap(value: any, key: string | null = null) {
  return {
    key: key,
    val: () => value ?? null,
    exists: () => {
      if (value === null || value === undefined) return false;
      if (typeof value === 'object') {
        return Object.keys(value).length > 0;
      }
      return true;
    },
    forEach: (callback: (child: any) => boolean | void) => {
      if (value && typeof value === 'object') {
        for (const [childKey, childVal] of Object.entries(value)) {
          const childSnap = makeSnap(childVal, childKey);
          if (callback(childSnap) === true) break;
        }
      }
    },
    child: (childPath: string) => {
      if (value && typeof value === 'object') {
        return makeSnap(value[childPath], childPath);
      }
      return makeSnap(null, childPath);
    },
  };
}

function notify(path: string, value: any) {
  pathDataCache.set(path, value);
  const set = listeners.get(path);
  if (!set) return;
  const snap = makeSnap(value);
  set.forEach((cb) => {
    try {
      cb(snap);
    } catch (e) {
      console.warn('[supabaseRealtimeDb] listener error', e);
    }
  });
}

function parsePath(pathOrRef: any): string[] {
  if (!pathOrRef) return [];
  const rawPath = typeof pathOrRef === 'string' ? pathOrRef : (pathOrRef?.path ?? pathOrRef?._path ?? '');
  if (!rawPath || typeof rawPath !== 'string') return [];
  return rawPath.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
}

export function ref(_db: unknown, path: string): DbRef {
  const safePath = typeof path === 'string' ? path.replace(/^\/+|\/+$/g, '') : '';
  return { path: safePath };
}

export function serverTimestamp(): number {
  return Date.now();
}

export function increment(by: number) {
  return { __op: 'increment', by } as const;
}

export function limitToLast(n: number) {
  return { __op: 'limitToLast', n } as const;
}

export function query(r: DbRef, ..._constraints: any[]): DbRef {
  return r;
}

async function loadSchoolsDataTree(): Promise<Record<string, any>> {
  const client = supabaseAdmin || supabase;
  const [schoolsRes, collegesRes, deptsRes] = await Promise.all([
    client.from('schools').select('*'),
    client.from('colleges').select('*'),
    client.from('departments').select('*'),
  ]);

  const tree: Record<string, any> = {};

  (schoolsRes.data || []).forEach((s: any) => {
    tree[s.id] = {
      id: s.id,
      name: s.name,
      short_name: s.short_name,
      colleges: {},
    };
  });

  if (Object.keys(tree).length === 0) {
    tree['fupre'] = {
      id: 'fupre',
      name: 'Federal University of Petroleum Resources Effurun',
      short_name: 'FUPRE',
      colleges: {},
    };
  }

  (collegesRes.data || []).forEach((c: any) => {
    const sId = c.school_id || Object.keys(tree)[0] || 'fupre';
    if (!tree[sId]) {
      tree[sId] = { id: sId, name: sId.toUpperCase(), colleges: {} };
    }
    tree[sId].colleges[c.id] = {
      id: c.id,
      name: c.name,
      short_name: c.short_name,
      departments: {},
    };
  });

  (deptsRes.data || []).forEach((d: any) => {
    const sId = d.school_id || Object.keys(tree)[0] || 'fupre';
    if (!tree[sId]) tree[sId] = { id: sId, name: sId.toUpperCase(), colleges: {} };

    let cId = d.college_id;
    if (!cId || !tree[sId].colleges[cId]) {
      if (cId) {
        tree[sId].colleges[cId] = {
          id: cId,
          name: cId.replace(/_/g, ' ').toUpperCase(),
          short_name: cId.toUpperCase(),
          departments: {},
        };
      } else {
        const existingCollegeIds = Object.keys(tree[sId].colleges);
        if (existingCollegeIds.length > 0) {
          cId = existingCollegeIds[0];
        } else {
          cId = 'college_of_engineering';
          tree[sId].colleges[cId] = { id: cId, name: 'College of Engineering', short_name: 'COE', departments: {} };
        }
      }
    }

    if (!tree[sId].colleges[cId].departments) {
      tree[sId].colleges[cId].departments = {};
    }

    tree[sId].colleges[cId].departments[d.id] = {
      id: d.id,
      name: d.name,
      department_name: d.name,
      short_name: d.short_name,
      code: d.short_name,
      collegeId: cId,
      college_id: cId,
      schoolId: sId,
      school_id: sId,
      levels: ['100lvl', '200lvl', '300lvl', '400lvl', '500lvl'],
    };
  });

  return tree;
}

async function loadDepartmentsData(): Promise<Record<string, any>> {
  const client = supabaseAdmin || supabase;
  const [deptsRes, coursesRes] = await Promise.all([
    client.from('departments').select('*'),
    client.from('courses').select('*, topics(*)'),
  ]);

  const map: Record<string, any> = {};

  (deptsRes.data || []).forEach((d: any) => {
    map[d.id] = {
      id: d.id,
      department_name: d.name,
      name: d.name,
      short_name: d.short_name,
      school_id: d.school_id || 'fupre',
      college_id: d.college_id || null,
      course_list: [],
      courses: [],
    };
  });

  (coursesRes.data || []).forEach((c: any) => {
    const courseObj = {
      course_id: c.id,
      course_name: c.title || c.code,
      course_code: c.code,
      level: c.level || '100lvl',
      semester: c.semester === 2 ? 'second' : 'first',
      description: c.description || '',
      department_id: c.department_id,
      school_id: c.school_id,
      textbook_url: c.textbook_url || '',
      topics: ((c.topics || []) as any[]).map((t: any) => ({
        topic_id: t.id,
        topic_name: t.topic_name,
        topic_order: t.topic_order,
        topic_context: t.overview_json?.overview || t.overview_json?.topic_context || '',
        start_point: t.overview_json?.start_point || '',
        end_point: t.overview_json?.end_point || '',
        is_complete: false,
      })),
    };

    if (c.department_id && map[c.department_id]) {
      map[c.department_id].course_list.push(courseObj);
      map[c.department_id].courses.push(courseObj);
    } else if (c.department_id) {
      map[c.department_id] = {
        id: c.department_id,
        department_name: c.department_id.replace(/_/g, ' '),
        name: c.department_id.replace(/_/g, ' '),
        school_id: c.school_id || 'fupre',
        college_id: null,
        course_list: [courseObj],
        courses: [courseObj],
      };
    }
  });

  return map;
}

async function loadPath(path: string): Promise<any> {

  if (!path || path === 'undefined' || path === 'null') return null;

  if (path === '.info/connected' || path.startsWith('.info/')) {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  }

  const parts = parsePath(path);
  if (parts.some((p) => p === 'undefined' || p === 'null' || !p)) {
    return null;
  }

  if (!isSupabaseConfigured) return null;

  if (parts[0] === 'user_progress' && parts.length >= 2) {
    const userId = parts[1];
    try {
      const { data, error } = await supabase.from('user_progress').select('*').eq('user_id', userId);
      if (!error && data) {
        const map: Record<string, any> = {};
        data.forEach((row: any) => {
          if (row.course_id) {
            if (!map[row.course_id]) map[row.course_id] = {};
            if (row.topic_id) {
              map[row.course_id][row.topic_id] = {
                status: row.is_mastered ? 'completed' : 'in_progress',
                completed_boards: row.completed_boards || 0,
                total_boards: row.total_boards || 10,
                score: row.score || 0,
                is_mastered: row.is_mastered,
              };
            }
          }
        });
        return map;
      }
    } catch {}
  }

  if (parts[0] === 'chat_conversations') {
    if (parts.length === 2) {
      const userId = parts[1];
      const local = getLocalCache(`chat_conversations/${userId}`) || {};
      try {
        const client = supabaseAdmin || supabase;
        const { data, error } = await client
          .from('app_kv')
          .select('key, value')
          .like('key', `chat_conversations/${userId}/%`);
        if (!error && data && data.length > 0) {
          const map: Record<string, any> = { ...local };
          data.forEach((row: any) => {
            const cId = row.key.split('/')[2];
            if (cId && row.value) {
              map[cId] = row.value;
            }
          });
          setLocalCache(`chat_conversations/${userId}`, map);
          return map;
        }
      } catch {}
      return Object.keys(local).length > 0 ? local : null;
    }
    if (parts.length === 3) {
      const [, userId, convoId] = parts;
      const list = (await loadPath(`chat_conversations/${userId}`)) || {};
      return list[convoId] ?? getLocalCache(path) ?? null;
    }
  }

  if (parts[0] === 'chat_messages') {
    if (parts.length === 2) {
      const convoId = parts[1];
      const local = getLocalCache(`chat_messages/${convoId}`) || {};
      try {
        const client = supabaseAdmin || supabase;
        const { data, error } = await client
          .from('app_kv')
          .select('key, value')
          .like('key', `chat_messages/${convoId}/%`);
        if (!error && data && data.length > 0) {
          const map: Record<string, any> = { ...local };
          data.forEach((row: any) => {
            const mId = row.key.split('/')[2];
            if (mId && row.value) {
              map[mId] = row.value;
            }
          });
          setLocalCache(`chat_messages/${convoId}`, map);
          return map;
        }
      } catch {}
      return Object.keys(local).length > 0 ? local : null;
    }
    if (parts.length === 3) {
      const [, convoId, msgId] = parts;
      const list = (await loadPath(`chat_messages/${convoId}`)) || {};
      return list[msgId] ?? getLocalCache(path) ?? null;
    }
  }

  if (parts[0] === 'user_chats' && parts.length === 2) {
    const userId = parts[1];
    const { data } = await supabase
      .from('chat_members')
      .select('*')
      .eq('user_id', userId)
      .order('last_message_at', { ascending: false });
    const map: Record<string, any> = {};
    (data || []).forEach((row: any) => {
      map[row.chat_id] = {
        otherUserId: row.other_user_id,
        timestamp: row.last_message_at ? new Date(row.last_message_at).getTime() : Date.now(),
        unreadCount: row.unread_count || 0,
        last_message: row.last_message_text
          ? {
              text: row.last_message_text,
              sender_id: row.last_message_sender_id,
              isRead: row.last_message_is_read,
              timestamp: row.last_message_at ? new Date(row.last_message_at).getTime() : Date.now(),
            }
          : null,
      };
    });
    return map;
  }

  if (parts[0] === 'user_chats' && parts.length === 3) {
    const [, userId, chatId] = parts;
    const { data } = await supabase
      .from('chat_members')
      .select('*')
      .eq('user_id', userId)
      .eq('chat_id', chatId)
      .maybeSingle();
    if (!data) return null;
    return {
      otherUserId: data.other_user_id,
      timestamp: data.last_message_at ? new Date(data.last_message_at).getTime() : Date.now(),
      unreadCount: data.unread_count || 0,
      last_message: data.last_message_text
        ? {
            text: data.last_message_text,
            sender_id: data.last_message_sender_id,
            isRead: data.last_message_is_read,
          }
        : null,
    };
  }

  if ((parts[0] === 'messages' || parts[0] === 'private_messages') && parts.length === 2) {
    const chatId = parts[1];
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true })
      .limit(200);
    const map: Record<string, any> = {};
    (data || []).forEach((row: any) => {
      map[row.id] = {
        id: row.id,
        sender_id: row.sender_id,
        text: row.text,
        media_url: row.media_url,
        media_type: row.media_type,
        reply_to: row.reply_to,
        is_deleted: row.is_deleted,
        timestamp: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
      };
    });
    return map;
  }

  if (parts[0] === 'notifications' && parts.length === 2) {
    const userId = parts[1];
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);
    const map: Record<string, any> = {};
    (data || []).forEach((row: any) => {
      const msg = row.message || row.body || '';
      const meta = row.metadata_json || row.data || {};
      map[row.id] = {
        id: row.id,
        title: row.title,
        body: msg,
        message: msg,
        type: row.type,
        data: meta,
        metadata_json: meta,
        is_read: row.is_read,
        action_url: row.action_url,
        timestamp: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
      };
    });
    return map;
  }

  if (parts[0] === 'users' && parts.length === 2) {
    const userId = parts[1];
    const client = supabaseAdmin || supabase;
    const [{ data }, { data: metaRow }] = await Promise.all([
      client.from('profiles').select('*').eq('id', userId).maybeSingle(),
      client.from('app_kv').select('value').eq('key', `user_meta/${userId}`).maybeSingle(),
    ]);
    if (!data) return null;
    const meta = (metaRow?.value && typeof metaRow.value === 'object') ? metaRow.value : {};
    const credits = typeof data.ai_credits === 'number'
      ? data.ai_credits
      : (typeof data.ai_credits_balance === 'number' ? data.ai_credits_balance : 50);
    const subStatus = meta.subscription_status || data.subscription_status || (data.is_paid_subscriber ? 'premium' : 'free');
    const userRole = meta.role || (data.is_admin ? 'superadmin' : (data.role || 'user'));
    return {
      ...data,
      ...meta,
      uid: data.id,
      id: data.id,
      display_name: data.full_name || data.username || 'User',
      full_name: data.full_name || data.username || '',
      photo_url: data.avatar_url || '',
      avatar_url: data.avatar_url || '',
      isOnline: data.is_online ?? false,
      is_online: data.is_online ?? false,
      lastSeen: data.last_seen ? new Date(data.last_seen).getTime() : null,
      last_seen: data.last_seen ? new Date(data.last_seen).getTime() : null,
      notifications_enabled: data.notifications_enabled ?? true,
      ai_credits_balance: credits,
      ai_credits: credits,
      current_streak: data.streak ?? 0,
      streak: data.streak ?? 0,
      subscription_status: subStatus,
      role: userRole,
      is_admin: data.is_admin || userRole === 'superadmin',
    };
  }

  if (parts[0] === 'users' && parts.length === 1) {
    const client = supabaseAdmin || supabase;
    const [{ data }, { data: metaRows }] = await Promise.all([
      client.from('profiles').select('*').limit(500),
      client.from('app_kv').select('key, value').like('key', 'user_meta/%').limit(500),
    ]);
    const metaMap: Record<string, any> = {};
    (metaRows || []).forEach((row: any) => {
      const uId = row.key.replace('user_meta/', '');
      if (row.value && typeof row.value === 'object') {
        metaMap[uId] = row.value;
      }
    });

    const map: Record<string, any> = {};
    (data || []).forEach((row: any) => {
      const meta = metaMap[row.id] || {};
      const subStatus = meta.subscription_status || row.subscription_status || (row.is_paid_subscriber ? 'premium' : 'free');
      const userRole = meta.role || (row.is_admin ? 'superadmin' : (row.role || 'user'));
      map[row.id] = {
        uid: row.id,
        id: row.id,
        email: row.email || '',
        display_name: row.full_name || row.username || 'User',
        full_name: row.full_name || '',
        photo_url: row.avatar_url || '',
        avatar_url: row.avatar_url || '',
        isOnline: row.is_online || false,
        is_online: row.is_online || false,
        lastSeen: row.last_seen ? new Date(row.last_seen).getTime() : null,
        last_seen: row.last_seen ? new Date(row.last_seen).getTime() : null,
        school_id: row.school_id,
        school_name: row.school_name,
        college_id: row.college_id,
        department_id: row.department_id,
        department_name: row.department_name,
        level: row.level,
        xp: row.xp || 0,
        current_streak: row.streak || 0,
        streak: row.streak || 0,
        ai_credits_balance: row.ai_credits ?? 50,
        ai_credits: row.ai_credits ?? 50,
        is_admin: row.is_admin || userRole === 'superadmin',
        role: userRole,
        subscription_status: subStatus,
        status: meta.status || row.status || 'active',
        admin_department_ids: meta.admin_department_ids || row.admin_department_ids || null,
      };
    });
    return map;
  }

  if (parts[0] === 'schools_data') {
    const tree = await loadSchoolsDataTree();
    if (parts.length === 1) return tree;
    if (parts.length === 2) return tree[parts[1]] || null;
    if (parts.length === 4 && parts[2] === 'colleges') {
      return tree[parts[1]]?.colleges?.[parts[3]] || null;
    }
    if (parts.length === 6 && parts[4] === 'departments') {
      return tree[parts[1]]?.colleges?.[parts[3]]?.departments?.[parts[5]] || null;
    }
    if (parts.length >= 7) {
      const deptObj = tree[parts[1]]?.colleges?.[parts[3]]?.departments?.[parts[5]];
      if (parts[6] === 'levels') return deptObj?.levels || ['100lvl', '200lvl', '300lvl', '400lvl', '500lvl'];
      return deptObj || null;
    }
    return tree;
  }

  if (parts[0] === 'departments_data') {
    const map = await loadDepartmentsData();
    if (parts.length === 1) return map;

    const rawDeptKey = parts[1];
    const dept = map[rawDeptKey] || map[`${rawDeptKey}_`] || map[rawDeptKey.replace(/_+$/, '')];

    if (parts.length === 2) return dept || null;
    if (parts.length === 3 && parts[2] === 'course_list') {
      return dept?.course_list || [];
    }
    if (parts.length === 4 && parts[2] === 'course_list') {
      const targetCourseId = parts[3].toLowerCase();
      const course = (dept?.course_list || []).find((c: any) => c.course_id?.toLowerCase() === targetCourseId);
      return course || null;
    }
    return dept || null;
  }

  if (parts[0] === 'global_courses') {
    const client = supabaseAdmin || supabase;
    if (parts.length === 1) {
      const { data: courses } = await client.from('courses').select('*, topics(*)');
      const map: Record<string, any> = {};
      (courses || []).forEach((c: any) => {
        map[c.id] = {
          course_id: c.id,
          id: c.id,
          course_name: c.title || c.code,
          course_code: c.code,
          level: c.level || '100lvl',
          semester: c.semester === 2 ? 'second' : 'first',
          description: c.description || '',
          department_id: c.department_id,
          school_id: c.school_id,
          linked_departments: c.department_id ? [c.department_id] : [],
          topics: ((c.topics || []) as any[]).map((t: any) => ({
            topic_id: t.id,
            topic_name: t.topic_name,
            topic_order: t.topic_order,
            topic_context: t.overview_json?.overview || '',
            start_point: t.overview_json?.start_point || '',
            end_point: t.overview_json?.end_point || '',
            subtopics: t.overview_json?.subtopics || [],
          })),
        };
      });
      return map;
    }
    if (parts.length === 2) {
      const { data: c } = await client.from('courses').select('*, topics(*)').eq('id', parts[1]).maybeSingle();
      if (!c) return null;
      return {
        course_id: c.id,
        id: c.id,
        course_name: c.title || c.code,
        course_code: c.code,
        level: c.level || '100lvl',
        semester: c.semester === 2 ? 'second' : 'first',
        description: c.description || '',
        department_id: c.department_id,
        school_id: c.school_id,
        linked_departments: c.department_id ? [c.department_id] : [],
        topics: ((c.topics || []) as any[]).map((t: any) => ({
          topic_id: t.id,
          topic_name: t.topic_name,
          topic_order: t.topic_order,
          topic_context: t.overview_json?.overview || '',
          start_point: t.overview_json?.start_point || '',
          end_point: t.overview_json?.end_point || '',
          subtopics: t.overview_json?.subtopics || [],
        })),
      };
    }
  }

  if (parts[0] === 'past_questions') {
    const client = supabaseAdmin || supabase;
    if (parts.length === 1) {
      const { data } = await client.from('past_questions').select('*');
      const map: Record<string, any> = {};
      (data || []).forEach((pq: any) => {
        map[pq.id] = pq.questions_json || pq;
      });
      return map;
    } else if (parts.length >= 2) {
      const queryId = parts.slice(1).join('_');
      const { data } = await client
        .from('past_questions')
        .select('*')
        .or(`id.eq.${queryId},id.eq.${parts[1]}`)
        .maybeSingle();
      if (data) return data.questions_json || data;
    }
  }

  if (parts[0] === 'study_partners') {
    if (parts.length === 2) {
      const userId = parts[1];
      try {
        const { data, error } = await supabase
          .from('study_partners')
          .select('partner_id, user_id')
          .or(`user_id.eq.${userId},partner_id.eq.${userId}`);
        const map: Record<string, boolean> = {};
        if (!error && data) {
          data.forEach((row: any) => {
            const otherId = row.user_id === userId ? row.partner_id : row.user_id;
            if (otherId) map[otherId] = true;
          });
        }
        return map;
      } catch {
        return getLocalCache(path) || {};
      }
    }
    if (parts.length === 3) {
      const [, userId, targetId] = parts;
      try {
        const { data, error } = await supabase
          .from('study_partners')
          .select('user_id')
          .or(`and(user_id.eq.${userId},partner_id.eq.${targetId}),and(user_id.eq.${targetId},partner_id.eq.${userId})`)
          .limit(1);
        if (!error && data && data.length > 0) return true;
      } catch {}
      const cachedList = getLocalCache(`study_partners/${userId}`);
      return !!cachedList?.[targetId];
    }
  }

  if (parts[0] === 'partner_requests') {
    if (parts.length === 2) {
      const userId = parts[1];
      try {
        const { data, error } = await supabase
          .from('app_kv')
          .select('value')
          .eq('key', `partner_requests/${userId}`)
          .maybeSingle();
        if (!error && data?.value) {
          setLocalCache(path, data.value);
          return data.value;
        }
      } catch {}
      return getLocalCache(path) || {};
    }
    if (parts.length === 3) {
      const [, userId, targetId] = parts;
      const userReqs = await loadPath(`partner_requests/${userId}`);
      return userReqs?.[targetId] ?? null;
    }
  }

  if (parts[0] === 'users' && parts[2] === 'blocked_users' && parts.length === 3) {
    const { data } = await supabase.from('user_blocks').select('blocked_id').eq('user_id', parts[1]);
    const map: Record<string, boolean> = {};
    (data || []).forEach((row: any) => {
      map[row.blocked_id] = true;
    });
    return map;
  }

  if (parts[0] === 'chat_meta_data' && parts[2] === 'typing') {
    return pathDataCache.get(path) || {};
  }

  // Handle app_settings/* via public.app_settings table
  if (parts[0] === 'app_settings') {
    const client = supabaseAdmin || supabase;
    if (parts.length === 1) {
      const { data, error } = await client.from('app_settings').select('*');
      if (!error && data) {
        const map: Record<string, any> = {};
        data.forEach((row: any) => {
          map[row.key] = row.value_json;
        });
        return map;
      }
    } else if (parts.length >= 2) {
      try {
        const { data, error } = await client.from('app_settings').select('value_json').eq('key', parts[1]).maybeSingle();
        if (!error && data?.value_json) {
          if (parts.length === 3 && typeof data.value_json === 'object') {
            return data.value_json[parts[2]] ?? null;
          }
          return data.value_json;
        }
      } catch {}
    }
  }

  const cached = getLocalCache(path);

  if (isAppKvAvailable === false || !isSupabaseConfigured) {
    return cached ?? null;
  }

  try {
    const { data, error } = await supabase.from('app_kv').select('value').eq('key', path).maybeSingle();
    if (error) {
      if (error.code === '42P01' || (error as any).status === 404 || error.message?.includes('does not exist')) {
        isAppKvAvailable = false;
        if (typeof window !== 'undefined' && window.sessionStorage) {
          window.sessionStorage.setItem('avelut_app_kv_missing', '1');
        }
      }
      return cached ?? null;
    }
    isAppKvAvailable = true;
    if (data && 'value' in data) {
      setLocalCache(path, data.value);
      return data.value;
    }
    return cached ?? null;
  } catch {
    isAppKvAvailable = false;
    return cached ?? null;
  }
}

export async function get(r: DbRef) {
  const value = await loadPath(r.path);
  return makeSnap(value);
}

export function onValue(r: DbRef, callback: (snap: any) => void): Unsub {
  const path = r.path;

  if (path === '.info/connected' || path.startsWith('.info/')) {
    const handler = () => {
      const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
      callback(makeSnap(isOnline));
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('online', handler);
      window.addEventListener('offline', handler);
      handler();
      return () => {
        window.removeEventListener('online', handler);
        window.removeEventListener('offline', handler);
      };
    }
    callback(makeSnap(true));
    return () => {};
  }

  const parts = parsePath(path);
  if (parts.some((p) => p === 'undefined' || p === 'null' || !p)) {
    callback(makeSnap(null));
    return () => {};
  }

  if (!listeners.has(path)) listeners.set(path, new Set());
  listeners.get(path)!.add(callback);

  loadPath(path).then((v) => notify(path, v));

  if ((parts[0] === 'messages' || parts[0] === 'private_messages') && parts.length === 2) {
    const chatId = parts[1];
    const chName = `messages:${chatId}`;
    let ch = channelByPath.get(chName);
    if (!ch) {
      ch = supabase
        .channel(chName)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
          async () => {
            const v = await loadPath(path);
            notify(path, v);
          }
        )
        .subscribe();
      channelByPath.set(chName, ch);
    }
  }

  if (parts[0] === 'user_chats' && parts.length >= 2) {
    const userId = parts[1];
    const chName = `user_chats:${userId}`;
    let ch = channelByPath.get(chName);
    if (!ch) {
      ch = supabase
        .channel(chName)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'chat_members', filter: `user_id=eq.${userId}` },
          async () => {
            const listPath = `user_chats/${userId}`;
            notify(listPath, await loadPath(listPath));
            if (parts.length === 3) {
              notify(path, await loadPath(path));
            }
          }
        )
        .subscribe();
      channelByPath.set(chName, ch);
    }
  }

  if (parts[0] === 'notifications' && parts.length === 2) {
    const userId = parts[1];
    const chName = `notifications:${userId}`;
    let ch = channelByPath.get(chName);
    if (!ch) {
      ch = supabase
        .channel(chName)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
          async () => notify(path, await loadPath(path))
        )
        .subscribe();
      channelByPath.set(chName, ch);
    }
  }

  if (parts[0] === 'study_partners' && parts.length >= 2) {
    const userId = parts[1];
    const chName = `study_partners:${userId}`;
    let ch = channelByPath.get(chName);
    if (!ch) {
      ch = supabase
        .channel(chName)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'study_partners' },
          async () => {
            const list = await loadPath(`study_partners/${userId}`);
            notify(`study_partners/${userId}`, list);
            if (parts.length === 3) {
              notify(path, !!list?.[parts[2]]);
            }
          }
        )
        .subscribe();
      channelByPath.set(chName, ch);
    }
  }

  if (parts[0] === 'partner_requests' && parts.length >= 2) {
    const userId = parts[1];
    const chName = `partner_requests:${userId}`;
    let ch = channelByPath.get(chName);
    if (!ch) {
      ch = supabase
        .channel(chName)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'app_kv', filter: `key=eq.partner_requests/${userId}` },
          async (payload: any) => {
            const updatedMap = payload?.new?.value || (await loadPath(`partner_requests/${userId}`)) || {};
            notify(`partner_requests/${userId}`, updatedMap);
            if (parts.length === 3) {
              notify(path, updatedMap?.[parts[2]] ?? null);
            }
          }
        )
        .subscribe();
      channelByPath.set(chName, ch);
    }
  }

  if (parts[0] === 'chat_meta_data' && parts[2] === 'typing') {
    const chatId = parts[1];
    const chName = `typing:${chatId}`;
    let ch = channelByPath.get(chName);
    if (!ch) {
      ch = supabase
        .channel(chName)
        .on('broadcast', { event: 'typing' }, ({ payload }) => {
          const current = { ...(pathDataCache.get(path) || {}) };
          if (payload?.uid) {
            if (payload.clear) delete current[payload.uid];
            else current[payload.uid] = payload.state;
            notify(path, current);
          }
        })
        .subscribe();
      channelByPath.set(chName, ch);
    }
  }

  if (parts[0] === 'users' && parts.length === 2) {
    const userId = parts[1];
    const chName = `profile:${userId}`;
    let ch = channelByPath.get(chName);
    if (!ch) {
      ch = supabase
        .channel(chName)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
          async () => {
            const fresh = await loadPath(path);
            notify(path, fresh);
          }
        )
        .subscribe();
      channelByPath.set(chName, ch);
    }
  }

  if (parts[0] === 'users' && parts.length === 1) {
    const chName = 'profiles:all';
    let ch = channelByPath.get(chName);
    if (!ch) {
      ch = supabase
        .channel(chName)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'profiles' },
          async () => {
            const fresh = await loadPath(path);
            notify(path, fresh);
          }
        )
        .subscribe();
      channelByPath.set(chName, ch);
    }
  }

  return () => {
    const set = listeners.get(path);
    if (set) {
      set.delete(callback);
      if (set.size === 0) listeners.delete(path);
    }
  };
}

export function notifyUserCreditsUpdated(userId: string, newCredits: number) {
  const path = `users/${userId}`;
  const current = getLocalCache(path) || pathDataCache.get(path) || {};
  const updated = {
    ...current,
    ai_credits: newCredits,
    ai_credits_balance: newCredits,
  };
  setLocalCache(path, updated);
  notify(path, updated);

  const listPath = 'users';
  const currentList = getLocalCache(listPath) || pathDataCache.get(listPath);
  if (currentList && typeof currentList === 'object' && currentList[userId]) {
    const updatedList = {
      ...currentList,
      [userId]: {
        ...currentList[userId],
        ai_credits: newCredits,
        ai_credits_balance: newCredits,
      },
    };
    setLocalCache(listPath, updatedList);
    notify(listPath, updatedList);
  }
}

export function off(r?: DbRef, _event?: string, callback?: (snap: any) => void) {
  if (!r) return;
  const set = listeners.get(r.path);
  if (!set) return;
  if (callback) set.delete(callback);
  else set.clear();
}

export async function set(r: DbRef, value: any): Promise<void> {
  const parts = parsePath(r.path);

  if (parts[0] === 'chat_meta_data' && parts[2] === 'typing') {
    const chatId = parts[1];
    const uid = parts[3];
    const chName = `typing:${chatId}`;
    let ch = channelByPath.get(chName);
    if (!ch) {
      ch = supabase.channel(chName).subscribe();
      channelByPath.set(chName, ch);
    }
    if (uid) {
      await ch.send({
        type: 'broadcast',
        event: 'typing',
        payload: value ? { uid, state: value } : { uid, clear: true },
      });
    }
    return;
  }

  if (parts[0] === 'chat_conversations') {
    if (parts.length === 3) {
      const [, userId, convoId] = parts;
      const current = { ...(getLocalCache(`chat_conversations/${userId}`) || {}) };
      if (value === null) {
        delete current[convoId];
      } else {
        current[convoId] = value;
      }
      setLocalCache(`chat_conversations/${userId}`, current);
      setLocalCache(r.path, value);
      notify(`chat_conversations/${userId}`, current);
      notify(r.path, value);

      try {
        const client = supabaseAdmin || supabase;
        if (value === null) {
          await client.from('app_kv').delete().eq('key', r.path);
        } else {
          await client.from('app_kv').upsert({
            key: r.path,
            value,
            updated_at: new Date().toISOString(),
          });
        }
      } catch (e) {
        console.warn('[supabaseRealtimeDb] chat_conversations write error', e);
      }
      return;
    }
  }

  if (parts[0] === 'chat_messages') {
    if (parts.length === 3) {
      const [, convoId, msgId] = parts;
      const current = { ...(getLocalCache(`chat_messages/${convoId}`) || {}) };
      if (value === null) {
        delete current[msgId];
      } else {
        current[msgId] = value;
      }
      setLocalCache(`chat_messages/${convoId}`, current);
      setLocalCache(r.path, value);
      notify(`chat_messages/${convoId}`, current);
      notify(r.path, value);

      try {
        const client = supabaseAdmin || supabase;
        if (value === null) {
          await client.from('app_kv').delete().eq('key', r.path);
        } else {
          await client.from('app_kv').upsert({
            key: r.path,
            value,
            updated_at: new Date().toISOString(),
          });
        }
      } catch (e) {
        console.warn('[supabaseRealtimeDb] chat_messages write error', e);
      }
      return;
    }
    if (parts.length === 2 && value === null) {
      const convoId = parts[1];
      setLocalCache(`chat_messages/${convoId}`, null);
      notify(`chat_messages/${convoId}`, null);
      try {
        const client = supabaseAdmin || supabase;
        await client.from('app_kv').delete().like('key', `chat_messages/${convoId}/%`);
      } catch {}
      return;
    }
  }

  if (parts[0] === 'user_chats' && parts.length === 3) {
    const [, userId, chatId] = parts;
    if (value === null) {
      await supabase.from('chat_members').delete().eq('user_id', userId).eq('chat_id', chatId);
      notify(`user_chats/${userId}`, await loadPath(`user_chats/${userId}`));
      return;
    }
    await supabase.from('chat_members').upsert({
      chat_id: chatId,
      user_id: userId,
      other_user_id: value.otherUserId || value.other_user_id || null,
      last_message_text: value.last_message?.text ?? value.last_message_text ?? null,
      last_message_at: value.timestamp
        ? new Date(value.timestamp).toISOString()
        : new Date().toISOString(),
      last_message_sender_id: value.last_message?.sender_id ?? null,
      last_message_is_read: value.last_message?.isRead ?? true,
      unread_count: value.unreadCount ?? value.unread_count ?? 0,
    });
    await supabase.from('chats').upsert({ id: chatId });
    notify(`user_chats/${userId}`, await loadPath(`user_chats/${userId}`));
    return;
  }

  if (parts[0] === 'users' && parts[2] === 'blocked_users' && parts.length === 4) {
    await supabase.from('user_blocks').upsert({ user_id: parts[1], blocked_id: parts[3] });
    return;
  }

  if (parts[0] === 'study_partners' && parts.length === 3) {
    const [, userId, targetId] = parts;
    if (value === null || value === false) {
      try {
        await supabase
          .from('study_partners')
          .delete()
          .or(`and(user_id.eq.${userId},partner_id.eq.${targetId}),and(user_id.eq.${targetId},partner_id.eq.${userId})`);
      } catch (e) {
        console.warn('[supabaseRealtimeDb] delete study_partners error', e);
      }
    } else {
      try {
        const { error } = await supabase.from('study_partners').upsert(
          { user_id: userId, partner_id: targetId },
          { onConflict: 'user_id,partner_id' }
        );
        if (error) {
          await supabase.from('study_partners').upsert(
            { user_id: targetId, partner_id: userId },
            { onConflict: 'user_id,partner_id' }
          );
        }
      } catch (e) {
        console.warn('[supabaseRealtimeDb] upsert study_partners error', e);
      }
    }
    const p1 = await loadPath(`study_partners/${userId}`);
    setLocalCache(`study_partners/${userId}`, p1);
    notify(`study_partners/${userId}`, p1);
    notify(`study_partners/${userId}/${targetId}`, value !== null && value !== false);

    const p2 = await loadPath(`study_partners/${targetId}`);
    setLocalCache(`study_partners/${targetId}`, p2);
    notify(`study_partners/${targetId}`, p2);
    notify(`study_partners/${targetId}/${userId}`, value !== null && value !== false);
    return;
  }

  if (parts[0] === 'partner_requests') {
    if (parts.length === 3) {
      const [, userId, targetId] = parts;
      const current = { ...((await loadPath(`partner_requests/${userId}`)) || {}) };
      if (value === null) {
        delete current[targetId];
      } else {
        current[targetId] = value;
      }
      setLocalCache(`partner_requests/${userId}`, current);
      notify(`partner_requests/${userId}`, current);
      notify(`partner_requests/${userId}/${targetId}`, value);
      try {
        await supabase.from('app_kv').upsert({
          key: `partner_requests/${userId}`,
          value: current,
          updated_at: new Date().toISOString(),
        });
      } catch (e) {
        console.warn('[supabaseRealtimeDb] persist partner_requests error', e);
      }
      return;
    }
    if (parts.length === 2) {
      const userId = parts[1];
      const nextVal = value || {};
      setLocalCache(`partner_requests/${userId}`, nextVal);
      notify(`partner_requests/${userId}`, nextVal);
      try {
        await supabase.from('app_kv').upsert({
          key: `partner_requests/${userId}`,
          value: nextVal,
          updated_at: new Date().toISOString(),
        });
      } catch (e) {
        console.warn('[supabaseRealtimeDb] persist partner_requests error', e);
      }
      return;
    }
  }

  if (parts[0] === 'reports') {
    await supabase.from('reports').insert({
      id: parts[1],
      reporter_id: value.reporter_id ?? value.reporter_uid,
      reported_id: value.reported_id ?? value.reported_uid,
      chat_id: value.chat_id,
      reason: value.reason,
    });
    return;
  }

  if (parts[0] === 'notifications' && parts.length === 3) {
    const userId = parts[1];
    const notifId = parts[2];
    if (value === null) {
      try {
        await supabase.from('notifications').delete().eq('id', notifId);
      } catch (e) {
        console.warn('[supabaseRealtimeDb] delete notification error', e);
      }
    } else {
      const metadata = {
        ...(typeof value.metadata_json === 'object' && value.metadata_json ? value.metadata_json : {}),
        ...(typeof value.data === 'object' && value.data ? value.data : {}),
        ...(value.route ? { route: value.route } : {}),
        ...(value.category ? { category: value.category } : {}),
        ...(value.audience ? { audience: value.audience } : {}),
        ...(value.timestamp ? { timestamp: value.timestamp } : {}),
      };
      try {
        const payload = {
          id: notifId,
          user_id: userId,
          title: value.title ?? null,
          message: value.message || value.body || '',
          type: value.type || 'general',
          metadata_json: metadata,
          action_url: value.action_url || value.actionUrl || null,
          is_read: value.is_read ?? false,
        };
        const { error: insErr } = await supabase.from('notifications').insert(payload);
        if (insErr) {
          await supabase.from('notifications').update(payload).eq('id', notifId);
        }
      } catch (e) {
        console.warn('[supabaseRealtimeDb] notification write error', e);
      }
    }
    setLocalCache(`notifications/${userId}/${notifId}`, value);
    notify(`notifications/${userId}`, await loadPath(`notifications/${userId}`));
    return;
  }

  if ((parts[0] === 'messages' || parts[0] === 'private_messages') && parts.length === 3) {
    const chatId = parts[1];
    const msgId = parts[2];
    if (value === null) {
      try {
        await supabase.from('messages').update({ is_deleted: true }).eq('id', msgId);
      } catch (e) {
        console.warn('[supabaseRealtimeDb] delete message error', e);
      }
    } else {
      const row = {
        id: msgId,
        chat_id: chatId,
        sender_id: value.sender_id,
        text: value.text ?? value.message ?? '',
        media_url: value.media_url || value.imageUrl || value.fileUrl || null,
        media_type: value.media_type || value.type || null,
        reply_to: value.reply_to || null,
        is_deleted: value.is_deleted ?? false,
        created_at: value.created_at ? new Date(value.created_at).toISOString() : new Date().toISOString(),
      };
      try {
        await supabase.from('messages').upsert(row);
        const text = row.text || (row.media_url ? '📎 Media' : '');
        await supabase
          .from('chat_members')
          .update({
            last_message_text: text,
            last_message_at: row.created_at,
            last_message_sender_id: row.sender_id,
            last_message_is_read: false,
          })
          .eq('chat_id', chatId);
      } catch (e) {
        console.warn('[supabaseRealtimeDb] upsert message error', e);
      }
    }
    notify(`messages/${chatId}`, await loadPath(`messages/${chatId}`));
    return;
  }

  if (parts[0] === 'users' && parts.length === 2) {
    const userId = parts[1];
    if (value === null) {
      try {
        const client = supabaseAdmin || supabase;
        await client.from('profiles').delete().eq('id', userId);
        await client.from('app_kv').delete().eq('key', `user_meta/${userId}`);
      } catch (e) {
        console.warn('[supabaseRealtimeDb] delete profile error', e);
      }
      setLocalCache(r.path, null);
      notify(r.path, null);
      const currentUsers = (await loadPath('users')) || {};
      delete currentUsers[userId];
      setLocalCache('users', currentUsers);
      notify('users', currentUsers);
      return;
    }

    const patch: any = {};
    if ('isOnline' in value || 'is_online' in value) patch.is_online = value.isOnline ?? value.is_online;
    if ('lastSeen' in value || 'last_seen' in value) {
      const ls = value.lastSeen ?? value.last_seen;
      patch.last_seen = typeof ls === 'number' ? new Date(ls).toISOString() : ls;
    }
    if ('display_name' in value || 'displayName' in value || 'full_name' in value) {
      patch.full_name = value.full_name ?? value.display_name ?? value.displayName;
    }
    if ('photo_url' in value || 'photoURL' in value || 'avatar_url' in value) {
      patch.avatar_url = value.avatar_url ?? value.photo_url ?? value.photoURL;
    }
    if ('school_id' in value || 'schoolId' in value) patch.school_id = value.school_id ?? value.schoolId;
    if ('school_name' in value || 'schoolName' in value) patch.school_name = value.school_name ?? value.schoolName;
    if ('college_id' in value || 'collegeId' in value) patch.college_id = value.college_id ?? value.collegeId;
    if ('department_id' in value || 'departmentId' in value) patch.department_id = value.department_id ?? value.departmentId;
    if ('department_name' in value || 'departmentName' in value) patch.department_name = value.department_name ?? value.departmentName;
    if ('level' in value) patch.level = value.level;
    if ('current_streak' in value || 'streak' in value) patch.streak = value.streak ?? value.current_streak;
    if ('xp' in value) patch.xp = value.xp;
    if ('is_admin' in value) patch.is_admin = value.is_admin;
    if ('ai_credits_balance' in value || 'ai_credits' in value) {
      patch.ai_credits = value.ai_credits ?? value.ai_credits_balance;
    }
    if ('subscription_status' in value) {
      patch.is_paid_subscriber = value.subscription_status !== 'free' && value.subscription_status !== 'none';
      if (patch.ai_credits === undefined) {
        if (value.subscription_status === 'premium' || value.subscription_status === 'pro' || value.subscription_status === 'semester') {
          patch.ai_credits = 2500;
        } else if (value.subscription_status === 'basic' || value.subscription_status === 'weekly') {
          patch.ai_credits = 500;
        }
      }
    }
    if ('fcm_token' in value || 'fcmToken' in value) patch.fcm_token = value.fcm_token ?? value.fcmToken;
    patch.updated_at = new Date().toISOString();

    try {
      const client = supabaseAdmin || supabase;
      if (Object.keys(patch).length > 1) {
        await client.from('profiles').update(patch).eq('id', userId);
      }
      const metaToSave: any = {};
      if ('subscription_status' in value) metaToSave.subscription_status = value.subscription_status;
      if ('role' in value) metaToSave.role = value.role;
      if ('status' in value) metaToSave.status = value.status;
      if ('admin_department_ids' in value) metaToSave.admin_department_ids = value.admin_department_ids;
      if (Object.keys(metaToSave).length > 0) {
        await client.from('app_kv').upsert({
          key: `user_meta/${userId}`,
          value: metaToSave,
          updated_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.warn('[supabaseRealtimeDb] update profile error', e);
    }
    if (patch.ai_credits !== undefined) {
      notifyUserCreditsUpdated(userId, patch.ai_credits);
    }
    const finalVal = { 
      ...(getLocalCache(r.path) || {}), 
      ...value, 
      ...(patch.ai_credits !== undefined ? { ai_credits_balance: patch.ai_credits, ai_credits: patch.ai_credits } : {}) 
    };
    setLocalCache(r.path, finalVal);
    notify(r.path, finalVal);
    notify('users', await loadPath('users'));
    return;
  }

  // ── Handle schools_data in Supabase ──────────────────────────────────────
  if (parts[0] === 'schools_data') {
    const client = supabaseAdmin || supabase;
    if (value === null) {
      if (parts.length === 2) {
        const { error } = await client.from('schools').delete().eq('id', parts[1]);
        if (error) console.error('[supabaseRealtimeDb] delete school error:', error);
      } else if (parts.length === 4 && parts[2] === 'colleges') {
        const { error } = await client.from('colleges').delete().eq('id', parts[3]);
        if (error) console.error('[supabaseRealtimeDb] delete college error:', error);
      } else if (parts.length === 6 && parts[4] === 'departments') {
        const { error } = await client.from('departments').delete().eq('id', parts[5]);
        if (error) console.error('[supabaseRealtimeDb] delete department error:', error);
      }
    } else {
      if (parts.length === 2) {
        const { error } = await client.from('schools').upsert({
          id: parts[1],
          name: value.name || parts[1],
          short_name: value.short_name || value.code || value.name || parts[1],
        });
        if (error) {
          console.error('[supabaseRealtimeDb] upsert school error:', error);
          throw new Error(error.message);
        }
      } else if (parts.length === 4 && parts[2] === 'colleges') {
        // Ensure parent school exists in Supabase
        await client.from('schools').upsert({
          id: parts[1],
          name: parts[1].toUpperCase(),
          short_name: parts[1].toUpperCase(),
        }, { onConflict: 'id', ignoreDuplicates: true });

        const { error } = await client.from('colleges').upsert({
          id: parts[3],
          school_id: parts[1],
          name: typeof value === 'string' ? value : (value.name || parts[3]),
          short_name: value.short_name || value.code || parts[3],
        });
        if (error) {
          console.error('[supabaseRealtimeDb] upsert college error:', error);
          throw new Error(error.message);
        }
      } else if (parts.length === 6 && parts[4] === 'departments') {
        const school_id = parts[1];
        const college_id = parts[3];
        const dept_id = parts[5];

        // Ensure parent school exists in Supabase
        await client.from('schools').upsert({
          id: school_id,
          name: school_id.toUpperCase(),
          short_name: school_id.toUpperCase(),
        }, { onConflict: 'id', ignoreDuplicates: true });

        // Ensure parent college exists in Supabase
        await client.from('colleges').upsert({
          id: college_id,
          school_id: school_id,
          name: college_id.replace(/_/g, ' ').toUpperCase(),
          short_name: college_id.toUpperCase(),
        }, { onConflict: 'id', ignoreDuplicates: true });

        const { error } = await client.from('departments').upsert({
          id: dept_id,
          school_id: school_id,
          college_id: college_id,
          name: value.name || value.department_name || dept_id,
          short_name: value.short_name || value.code || dept_id,
        });
        if (error) {
          console.error('[supabaseRealtimeDb] upsert department error:', error);
          throw new Error(error.message);
        }
      } else if (parts.length === 7 && parts[4] === 'departments' && (parts[6] === 'name' || parts[6] === 'department_name')) {
        const { error } = await client.from('departments').update({
          name: typeof value === 'string' ? value : (value?.name || parts[5]),
        }).eq('id', parts[5]);
        if (error) {
          console.error('[supabaseRealtimeDb] rename department error:', error);
          throw new Error(error.message);
        }
      }
    }
    setLocalCache(r.path, value);
    notify(r.path, await loadPath(r.path));
    return;
  }

  // ── Handle departments_data in Supabase ──────────────────────────────────
  if (parts[0] === 'departments_data') {
    const client = supabaseAdmin || supabase;
    const deptId = parts[1];
    if (value === null) {
      if (parts.length === 2) {
        const { error } = await client.from('departments').delete().eq('id', deptId);
        if (error) console.error('[supabaseRealtimeDb] delete department error:', error);
      } else if (parts.length === 4 && parts[2] === 'course_list') {
        const { error } = await client.from('courses').delete().eq('id', parts[3]);
        if (error) console.error('[supabaseRealtimeDb] delete course error:', error);
      }
    } else {
      if (parts.length === 2) {
        const deptPayload: Record<string, any> = {
          id: deptId,
          name: value.department_name || value.name || deptId,
        };
        if (value.short_name || value.code) {
          deptPayload.short_name = value.short_name || value.code;
        }
        if (value.school_id) {
          deptPayload.school_id = value.school_id;
        }
        if (value.college_id) {
          deptPayload.college_id = value.college_id;
        }

        const { error } = await client.from('departments').upsert(deptPayload);
        if (error) {
          console.error('[supabaseRealtimeDb] upsert department_data error:', error);
          throw new Error(error.message);
        }

        if (value.course_list) {
          const courses = Array.isArray(value.course_list) ? value.course_list : Object.values(value.course_list);
          for (const c of courses) {
            if (!c) continue;
            const cId = (c.course_id || c.id || '').toString();
            if (!cId) continue;
            const { error: cErr } = await client.from('courses').upsert({
              id: cId,
              code: c.course_code || c.code || cId.toUpperCase(),
              title: c.course_name || c.title || cId,
              level: c.level || '100lvl',
              semester: c.semester === 'second' || c.semester === 2 ? 2 : 1,
              description: c.description || null,
              department_id: deptId,
              school_id: value.school_id || 'fupre',
            });
            if (cErr) console.error('[supabaseRealtimeDb] upsert course error:', cErr);

            if (Array.isArray(c.topics)) {
              for (let i = 0; i < c.topics.length; i++) {
                const t = c.topics[i];
                if (!t) continue;
                const tId = t.topic_id || t.id || `${cId}_topic_${i + 1}`;
                await client.from('topics').upsert({
                  id: tId,
                  course_id: cId,
                  topic_name: t.topic_name || `Topic ${i + 1}`,
                  topic_order: t.topic_order ?? (i + 1),
                  overview_json: {
                    overview: t.topic_context || '',
                    start_point: t.start_point || '',
                    end_point: t.end_point || '',
                    subtopics: t.subtopics || [],
                  },
                });
              }
            }
          }
        }
      } else if (parts.length === 3 && (parts[2] === 'department_name' || parts[2] === 'name')) {
        const { error } = await client.from('departments').update({
          name: typeof value === 'string' ? value : (value?.department_name || value?.name || deptId),
        }).eq('id', deptId);
        if (error) {
          console.error('[supabaseRealtimeDb] rename department error:', error);
          throw new Error(error.message);
        }
      } else if (parts.length === 3 && parts[2] === 'course_list') {
        const courses = Array.isArray(value) ? value : (value && typeof value === 'object' ? Object.values(value) : []);
        for (const c of courses) {
          if (!c) continue;
          const cId = (c.course_id || c.id || '').toString();
          if (!cId) continue;
          const { error: cErr } = await client.from('courses').upsert({
            id: cId,
            code: c.course_code || c.code || cId.toUpperCase(),
            title: c.course_name || c.title || cId,
            level: c.level || '100lvl',
            semester: c.semester === 'second' || c.semester === 2 ? 2 : 1,
            description: c.description || null,
            department_id: deptId,
            school_id: 'fupre',
          });
          if (cErr) console.error('[supabaseRealtimeDb] upsert course error:', cErr);

          if (Array.isArray(c.topics)) {
            for (let i = 0; i < c.topics.length; i++) {
              const t = c.topics[i];
              if (!t) continue;
              const tId = t.topic_id || t.id || `${cId}_topic_${i + 1}`;
              await client.from('topics').upsert({
                id: tId,
                course_id: cId,
                topic_name: t.topic_name || `Topic ${i + 1}`,
                topic_order: t.topic_order ?? (i + 1),
                overview_json: {
                  overview: t.topic_context || '',
                  start_point: t.start_point || '',
                  end_point: t.end_point || '',
                  subtopics: t.subtopics || [],
                },
              });
            }
          }
        }
      } else if (parts.length === 4 && parts[2] === 'course_list') {
        const c = value;
        if (c) {
          const cId = (parts[3] || c.course_id || c.id || '').toString();
          const { error: cErr } = await client.from('courses').upsert({
            id: cId,
            code: c.course_code || c.code || cId.toUpperCase(),
            title: c.course_name || c.title || cId,
            level: c.level || '100lvl',
            semester: c.semester === 'second' || c.semester === 2 ? 2 : 1,
            description: c.description || null,
            department_id: deptId,
            school_id: 'fupre',
          });
          if (cErr) console.error('[supabaseRealtimeDb] upsert course error:', cErr);
        }
      }
    }
    setLocalCache(r.path, value);
    notify(r.path, await loadPath(r.path));
    return;
  }

  // ── Handle global_courses in Supabase ────────────────────────────────────
  if (parts[0] === 'global_courses' && parts.length >= 2) {
    const client = supabaseAdmin || supabase;
    const courseId = parts[1];
    if (value === null) {
      if (parts.length === 2) {
        const { error } = await client.from('courses').delete().eq('id', courseId);
        if (error) console.error('[supabaseRealtimeDb] delete global_course error:', error);
      }
    } else {
      if (parts.length === 2) {
        const { error } = await client.from('courses').upsert({
          id: courseId,
          code: value.course_code || value.code || courseId.toUpperCase(),
          title: value.course_name || value.title || courseId,
          level: value.level || '100lvl',
          semester: value.semester === 'second' || value.semester === 2 ? 2 : 1,
          description: value.description || null,
          department_id: value.department_id || (Array.isArray(value.linked_departments) && value.linked_departments[0]) || null,
          school_id: value.school_id || 'fupre',
        });
        if (error) console.error('[supabaseRealtimeDb] upsert global_course error:', error);

        if (Array.isArray(value.topics)) {
          for (let i = 0; i < value.topics.length; i++) {
            const t = value.topics[i];
            if (!t) continue;
            const tId = t.topic_id || t.id || `${courseId}_topic_${i + 1}`;
            await client.from('topics').upsert({
              id: tId,
              course_id: courseId,
              topic_name: t.topic_name || `Topic ${i + 1}`,
              topic_order: t.topic_order ?? (i + 1),
              overview_json: {
                overview: t.topic_context || '',
                start_point: t.start_point || '',
                end_point: t.end_point || '',
                subtopics: t.subtopics || [],
              },
            });
          }
        }
      } else if (parts.length === 3 && parts[2] === 'topics') {
        const topicsList = Array.isArray(value) ? value : Object.values(value || {});
        for (let i = 0; i < topicsList.length; i++) {
          const t = topicsList[i];
          if (!t) continue;
          const tId = t.topic_id || t.id || `${courseId}_topic_${i + 1}`;
          await client.from('topics').upsert({
            id: tId,
            course_id: courseId,
            topic_name: t.topic_name || `Topic ${i + 1}`,
            topic_order: t.topic_order ?? (i + 1),
            overview_json: {
              overview: t.topic_context || '',
              start_point: t.start_point || '',
              end_point: t.end_point || '',
              subtopics: t.subtopics || [],
            },
          });
        }
      }
    }
    setLocalCache(r.path, value);
    notify(r.path, await loadPath(r.path));
    return;
  }

  // ── Handle app_settings in Supabase ──────────────────────────────────────
  if (parts[0] === 'app_settings' && parts.length >= 2) {
    const client = supabaseAdmin || supabase;
    const settingKey = parts[1];
    if (value === null) {
      await client.from('app_settings').delete().eq('key', settingKey);
    } else {
      if (parts.length === 2) {
        await client.from('app_settings').upsert({
          key: settingKey,
          value_json: typeof value === 'object' && value !== null ? value : { value },
          updated_at: new Date().toISOString(),
        });
      } else if (parts.length === 3) {
        const subKey = parts[2];
        const { data: existing } = await client.from('app_settings').select('value_json').eq('key', settingKey).maybeSingle();
        const base = (existing?.value_json && typeof existing.value_json === 'object') ? existing.value_json : {};
        base[subKey] = value;
        await client.from('app_settings').upsert({
          key: settingKey,
          value_json: base,
          updated_at: new Date().toISOString(),
        });
      }
    }
    setLocalCache(r.path, value);
    notify(r.path, await loadPath(r.path));
    return;
  }

  // ── Handle past_questions in Supabase ────────────────────────────────────
  if (parts[0] === 'past_questions' && parts.length >= 2) {
    const client = supabaseAdmin || supabase;
    const pqId = parts.slice(1).join('_');
    if (value === null) {
      await client.from('past_questions').delete().eq('id', pqId);
    } else {
      await client.from('past_questions').upsert({
        id: pqId,
        department_id: parts[1] || 'general',
        level: parts[2] || '100lvl',
        course_id: parts[3] || pqId,
        year: parts[4] || String(new Date().getFullYear()),
        questions_json: value,
        updated_at: new Date().toISOString(),
      });
    }
    setLocalCache(r.path, value);
    notify(r.path, await loadPath(r.path));
    return;
  }

  setLocalCache(r.path, value);
  notify(r.path, value);

  if (isAppKvAvailable !== false && isSupabaseConfigured) {
    try {
      const { error } = await supabase.from('app_kv').upsert({
        key: r.path,
        value: value,
        updated_at: new Date().toISOString(),
      });
      if (error && (error.code === '42P01' || (error as any).status === 404 || error.message?.includes('does not exist'))) {
        isAppKvAvailable = false;
        if (typeof window !== 'undefined' && window.sessionStorage) {
          window.sessionStorage.setItem('avelut_app_kv_missing', '1');
        }
      }
    } catch {
      isAppKvAvailable = false;
    }
  }
}

export async function update(r: DbRef, values: Record<string, any>): Promise<void> {
  // Multi-location update handler (e.g. update(dbRef(db), { 'schools_data/...': val, 'departments_data/...': val }))
  if (!r.path || Object.keys(values).some((k) => k.includes('/'))) {
    for (const [subPath, subVal] of Object.entries(values)) {
      const fullPath = r.path ? `${r.path}/${subPath}` : subPath;
      await set(ref(null, fullPath), subVal);
    }
    return;
  }

  const parts = parsePath(r.path);

  if (parts[0] === 'chat_meta_data' && parts[2] === 'typing' && parts.length >= 4) {
    await set(r, values);
    return;
  }

  if (parts[0] === 'chat_conversations' && parts.length === 3) {
    const [, userId, convoId] = parts;
    const parentList = { ...(getLocalCache(`chat_conversations/${userId}`) || {}) };
    const current = parentList[convoId] || getLocalCache(r.path) || {};
    const next = { ...current, ...values };
    parentList[convoId] = next;
    setLocalCache(`chat_conversations/${userId}`, parentList);
    setLocalCache(r.path, next);
    notify(`chat_conversations/${userId}`, parentList);
    notify(r.path, next);

    try {
      const client = supabaseAdmin || supabase;
      await client.from('app_kv').upsert({
        key: r.path,
        value: next,
        updated_at: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('[supabaseRealtimeDb] update chat_conversations error', e);
    }
    return;
  }


  if (parts[0] === 'users' && parts.length === 2) {
    const current = (await loadPath(r.path)) || getLocalCache(r.path) || {};
    await set(r, { ...current, ...values });
    return;
  }

  if (parts[0] === 'user_chats' && parts.length === 3) {
    const [, userId, chatId] = parts;
    const patch: any = {};
    if ('unreadCount' in values) patch.unread_count = values.unreadCount;
    if (values.last_message) {
      patch.last_message_text = values.last_message.text;
      patch.last_message_sender_id = values.last_message.sender_id;
      patch.last_message_is_read = values.last_message.isRead;
      patch.last_message_at = new Date().toISOString();
    }
    if ('timestamp' in values) patch.last_message_at = new Date(values.timestamp).toISOString();
    await supabase.from('chat_members').update(patch).eq('user_id', userId).eq('chat_id', chatId);
    notify(`user_chats/${userId}`, await loadPath(`user_chats/${userId}`));
    return;
  }

  const current = (await loadPath(r.path)) || {};
  const next = { ...current, ...values };
  await set(r, next);
}

export function push(r: DbRef, value?: any): DbRef & { key: string; ref: DbRef; then: any; catch: any } {
  const path = r?.path || (typeof r === 'string' ? r : '');
  const parts = parsePath(path);
  const key = crypto.randomUUID();
  const childPath = path ? `${path}/${key}` : key;
  const childRef: DbRef = { path: childPath };

  let promise: Promise<any>;

  if (value !== undefined) {
    if ((parts[0] === 'messages' || parts[0] === 'private_messages') && parts.length === 2) {
      const chatId = parts[1];
      const row = {
        id: key,
        chat_id: chatId,
        sender_id: value?.sender_id,
        text: value?.text ?? value?.message ?? '',
        media_url: value?.media_url || value?.imageUrl || value?.fileUrl || null,
        media_type: value?.media_type || value?.type || null,
        reply_to: value?.reply_to || null,
        is_deleted: false,
        created_at: new Date().toISOString(),
      };
      promise = (async () => {
        try {
          await supabase.from('messages').insert(row);
          const text = row.text || (row.media_url ? '📎 Media' : '');
          await supabase
            .from('chat_members')
            .update({
              last_message_text: text,
              last_message_at: row.created_at,
              last_message_sender_id: row.sender_id,
              last_message_is_read: false,
            })
            .eq('chat_id', chatId);

          try {
            const { data: members } = await supabase.from('chat_members').select('user_id, unread_count').eq('chat_id', chatId);
            for (const m of members || []) {
              if (m.user_id !== row.sender_id) {
                await supabase
                  .from('chat_members')
                  .update({ unread_count: (m.unread_count || 0) + 1 })
                  .eq('chat_id', chatId)
                  .eq('user_id', m.user_id);
              }
            }
          } catch {
            /* ignore */
          }
        } catch (e) {
          console.warn('[supabaseRealtimeDb] push message error', e);
        }
        notify(path, await loadPath(path));
      })();
    } else if (parts[0] === 'notifications' && parts.length === 2) {
      promise = (async () => {
        try {
          const metadata = {
            ...(typeof value?.metadata_json === 'object' && value?.metadata_json ? value.metadata_json : {}),
            ...(typeof value?.data === 'object' && value?.data ? value.data : {}),
            ...(value?.route ? { route: value.route } : {}),
            ...(value?.category ? { category: value.category } : {}),
            ...(value?.audience ? { audience: value.audience } : {}),
            ...(value?.timestamp ? { timestamp: value.timestamp } : {}),
          };
          await supabase.from('notifications').insert({
            id: key,
            user_id: parts[1],
            title: value?.title ?? null,
            message: value?.message || value?.body || '',
            type: value?.type || 'general',
            metadata_json: metadata,
            action_url: value?.action_url || value?.actionUrl || null,
            is_read: value?.is_read ?? false,
          });
        } catch (e) {
          console.warn('[supabaseRealtimeDb] push notification error', e);
        }
        notify(path, await loadPath(path));
      })();
    } else {
      promise = set(childRef, value);
    }
  } else {
    promise = Promise.resolve();
  }

  const result: any = {
    path: childPath,
    key,
    ref: childRef,
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
  };
  return result;
}

export async function remove(r: DbRef): Promise<void> {
  await set(r, null);
}

export function onDisconnect(r: DbRef) {
  return {
    update: async (values: Record<string, any>) => {
      if (typeof window === 'undefined') return;
      const handler = () => {
        void update(r, values);
      };
      window.addEventListener('pagehide', handler);
      window.addEventListener('beforeunload', handler);
    },
    set: async (value: any) => {
      if (typeof window === 'undefined') return;
      const handler = () => void set(r, value);
      window.addEventListener('pagehide', handler);
      window.addEventListener('beforeunload', handler);
    },
    remove: async () => {
      /* no-op */
    },
  };
}

export const db: any = { __supabaseRealtime: true };
