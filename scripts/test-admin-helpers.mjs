import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

// Node 22.13+; no installed app dependencies required.
const source = await readFile(new URL('../components/admin/courseAdminUtils.ts', import.meta.url), 'utf8');
const helpers = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);
const { getCourseAdminView, buildCourseManagerPath, buildCourseGlobalPath, buildCourseAddPath } = helpers;

for (const path of ['/', '/admin/dashboard', '/admin/schools', '/admin/questions', '/admin/courses/unknown']) {
  assert.deepEqual(getCourseAdminView(path), { mode: 'global' });
}
for (const path of ['/admin/courses', '/admin/courses/', '/admin/courses/manager', '/admin/courses/manager/engineering']) {
  assert.deepEqual(getCourseAdminView(path), { mode: 'manager-root' });
}
assert.deepEqual(getCourseAdminView('/admin/courses/add'), { mode: 'add', departmentId: undefined, level: undefined });
assert.deepEqual(getCourseAdminView(buildCourseAddPath('Engineering & Science', '200lvl')), {
  mode: 'add', departmentId: 'Engineering & Science', level: '200lvl',
});
assert.deepEqual(getCourseAdminView(buildCourseManagerPath('Engineering & Science', '200lvl')), {
  mode: 'manager-list', departmentId: 'Engineering & Science', level: '200lvl',
});
assert.deepEqual(getCourseAdminView(buildCourseManagerPath('Engineering & Science', '200lvl', 'CPE/211')), {
  mode: 'manager-detail', departmentId: 'Engineering & Science', level: '200lvl', courseId: 'CPE/211',
});
assert.deepEqual(getCourseAdminView(buildCourseGlobalPath()), { mode: 'global' });
assert.deepEqual(getCourseAdminView('/admin/courses/all/200lvl'), { mode: 'global-list', level: '200lvl' });
assert.deepEqual(getCourseAdminView(buildCourseGlobalPath('200lvl', 'CPE/211')), {
  mode: 'global-detail', level: '200lvl', courseId: 'CPE/211',
});

assert.equal(helpers.LEVELS.length, 5);
assert.equal(helpers.DEFAULT_SEMESTER, 'first');
assert.equal(helpers.normalizeLevel('200 level'), '200lvl');
for (const value of [undefined, null, false, 'invalid', []]) assert.deepEqual(helpers.normalizeCourseList(value), []);
const course = { course_id: 'cpe211', course_name: 'Engineering', course_code: 'CPE 211', level: '200lvl', semester: 'first', topics: [] };
const key = helpers.getCourseMergeKey(course);
assert.equal(key, 'cpe_211_200lvl_first');
assert.equal(helpers.matchesCourseIdentifier(course, key), true);
assert.equal(helpers.matchesCourseIdentifier(course, course.course_id), true);
assert.equal(helpers.matchesCourseIdentifier(course, 'missing'), false);
assert.equal(helpers.normalizeCourseList({ a: course, b: course }).length, 1);
assert.equal(helpers.upsertCourseInList([course], { ...course, course_name: 'Updated' })[0].course_name, 'Updated');

// Guard against another extraction that leaves the shell's helper imports unbound.
const shell = await readFile(new URL('../components/admin/AdminPanelShell.tsx', import.meta.url), 'utf8');
const imports = shell.match(/import\s*\{([^{}]+)\}\s*from\s*["']\.\/courseAdminUtils["']/);
assert.ok(imports, 'AdminPanelShell must import its helpers');
for (const name of imports[1].split(',').map(name => name.trim()).filter(Boolean)) {
  assert.notEqual(helpers[name], undefined, `Missing helper export: ${name}`);
}
assert.ok(imports[1].includes('getCourseAdminView'));
console.log('Admin helper regression tests passed.');
