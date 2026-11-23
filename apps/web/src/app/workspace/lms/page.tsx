import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession, IdentityError } from "@/server/identity";
import {
  addLesson, createCourse, enroll, finishLesson, getCourse, isLmsId,
  listCourses, lmsPageSize, maxCourseLessons, publishCourse,
} from "@/server/lms";

export const metadata = { title: "Learning" };

const root = "/workspace/lms";
const lastPage = 10000;
const feedback: Record<string, string> = {
  saved: "Saved.",
  missing: "That course or lesson is unavailable.",
  invalid: "Check the required fields and their length.",
  forbidden: "You do not have permission to make this change.",
  published: "The course is already published.",
  empty: "Add at least one lesson before publishing.",
  full: `A course can contain up to ${maxCourseLessons} lessons.`,
  already: "No change was needed.",
  previous: "Complete the earlier lessons first.",
  "workspace-changed": "The active workspace changed. Open the intended workspace to continue.",
};

function courseLink(course: string, lesson?: string, result?: string) {
  const params = new URLSearchParams({ course });
  if (lesson) params.set("lesson", lesson);
  if (result) params.set("result", result);
  return `${root}?${params}`;
}

async function save(organizationId: string, form: FormData) {
  "use server";
  const course = String(form.get("course") ?? "");
  const lesson = String(form.get("lesson") ?? "");
  const title = String(form.get("title") ?? "");
  const operation = form.get("operation");
  let result: { state: string; courseId?: string };
  try {
    switch (operation) {
      case "create":
        result = await createCourse(organizationId, title, String(form.get("description") ?? ""));
        break;
      case "add-lesson":
        result = await addLesson(organizationId, course, title, String(form.get("body") ?? ""));
        break;
      case "publish":
        result = await publishCourse(organizationId, course);
        break;
      case "enroll":
        result = await enroll(organizationId, course);
        break;
      case "complete":
        result = await finishLesson(organizationId, course, lesson);
        break;
      default:
        result = { state: "invalid" };
    }
  } catch (error) {
    if (!(error instanceof IdentityError)) throw error;
    if (error.code === "UNAUTHENTICATED") redirect("/login");
    if (error.code !== "FORBIDDEN") throw error;
    redirect(`${root}?result=workspace-changed`);
  }

  const courseId = result.courseId ?? course;
  redirect(isLmsId(courseId)
    ? courseLink(courseId, isLmsId(lesson) ? lesson : undefined, result.state)
    : `${root}?result=${result.state}`);
}

function Status({ result }: { result?: string }) {
  if (!result || !Object.hasOwn(feedback, result)) return null;
  const success = result === "saved" || result === "already";
  return <p className={success ? "notice" : "notice error"} role={success ? "status" : "alert"}>{feedback[result]}</p>;
}

function CourseField({ id, operation }: { id: string; operation: string }) {
  return <>
    <input type="hidden" name="course" value={id} />
    <input type="hidden" name="operation" value={operation} />
  </>;
}

function NoAccess() {
  return <p className="notice">Your workspace subscription does not currently include Learning.</p>;
}

