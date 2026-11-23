CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    email text NOT NULL UNIQUE CHECK (email = lower(email) AND length(email) <= 254),
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organizations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization_memberships (
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX organization_memberships_user_idx
    ON organization_memberships (user_id, created_at, organization_id);

CREATE TABLE identity_sessions (
    token_hash text PRIMARY KEY,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (organization_id, user_id)
        REFERENCES organization_memberships(organization_id, user_id) ON DELETE CASCADE
);

CREATE INDEX identity_sessions_membership_idx ON identity_sessions (organization_id, user_id);
CREATE INDEX identity_sessions_expiration_idx ON identity_sessions (expires_at);

CREATE TABLE identity_login_attempts (
    email_hash text PRIMARY KEY,
    attempts smallint NOT NULL CHECK (attempts > 0),
    reset_at timestamptz NOT NULL
);

CREATE INDEX identity_login_attempts_expiration_idx ON identity_login_attempts (reset_at);

CREATE TABLE audit_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    metadata jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_organization_idx ON audit_events (organization_id, created_at DESC, id);
