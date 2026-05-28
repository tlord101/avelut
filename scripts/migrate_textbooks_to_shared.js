import admin from 'firebase-admin';
import fs from 'fs';

// Usage:
// 1. Create a Firebase service account JSON and export its path:
//    export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
// 2. Set your RTDB URL:
//    export FIREBASE_DATABASE_URL="https://<your-project>.firebaseio.com"
// 3. Install dependency: npm i firebase-admin
// 4. Run: node scripts/migrate_textbooks_to_shared.js

const databaseURL = process.env.FIREBASE_DATABASE_URL;
if (!databaseURL) {
  console.error('FIREBASE_DATABASE_URL is not set. Set it to your Realtime Database URL.');
  process.exit(1);
}

try {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL
  });
} catch (e) {
  console.error('Failed to initialize firebase-admin:', e);
  process.exit(1);
}

const db = admin.database();

const normalizeLevel = (value) => {
  if (!value) return 'alllvl';
  const v = value.toString().toLowerCase().replace(/\s+/g, '');
  if (/^\d{3}lvl$/.test(v)) return v;
  const digits = v.match(/\d+/);
  if (digits && digits[0]) return `${digits[0]}lvl`;
  return 'alllvl';
};

const normalizeSemester = (s) => {
  if (!s) return 'first';
  const v = s.toString().toLowerCase();
  return v.includes('second') || v === '2' ? 'second' : 'first';
};

const normalizeTopicId = (value) => value ? value.toString().toLowerCase().replace(/\s+/g, '_').replace(/[^\w_]/g, '') : '';

const getCourseMergeKey = (course) => {
  const primaryLabel = (course?.course_code || course?.course_name || course?.course_id || '').toString().trim();
  const normalizedPrimaryLabel = normalizeTopicId(primaryLabel);
  if (!normalizedPrimaryLabel) return '';
  const normalizedLevel = course?.level ? normalizeLevel(course.level) : 'alllvl';
  const normalizedSemester = normalizeSemester(course?.semester);
  return `${normalizedPrimaryLabel}_${normalizedLevel}_${normalizedSemester}`;
};

(async () => {
  console.log('Starting migration: per-department textbook_contexts -> textbook_contexts/shared/...');
  const departmentsSnap = await db.ref('departments_data').get();
  const perDeptTextbooksSnap = await db.ref('textbook_contexts').get();

  const departments = departmentsSnap.exists() ? departmentsSnap.val() : {};
  const perDeptTextbooks = perDeptTextbooksSnap.exists() ? perDeptTextbooksSnap.val() : {};

  const sharedWrites = {};
  const deptCourseUpdates = {};

  for (const [deptId, deptValue] of Object.entries(departments)) {
    const courseList = Array.isArray(deptValue?.course_list) ? deptValue.course_list : (deptValue?.course_list || []);

    for (const course of courseList) {
      const courseName = course.course_name || course.course_id || '';
      const level = course.level || 'alllvl';
      const semester = course.semester || 'first';
      if (!courseName) continue;

      // Look for an existing per-department textbook entry
      const perDeptEntry = perDeptTextbooks?.[deptId]?.[level]?.[courseName];
      const courseObj = course;
      const courseKey = getCourseMergeKey(courseObj) || normalizeTopicId(courseName || `${deptId}_${level}`);

      // Build shared entry by merging if necessary
      if (perDeptEntry) {
        const existingShared = sharedWrites[courseKey] || {};
        const existingPdfs = Array.isArray(existingShared.pdf_urls) ? existingShared.pdf_urls : (existingShared.pdf_urls || []);
        const incomingPdfs = Array.isArray(perDeptEntry.pdf_urls) ? perDeptEntry.pdf_urls : (perDeptEntry.pdf_url ? [perDeptEntry.pdf_url] : []);
        const mergedPdfs = Array.from(new Set([...existingPdfs, ...incomingPdfs]));

        const existingSyllabus = Array.isArray(existingShared.syllabus) ? existingShared.syllabus : (existingShared.syllabus || []);
        const incomingSyllabus = Array.isArray(perDeptEntry.syllabus) ? perDeptEntry.syllabus : [];
        const mergedSyllabus = [...existingSyllabus];
        // Naive merge: append topics that don't already match by topic_id
        const existingIds = new Set(existingSyllabus.map(t => t.topic_id));
        for (const t of incomingSyllabus) {
          if (!t || !t.topic_id) continue;
          if (!existingIds.has(t.topic_id)) {
            mergedSyllabus.push(t);
            existingIds.add(t.topic_id);
          }
        }

        sharedWrites[courseKey] = {
          pdf_url: mergedPdfs[mergedPdfs.length - 1] || (existingShared.pdf_url || ''),
          pdf_urls: mergedPdfs,
          syllabus: mergedSyllabus,
          uploaded_at: Date.now(),
          course_key: courseKey,
          course_name: courseName,
          level,
          semester
        };
      }

      // Also mark course entry to reference shared key
      const deptUpdatePath = `departments_data/${deptId}/course_list`;
      if (!deptCourseUpdates[deptUpdatePath]) {
        // We'll rebuild the entire course_list for the dept later
        deptCourseUpdates[deptUpdatePath] = courseList.map(c => ({ ...c }));
      }
      // Find the course in the staged list and add textbook_shared_key
      const stagedList = deptCourseUpdates[deptUpdatePath];
      for (let i = 0; i < stagedList.length; i++) {
        const c = stagedList[i];
        const key = getCourseMergeKey(c) || normalizeTopicId(c.course_name || c.course_id || '');
        if (key === courseKey || (c.course_name && c.course_name === courseName)) {
          stagedList[i] = { ...c, textbook_shared_key: courseKey };
          break;
        }
      }
    }
  }

  // Write shared entries and update departments
  try {
    const updates = {};
    for (const [courseKey, sharedVal] of Object.entries(sharedWrites)) {
      updates[`textbook_contexts/shared/${courseKey}`] = sharedVal;
    }
    for (const [deptPath, updatedList] of Object.entries(deptCourseUpdates)) {
      updates[deptPath] = updatedList;
    }

    if (Object.keys(updates).length === 0) {
      console.log('No textbooks found to migrate.');
      process.exit(0);
    }

    console.log(`Writing ${Object.keys(updates).length} updates to database...`);
    await db.ref().update(updates);
    console.log('Migration finished successfully.');
  } catch (e) {
    console.error('Failed to write migration updates:', e);
    process.exit(1);
  }

  process.exit(0);
})();
