-- Invite codes for joining a workspace. Tokens are unguessable 128-bit values
-- stored plaintext — same threat posture as session ids in public.sessions.
CREATE TABLE IF NOT EXISTS public.workspace_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  token text NOT NULL,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_invites_role_check CHECK (role IN ('admin', 'member'))
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_invites_token_unique
  ON public.workspace_invites (token);

CREATE INDEX IF NOT EXISTS workspace_invites_workspace_idx
  ON public.workspace_invites (workspace_id);

-- DB-level backstop for the single-owner invariant: at most one owner row per
-- workspace. Application code additionally guards updates/deletes with a
-- role != 'owner' predicate.
CREATE UNIQUE INDEX IF NOT EXISTS workspace_members_single_owner_idx
  ON public.workspace_members (workspace_id)
  WHERE role = 'owner';