export default async function Learning({ searchParams }: {
  searchParams: Promise<{ course?: string; lesson?: string; page?: string; result?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const canTeach = session.role === "owner" || session.role === "admin";
  const action = save.bind(null, session.organizationId);
  const { course: id, lesson: lessonId, page: rawPage, result } = await searchParams;
  if ((id !== undefined && !isLmsId(id)) || (lessonId !== undefined && (!id || !isLmsId(lessonId)))) notFound();

  if (id) {
    const { allowed, course, lessons } = await getCourse(session.organizationId, id, lessonId);
    if (!allowed) return <NoAccess />;
    if (!course) notFound();
    const selected = lessonId ? lessons.find((lesson) => lesson.id === lessonId) : undefined;
    if (lessonId && !selected) notFound();
    const activeLesson = lessons.find((lesson) => !lesson.complete);
    const complete = lessons.filter((lesson) => lesson.complete).length;

    return <>
      <header className="page-heading">
        <Link href={root}>All courses</Link>
        <h1>{course.title}</h1>
        {course.description && <p>{course.description}</p>}
        <p>{course.published ? "Published" : "Draft"}</p>
      </header>
      <Status result={result} />
      {course.published && !course.enrolled && <section className="panel">
        <h2>Start learning</h2>
        <form action={action}>
          <CourseField id={id} operation="enroll" />
          <button type="submit">Enroll in this course</button>
        </form>
      </section>}
      {course.enrolled && <section className="panel">
        <h2>Course progress</h2>
        <p>{complete} of {lessons.length} lessons complete</p>
        {activeLesson && <Link href={courseLink(id, activeLesson.id)}>Continue to {activeLesson.title}</Link>}
      </section>}
      <section className="panel">
        <h2>Lessons</h2>
        {lessons.length === 0 ? <p>No lessons yet.</p> :
          <ol>{lessons.map((lesson) => <li key={lesson.id}>
            {course.enrolled || canTeach
              ? <Link href={courseLink(id, lesson.id)} aria-current={lesson.id === lessonId ? "page" : undefined}>{lesson.title}</Link>
              : lesson.title}
            {lesson.complete && " (complete)"}
          </li>)}</ol>}
      </section>
      {selected?.body && <section className="panel">
        <h2>{selected.title}</h2>
        <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{selected.body}</p>
        {course.enrolled && selected.id === activeLesson?.id && <form action={action}>
          <CourseField id={id} operation="complete" />
          <input type="hidden" name="lesson" value={selected.id} />
          <button type="submit">Mark lesson complete</button>
        </form>}
      </section>}
      {canTeach && !course.published && <>
        {lessons.length < maxCourseLessons && <section className="panel">
          <h2>Add a lesson</h2>
          <form className="fields" action={action}>
            <CourseField id={id} operation="add-lesson" />
            <label>Title<input name="title" maxLength={120} required /></label>
            <label>Lesson text<textarea name="body" rows={8} maxLength={12000} required /></label>
            <button type="submit">Add lesson</button>
          </form>
        </section>}
        {lessons.length > 0 && <section className="panel">
          <h2>Publish course</h2>
          <p>Publishing opens this course for enrollment and locks its lesson list.</p>
          <form action={action}>
            <CourseField id={id} operation="publish" />
            <button type="submit">Publish course</button>
          </form>
        </section>}
      </>}
    </>;
  }

  const inputPage = Number(rawPage ?? "1");
  const page = Number.isInteger(inputPage) && inputPage > 0 && inputPage <= lastPage ? inputPage : 1;
  const { allowed, courses } = await listCourses(session.organizationId, page);
  if (!allowed) return <NoAccess />;
  const more = courses.length > lmsPageSize && page < lastPage;

  return <>
    <header className="page-heading"><h1>Learning</h1></header>
    <Status result={result} />
    {canTeach && <section className="panel">
      <h2>Create a course</h2>
      <form className="fields" action={action}>
        <input type="hidden" name="operation" value="create" />
        <label>Course title<input name="title" maxLength={120} required /></label>
        <label>Description<textarea name="description" rows={3} maxLength={600} /></label>
        <button type="submit">Create draft</button>
      </form>
    </section>}
    <section className="panel">
      <h2>Courses</h2>
      {courses.length === 0 ? <p>No courses on this page.</p> :
        <div className="table-scroll"><table>
          <thead><tr><th scope="col">Title</th><th scope="col">Status</th></tr></thead>
          <tbody>{courses.slice(0, lmsPageSize).map((course) => <tr key={course.id}>
            <th scope="row"><Link href={courseLink(course.id)}>{course.title}</Link></th>
            <td>{course.enrolled ? "Enrolled" : course.published ? "Open for enrollment" : "Draft"}</td>
          </tr>)}</tbody>
        </table></div>}
      {(page > 1 || more) && <nav className="pagination" aria-label="Course pages">
        {page > 1 && <Link href={`${root}?page=${page - 1}`}>Previous</Link>}
        <span>Page {page}</span>
        {more && <Link href={`${root}?page=${page + 1}`}>Next</Link>}
      </nav>}
    </section>
  </>;
}
