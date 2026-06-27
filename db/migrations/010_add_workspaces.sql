CREATE TABLE IF NOT EXISTS public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.workspace_members (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id),
  CONSTRAINT workspace_members_role_check CHECK (role IN ('owner', 'admin', 'member'))
);

CREATE INDEX IF NOT EXISTS workspaces_owner_idx
  ON public.workspaces (owner_id);

CREATE INDEX IF NOT EXISTS workspace_members_user_idx
  ON public.workspace_members (user_id);

-- Scope knowledge bases to an owner + workspace (matches lib/db/schema/core.ts).
-- Add nullable first, backfill existing rows, then tighten — same pattern as 003.
ALTER TABLE public.knowledge_bases
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.knowledge_bases
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;

DO $$
DECLARE
  first_user_id uuid;
  target_workspace_id uuid;
BEGIN
  -- Heuristic backfill: assign pre-existing knowledge bases to the earliest
  -- registered user (there was no per-KB owner before this migration).
  SELECT id INTO first_user_id
  FROM public.users
  ORDER BY created_at, id
  LIMIT 1;

  IF first_user_id IS NOT NULL THEN
    SELECT workspace_id INTO target_workspace_id
    FROM public.workspace_members
    WHERE user_id = first_user_id
    ORDER BY created_at
    LIMIT 1;

    -- A user created before the workspace feature has no workspace yet.
    IF target_workspace_id IS NULL THEN
      INSERT INTO public.workspaces (name, owner_id)
      VALUES ('My Workspace', first_user_id)
      RETURNING id INTO target_workspace_id;

      INSERT INTO public.workspace_members (workspace_id, user_id, role)
      VALUES (target_workspace_id, first_user_id, 'owner');
    END IF;

    UPDATE public.knowledge_bases
    SET user_id = first_user_id,
        workspace_id = target_workspace_id
    WHERE user_id IS NULL OR workspace_id IS NULL;
  END IF;

  -- The 'Default Knowledge Base' seeded by 003 has no owner. Under per-workspace
  -- ownership there is no global default, so drop it if it is still unclaimed
  -- (e.g. a fresh DB with no users). Owned knowledge bases are untouched.
  DELETE FROM public.knowledge_bases
  WHERE name = 'Default Knowledge Base'
    AND (user_id IS NULL OR workspace_id IS NULL);
END $$;

-- Any remaining NULL here is an unexpected orphan; SET NOT NULL fails loudly
-- rather than silently dropping data.
ALTER TABLE public.knowledge_bases
  ALTER COLUMN user_id SET NOT NULL,
  ALTER COLUMN workspace_id SET NOT NULL;
