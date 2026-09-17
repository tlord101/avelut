import type { Topic, Course } from '../../types';

export const normalizeLevelValue = (value?: string): string => {
  if (!value) return '';
  return value.toLowerCase().replace(/\s+/g, '').replace(/level/g, '').replace(/lvl/g, '');
};

export const normalizeDepartmentValue = (value?: string): string => {
  if (!value) return '';
  return value.toLowerCase().trim().replace(/[\s-]+/g, '_').replace(/[^\w_]/g, '');
};

export const normalizeTopicId = (value: string) =>
  value.toLowerCase().replace(/\s+/g, '_').replace(/[^\w_]/g, '');

export const sanitizeTopicMetadata = (topic: any, index: number): Topic => {
  const topicName = (topic?.topic_name || topic?.name || '').toString().trim() || `Topic ${index + 1}`;
  const rawTopicId = (topic?.topic_id || '').toString().trim();
  return {
    topic_name: topicName,
    topic_id: rawTopicId || normalizeTopicId(topicName),
    topic_context: (topic?.topic_context || topic?.context || '').toString().trim(),
    start_point: (topic?.start_point || topic?.start || '').toString().trim(),
    end_point: (topic?.end_point || topic?.end || '').toString().trim(),
    is_complete: Boolean(topic?.is_complete),
  };
};

export const normalizeCourse = (course: any, fallbackCourseId = '', fallbackLevel = ''): Course | null => {
  if (!course || typeof course !== 'object') return null;
  const course_name = (course.course_name || '').toString().trim();
  if (!course_name) return null;
  const course_id = (course.course_id || fallbackCourseId || course_name.toLowerCase().replace(/\s+/g, '_')).toString();
  return {
    ...course,
    course_id,
    course_name,
    level: (course.level || fallbackLevel || '').toString(),
    topics: Array.isArray(course.topics) ? course.topics : [],
  } as Course;
};

export const formatDuration = (seconds: number): string => {
  if (!seconds || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

export const formatLastVisited = (timestamp?: number | null): string | null => {
  if (!timestamp) return null;
  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return 'Visited just now';
  if (diffMinutes < 60) return `Visited ${diffMinutes}m ago`;
  if (diffHours < 24) return `Visited ${diffHours}h ago`;
  if (diffDays === 1) return 'Visited yesterday';
  if (diffDays < 7) return `Visited ${diffDays}d ago`;
  return `Visited ${new Date(timestamp).toLocaleDateString()}`;
};
