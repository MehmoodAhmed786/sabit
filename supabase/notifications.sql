-- Notification system settings extension for user_settings
-- Safe to re-run.

ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS timezone text;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS pre_prayer_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS pre_prayer_minutes integer NOT NULL DEFAULT 10;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS incomplete_prayer_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS incomplete_prayer_delay_minutes integer NOT NULL DEFAULT 60;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS daily_completion_enabled boolean NOT NULL DEFAULT true;

-- Ensure social notification columns exist (may already be from friends-challenges.sql)
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS challenge_notifications boolean NOT NULL DEFAULT true;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS friend_request_notifications boolean NOT NULL DEFAULT true;

-- Optional device tokens for future push (RLS: own rows only)
CREATE TABLE IF NOT EXISTS public.device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token text NOT NULL,
  platform text NOT NULL DEFAULT 'web',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, token)
);

ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "device_tokens_own" ON public.device_tokens;
CREATE POLICY "device_tokens_own" ON public.device_tokens
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Allow profile read for pending friend requests + challenge invites (notification display names)
DROP POLICY IF EXISTS "profiles_select_friends" ON public.profiles;
CREATE POLICY "profiles_select_friends" ON public.profiles
  FOR SELECT USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM public.friends f
      WHERE f.status = 'accepted'
        AND (
          (f.requester_id = auth.uid() AND f.receiver_id = profiles.id)
          OR (f.receiver_id = auth.uid() AND f.requester_id = profiles.id)
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.friends f
      WHERE f.status = 'pending'
        AND f.requester_id = profiles.id
        AND f.receiver_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.challenge_members cm
      JOIN public.friend_challenges fc ON fc.id = cm.challenge_id
      WHERE cm.user_id = auth.uid()
        AND cm.status = 'invited'
        AND fc.creator_id = profiles.id
    )
  );
