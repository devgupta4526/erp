INSERT INTO plan_modules (plan_code, module_code)
SELECT code, 'design' FROM subscription_plans
ON CONFLICT DO NOTHING;

CREATE TABLE design_projects (
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    width integer NOT NULL CHECK (width BETWEEN 64 AND 2048),
    height integer NOT NULL CHECK (height BETWEEN 64 AND 2048),
    background text NOT NULL CHECK (background ~ '^#[0-9A-F]{6}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, id)
);

CREATE INDEX design_projects_recent ON design_projects (organization_id, created_at DESC, id DESC);

CREATE TABLE design_layers (
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    layer_order integer NOT NULL CHECK (layer_order > 0),
    kind text NOT NULL CHECK (kind IN ('text', 'rectangle')),
    x integer NOT NULL CHECK (x BETWEEN 0 AND 2047),
    y integer NOT NULL CHECK (y BETWEEN 0 AND 2047),
    width integer NOT NULL CHECK (width BETWEEN 1 AND 2048),
    height integer NOT NULL CHECK (height BETWEEN 1 AND 2048),
    color text NOT NULL CHECK (color ~ '^#[0-9A-F]{6}$'),
    content text,
    font_size integer,
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    PRIMARY KEY (organization_id, project_id, id),
    CONSTRAINT design_layers_order UNIQUE (organization_id, project_id, layer_order) DEFERRABLE,
    FOREIGN KEY (organization_id, project_id) REFERENCES design_projects(organization_id, id) ON DELETE CASCADE,
    CHECK (
      (kind = 'rectangle' AND content IS NULL AND font_size IS NULL)
      OR (kind = 'text' AND content IS NOT NULL AND char_length(content) BETWEEN 1 AND 240
        AND font_size IS NOT NULL AND font_size BETWEEN 8 AND 200)
    )
);
