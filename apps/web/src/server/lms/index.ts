import "server-only";
import { pool, transaction } from "@/server/db";
import type { PoolClient } from "pg";
import { requireMembership } from "@/server/identity";

const access = `
  FROM organization_subscriptions s
  JOIN plan_modules p ON p.plan_code = s.plan_code AND p.module_code = 'lms'
  JOIN organization_memberships m ON m.organization_id = s.organization_id AND m.user_id = $2
  WHERE s.organization_id = $1 AND s.status IN ('trialing', 'active') AND s.access_until > now()
`;

type Course = { id: string; title: string; description: string; published: boolean; enrolled: boolean };
type Lesson = { id: string; title: string; position: number; complete: boolean; body: string | null };
type Scope = readonly [organizationId: string, userId: string];
type ErrorResult = "missing" | "invalid" | "forbidden" | "published" | "empty" | "full" | "already" | "previous";
type MutationResult = { courseId: string; state: "saved" } | { state: ErrorResult };

export const lmsPageSize = 25;
export const maxCourseLessons = 50;

export function isLmsId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
}

export async function listCourses(organizationId: string, page: number) {
  const { userId } = await requireMembership(organizationId);
  const { rows } = await pool.query<{ allowed: boolean; courses: Course[] }>(`
    WITH access AS (SELECT m.role ${access}), entries AS (
      SELECT c.id, c.title, c.description, c.published_at IS NOT NULL AS published,
        e.user_id IS NOT NULL AS enrolled, c.created_at
      FROM lms_courses c CROSS JOIN access
      LEFT JOIN lms_enrollments e ON e.organization_id = c.organization_id
        AND e.course_id = c.id AND e.user_id = $2
      WHERE c.organization_id = $1
        AND (c.published_at IS NOT NULL OR access.role IN ('owner', 'admin'))
      ORDER BY c.created_at DESC, c.id DESC LIMIT $3 OFFSET $4
    )
    SELECT EXISTS (SELECT 1 FROM access) AS allowed,
      COALESCE((SELECT json_agg(entries ORDER BY created_at DESC, id DESC) FROM entries), '[]') AS courses
  `, [organizationId, userId, lmsPageSize + 1, (page - 1) * lmsPageSize]);
  return rows[0];
}

export async function getCourse(organizationId: string, courseId: string, lessonId?: string) {
  const { userId } = await requireMembership(organizationId);
  const { rows } = await pool.query<{ allowed: boolean; course: Course | null; lessons: Lesson[] }>(`
    WITH access AS (SELECT m.role ${access}), course AS (
      SELECT c.id, c.title, c.description, c.published_at IS NOT NULL AS published,
        e.user_id IS NOT NULL AS enrolled, access.role IN ('owner', 'admin') AS can_preview
      FROM lms_courses c CROSS JOIN access
      LEFT JOIN lms_enrollments e ON e.organization_id = c.organization_id
        AND e.course_id = c.id AND e.user_id = $2
      WHERE c.organization_id = $1 AND c.id = $3
        AND (c.published_at IS NOT NULL OR access.role IN ('owner', 'admin'))
    ), lessons AS (
      SELECT l.id, l.title, l.position, progress.lesson_id IS NOT NULL AS complete,
        CASE WHEN l.id = $4 AND (course.enrolled OR course.can_preview) THEN l.body END AS body
      FROM lms_lessons l JOIN course ON course.id = l.course_id
      LEFT JOIN lms_lesson_progress progress ON progress.organization_id = l.organization_id
        AND progress.course_id = l.course_id AND progress.lesson_id = l.id AND progress.user_id = $2
      WHERE l.organization_id = $1
    )
    SELECT EXISTS (SELECT 1 FROM access) AS allowed,
      (SELECT row_to_json(course) FROM course) AS course,
      COALESCE((SELECT json_agg(lessons ORDER BY position) FROM lessons), '[]') AS lessons
  `, [organizationId, userId, courseId, lessonId ?? null]);
  return rows[0];
}

type RecordChange = { target: "course" | "lesson" | "enrollment"; id: string; courseId: string; action: string };

async function update(
  organizationId: string,
  write: (client: PoolClient, scope: Scope) => Promise<RecordChange | ErrorResult>,
  editCourse = true,
): Promise<MutationResult> {
  const { userId } = await requireMembership(organizationId);
  const scope = [organizationId, userId] as const;
  return transaction<MutationResult>(async (client) => {
    const { rows } = await client.query<{ role: string }>(`
      SELECT m.role ${access} FOR SHARE OF s, p, m
    `, [...scope]);
    if (!rows[0] || (editCourse && rows[0].role === "member")) return { state: "forbidden" };

    const change = await write(client, scope);
    if (typeof change === "string") return { state: change };
    await client.query(`
      INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
      VALUES ($1, $2, $3, $4, $5, jsonb_build_object('courseId', $6::uuid))
    `, [...scope, `lms.${change.target}.${change.action}`, `lms_${change.target}`, change.id, change.courseId]);
    return { courseId: change.courseId, state: "saved" };
  });
}

function validateText(input: string, maxLength: number, allowEmpty = false) {
  const text = input.trim();
  return text.length <= maxLength && !text.includes("\0") && (allowEmpty || text.length > 0) ? text : null;
}

