INSERT INTO plan_modules (plan_code, module_code)
SELECT code, 'lms' FROM subscription_plans ON CONFLICT DO NOTHING;

CREATE TABLE lms_courses (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 120),
  description text NOT NULL CHECK (char_length(description) <= 600),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id)
);

CREATE INDEX lms_courses_recent ON lms_courses (organization_id, created_at DESC, id DESC);

CREATE TABLE lms_lessons (
  organization_id uuid NOT NULL,
  course_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 50),
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 120),
  body text NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 12000),
  PRIMARY KEY (organization_id, course_id, id),
  UNIQUE (organization_id, course_id, position),
  FOREIGN KEY (organization_id, course_id) REFERENCES lms_courses (organization_id, id) ON DELETE CASCADE
);

CREATE TABLE lms_enrollments (
  organization_id uuid NOT NULL,
  course_id uuid NOT NULL,
  user_id uuid NOT NULL,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, course_id, user_id),
  FOREIGN KEY (organization_id, course_id) REFERENCES lms_courses (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, user_id) REFERENCES organization_memberships (organization_id, user_id) ON DELETE CASCADE
);

CREATE INDEX lms_enrollments_member ON lms_enrollments (organization_id, user_id);

CREATE TABLE lms_lesson_progress (
  organization_id uuid NOT NULL,
  course_id uuid NOT NULL,
  user_id uuid NOT NULL,
  lesson_id uuid NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, course_id, user_id, lesson_id),
  FOREIGN KEY (organization_id, course_id, user_id)
    REFERENCES lms_enrollments (organization_id, course_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, course_id, lesson_id)
    REFERENCES lms_lessons (organization_id, course_id, id) ON DELETE CASCADE
);

CREATE INDEX lms_lesson_progress_lesson ON lms_lesson_progress (organization_id, course_id, lesson_id);