export async function createCourse(organizationId: string, rawTitle: string, rawDescription: string): Promise<MutationResult> {
  const title = validateText(rawTitle, 120);
  const description = validateText(rawDescription, 600, true);
  if (title === null || description === null) return { state: "invalid" };

  return update(organizationId, async (client, [org]) => {
    const { rows } = await client.query<{ id: string }>(`
      INSERT INTO lms_courses (organization_id, title, description) VALUES ($1, $2, $3) RETURNING id
    `, [org, title, description]);
    return { target: "course", id: rows[0].id, courseId: rows[0].id, action: "created" };
  });
}

async function lockCourse(client: PoolClient, org: string, courseId: string) {
  const { rows } = await client.query<{ published: boolean }>(`
    SELECT published_at IS NOT NULL AS published FROM lms_courses
    WHERE organization_id = $1 AND id = $2 FOR UPDATE
  `, [org, courseId]);
  return rows[0];
}

export async function addLesson(organizationId: string, courseId: string, rawTitle: string, rawBody: string): Promise<MutationResult> {
  const title = validateText(rawTitle, 120);
  const body = validateText(rawBody, 12000);
  if (!isLmsId(courseId) || title === null || body === null) return { state: "invalid" };

  return update(organizationId, async (client, [org]) => {
    const course = await lockCourse(client, org, courseId);
    if (!course) return "missing";
    if (course.published) return "published";
    const { rows } = await client.query<{ id: string }>(`
      WITH following AS (
        SELECT COALESCE(MAX(position), 0) + 1 AS position
        FROM lms_lessons WHERE organization_id = $1 AND course_id = $2
      )
      INSERT INTO lms_lessons (organization_id, course_id, position, title, body)
      SELECT $1, $2, following.position, $3, $4 FROM following WHERE following.position <= $5
      RETURNING id
    `, [org, courseId, title, body, maxCourseLessons]);
    return rows[0] ? { target: "lesson", id: rows[0].id, courseId, action: "added" } : "full";
  });
}

export async function publishCourse(organizationId: string, courseId: string): Promise<MutationResult> {
  if (!isLmsId(courseId)) return { state: "invalid" };
  return update(organizationId, async (client, [org]) => {
    const course = await lockCourse(client, org, courseId);
    if (!course) return "missing";
    if (course.published) return "published";
    const { rowCount } = await client.query(`
      UPDATE lms_courses c SET published_at = now()
      WHERE c.organization_id = $1 AND c.id = $2
        AND EXISTS (SELECT 1 FROM lms_lessons l WHERE l.organization_id = c.organization_id AND l.course_id = c.id)
    `, [org, courseId]);
    return rowCount ? { target: "course", id: courseId, courseId, action: "published" } : "empty";
  });
}

export async function enroll(organizationId: string, courseId: string): Promise<MutationResult> {
  if (!isLmsId(courseId)) return { state: "invalid" };
  return update(organizationId, async (client, [org, userId]) => {
    const { rowCount } = await client.query(`
      INSERT INTO lms_enrollments (organization_id, course_id, user_id)
      SELECT organization_id, id, $3 FROM lms_courses
      WHERE organization_id = $1 AND id = $2 AND published_at IS NOT NULL
      ON CONFLICT DO NOTHING
    `, [org, courseId, userId]);
    return rowCount ? { target: "enrollment", id: userId, courseId, action: "enrolled" } : "already";
  }, false);
}

export async function finishLesson(organizationId: string, courseId: string, lessonId: string): Promise<MutationResult> {
  if (!isLmsId(courseId) || !isLmsId(lessonId)) return { state: "invalid" };
  return update(organizationId, async (client, [org, userId]) => {
    const params = [org, courseId, userId, lessonId];
    const { rows } = await client.query<{ position: number }>(`
      SELECT l.position FROM lms_enrollments e
      JOIN lms_lessons l ON l.organization_id = e.organization_id AND l.course_id = e.course_id
      WHERE e.organization_id = $1 AND e.course_id = $2 AND e.user_id = $3 AND l.id = $4
      FOR UPDATE OF e
    `, params);
    if (!rows[0]) return "missing";
    const { rowCount } = await client.query(`
      INSERT INTO lms_lesson_progress (organization_id, course_id, user_id, lesson_id)
      SELECT $1, $2, $3, $4
      WHERE NOT EXISTS (
        SELECT 1 FROM lms_lessons earlier
        WHERE earlier.organization_id = $1 AND earlier.course_id = $2 AND earlier.position < $5
          AND NOT EXISTS (
            SELECT 1 FROM lms_lesson_progress progress
            WHERE progress.organization_id = $1 AND progress.course_id = $2
              AND progress.user_id = $3 AND progress.lesson_id = earlier.id
          )
      )
      ON CONFLICT DO NOTHING
    `, [...params, rows[0].position]);
    if (rowCount) return { target: "lesson", id: lessonId, courseId, action: "completed" };

    const completed = await client.query(`
      SELECT 1 FROM lms_lesson_progress
      WHERE organization_id = $1 AND course_id = $2 AND user_id = $3 AND lesson_id = $4
    `, params);
    return completed.rowCount ? "already" : "previous";
  }, false);
}
