-- Friends & Private Challenges for Sabit
-- Run in Supabase SQL Editor after setup.sql / base schema exists.
-- Safe to re-run (IF NOT EXISTS / DROP POLICY IF EXISTS).

-- ---------------------------------------------------------------------------
-- Profile invite codes (for friend search)
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS invite_code text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_invite_code_idx ON public.profiles (invite_code) WHERE invite_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_idx ON public.profiles (lower(username));

UPDATE public.profiles
SET invite_code = substring(replace(gen_random_uuid()::text, '-', ''), 1, 8)
WHERE invite_code IS NULL;

-- ---------------------------------------------------------------------------
-- Privacy / social settings on user_settings
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS allow_friend_challenges boolean NOT NULL DEFAULT true;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS allow_friends_see_challenge_progress boolean NOT NULL DEFAULT true;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS allow_friend_requests boolean NOT NULL DEFAULT true;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS challenge_notifications boolean NOT NULL DEFAULT true;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS friend_request_notifications boolean NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- Friends
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.friends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  receiver_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'blocked')),
  blocked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  CONSTRAINT friends_no_self CHECK (requester_id <> receiver_id),
  CONSTRAINT friends_unique_pair UNIQUE (requester_id, receiver_id)
);

CREATE INDEX IF NOT EXISTS friends_requester_idx ON public.friends (requester_id);
CREATE INDEX IF NOT EXISTS friends_receiver_idx ON public.friends (receiver_id);

-- ---------------------------------------------------------------------------
-- Friend challenges
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.friend_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'consistency' CHECK (type IN ('consistency')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT friend_challenges_dates CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS public.challenge_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES public.friend_challenges(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited', 'accepted', 'declined', 'left')),
  UNIQUE (challenge_id, user_id)
);

-- Backfill columns if challenge_members existed from an earlier/partial migration
ALTER TABLE public.challenge_members ADD COLUMN IF NOT EXISTS joined_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.challenge_members ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'invited';

ALTER TABLE public.friends ADD COLUMN IF NOT EXISTS blocked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.friends ADD COLUMN IF NOT EXISTS accepted_at timestamptz;

ALTER TABLE public.friend_challenges ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.friend_challenges ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'consistency';
ALTER TABLE public.friend_challenges ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS challenge_members_user_idx ON public.challenge_members (user_id);
CREATE INDEX IF NOT EXISTS challenge_members_challenge_idx ON public.challenge_members (challenge_id);

-- Derived progress cache (source of truth remains prayer_records)
CREATE TABLE IF NOT EXISTS public.challenge_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES public.friend_challenges(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  qualifying_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (challenge_id, user_id, qualifying_date)
);

-- ---------------------------------------------------------------------------
-- Helper: are two users blocked?
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.users_are_blocked(a uuid, b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.friends f
    WHERE f.status = 'blocked'
      AND (
        (f.requester_id = a AND f.receiver_id = b)
        OR (f.requester_id = b AND f.receiver_id = a)
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- Helper: count qualifying challenge days from prayer_records (server-side only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.count_qualifying_days(
  p_user_id uuid,
  p_start date,
  p_end date
)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(count(*)::int, 0)
  FROM (
    SELECT pr.date
    FROM public.prayer_records pr
    WHERE pr.user_id = p_user_id
      AND pr.date BETWEEN p_start AND p_end
      AND pr.status = 'completed'
      AND lower(pr.prayer_name) IN ('fajr', 'dhuhr', 'asr', 'maghrib', 'isha')
    GROUP BY pr.date
    HAVING count(DISTINCT lower(pr.prayer_name)) = 5
  ) q;
$$;

CREATE OR REPLACE FUNCTION public.count_today_completed_prayers(p_user_id uuid, p_date date)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(count(*)::int, 0)
  FROM public.prayer_records pr
  WHERE pr.user_id = p_user_id
    AND pr.date = p_date
    AND pr.status = 'completed'
    AND lower(pr.prayer_name) IN ('fajr', 'dhuhr', 'asr', 'maghrib', 'isha');
$$;

CREATE OR REPLACE FUNCTION public.challenge_total_days(p_start date, p_end date, p_today date DEFAULT current_date)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(1, (LEAST(p_end, p_today) - p_start + 1))::int;
$$;

CREATE OR REPLACE FUNCTION public.challenge_current_day(p_start date, p_end date, p_today date DEFAULT current_date)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_today < p_start THEN 0
    WHEN p_today > p_end THEN (p_end - p_start + 1)
    ELSE (p_today - p_start + 1)
  END::int;
$$;

-- ---------------------------------------------------------------------------
-- Search users by username or invite code (limited public fields)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_users_for_friend(p_query text)
RETURNS TABLE (
  id uuid,
  username text,
  display_name text,
  avatar_url text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  q text := lower(trim(p_query));
BEGIN
  IF me IS NULL OR length(q) < 2 THEN RETURN; END IF;

  RETURN QUERY
  SELECT p.id, p.username, p.display_name, p.avatar_url
  FROM public.profiles p
  LEFT JOIN public.user_settings s ON s.user_id = p.id
  WHERE p.id <> me
    AND coalesce(s.allow_friend_requests, true) = true
    AND NOT public.users_are_blocked(me, p.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.friends f
      WHERE (
        (f.requester_id = me AND f.receiver_id = p.id)
        OR (f.requester_id = p.id AND f.receiver_id = me)
      )
      AND f.status IN ('pending', 'accepted', 'blocked')
    )
    AND (
      lower(p.username) LIKE q || '%'
      OR lower(p.invite_code) = q
    )
  ORDER BY p.username
  LIMIT 20;
END;
$$;

-- ---------------------------------------------------------------------------
-- Send friend request
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_friend_request(p_target_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  fid uuid;
  target_allows boolean;
BEGIN
  IF me IS NULL OR p_target_id IS NULL OR me = p_target_id THEN
    RAISE EXCEPTION 'Invalid request';
  END IF;

  IF public.users_are_blocked(me, p_target_id) THEN
    RAISE EXCEPTION 'Cannot send request';
  END IF;

  SELECT coalesce(s.allow_friend_requests, true) INTO target_allows
  FROM public.user_settings s WHERE s.user_id = p_target_id;

  IF NOT coalesce(target_allows, true) THEN
    RAISE EXCEPTION 'User is not accepting friend requests';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.friends f
    WHERE (f.requester_id = me AND f.receiver_id = p_target_id)
       OR (f.requester_id = p_target_id AND f.receiver_id = me)
  ) THEN
    RAISE EXCEPTION 'Friend request already exists';
  END IF;

  INSERT INTO public.friends (requester_id, receiver_id, status)
  VALUES (me, p_target_id, 'pending')
  RETURNING id INTO fid;

  RETURN fid;
END;
$$;

-- ---------------------------------------------------------------------------
-- Respond to friend request
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.respond_friend_request(p_friendship_id uuid, p_accept boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF p_accept THEN
    UPDATE public.friends
    SET status = 'accepted', accepted_at = now()
    WHERE id = p_friendship_id
      AND receiver_id = me
      AND status = 'pending';
  ELSE
    UPDATE public.friends
    SET status = 'declined'
    WHERE id = p_friendship_id
      AND receiver_id = me
      AND status = 'pending';
  END IF;

  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Remove friend
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_friend(p_friendship_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  DELETE FROM public.friends
  WHERE id = p_friendship_id
    AND status = 'accepted'
    AND (requester_id = me OR receiver_id = me);

  IF NOT FOUND THEN RAISE EXCEPTION 'Friendship not found'; END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Block user
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.block_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  existing_id uuid;
BEGIN
  IF me IS NULL OR p_user_id IS NULL OR me = p_user_id THEN
    RAISE EXCEPTION 'Invalid request';
  END IF;

  SELECT f.id INTO existing_id FROM public.friends f
  WHERE (f.requester_id = me AND f.receiver_id = p_user_id)
     OR (f.requester_id = p_user_id AND f.receiver_id = me)
  LIMIT 1;

  IF existing_id IS NOT NULL THEN
    UPDATE public.friends
    SET status = 'blocked', blocked_by = me
    WHERE id = existing_id;
  ELSE
    INSERT INTO public.friends (requester_id, receiver_id, status, blocked_by)
    VALUES (me, p_user_id, 'blocked', me);
  END IF;

  -- Mark pending challenge invites as declined / left
  UPDATE public.challenge_members cm
  SET status = 'left'
  FROM public.challenge_members other
  WHERE cm.challenge_id = other.challenge_id
    AND cm.user_id = me
    AND other.user_id = p_user_id
    AND cm.status IN ('invited', 'accepted');

  UPDATE public.challenge_members cm
  SET status = 'left'
  FROM public.challenge_members other
  WHERE cm.challenge_id = other.challenge_id
    AND cm.user_id = p_user_id
    AND other.user_id = me
    AND cm.status IN ('invited', 'accepted');
END;
$$;

-- ---------------------------------------------------------------------------
-- Create challenge
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_friend_challenge(
  p_name text,
  p_start_date date,
  p_end_date date,
  p_member_ids uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  cid uuid;
  mid uuid;
  my_settings record;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_end_date < p_start_date THEN RAISE EXCEPTION 'Invalid dates'; END IF;

  SELECT * INTO my_settings FROM public.user_settings WHERE user_id = me;
  IF coalesce(my_settings.allow_friend_challenges, true) = false THEN
    RAISE EXCEPTION 'Friend challenges are disabled in your settings';
  END IF;

  INSERT INTO public.friend_challenges (creator_id, name, type, start_date, end_date, status)
  VALUES (
    me,
    trim(p_name),
    'consistency',
    p_start_date,
    p_end_date,
    CASE WHEN p_start_date <= current_date THEN 'active' ELSE 'pending' END
  )
  RETURNING id INTO cid;

  INSERT INTO public.challenge_members (challenge_id, user_id, status)
  VALUES (cid, me, 'accepted');

  FOREACH mid IN ARRAY coalesce(p_member_ids, ARRAY[]::uuid[])
  LOOP
    IF mid IS NULL OR mid = me THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.friends f
      WHERE f.status = 'accepted'
        AND ((f.requester_id = me AND f.receiver_id = mid) OR (f.requester_id = mid AND f.receiver_id = me))
    ) THEN
      CONTINUE;
    END IF;
    IF public.users_are_blocked(me, mid) THEN CONTINUE; END IF;

    INSERT INTO public.challenge_members (challenge_id, user_id, status)
    VALUES (cid, mid, 'invited')
    ON CONFLICT (challenge_id, user_id) DO NOTHING;
  END LOOP;

  RETURN cid;
END;
$$;

-- ---------------------------------------------------------------------------
-- Respond to challenge invite
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.respond_challenge_invite(p_challenge_id uuid, p_accept boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  c record;
BEGIN
  SELECT * INTO c FROM public.friend_challenges WHERE id = p_challenge_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Challenge not found'; END IF;

  IF p_accept THEN
    UPDATE public.challenge_members
    SET status = 'accepted', joined_at = now()
    WHERE challenge_id = p_challenge_id AND user_id = me AND status = 'invited';

    -- Activate challenge when all invited members have responded and start date reached
    IF c.start_date <= current_date THEN
      UPDATE public.friend_challenges SET status = 'active'
      WHERE id = p_challenge_id AND status = 'pending';
    END IF;
  ELSE
    UPDATE public.challenge_members
    SET status = 'declined'
    WHERE challenge_id = p_challenge_id AND user_id = me AND status = 'invited';
  END IF;

  IF NOT FOUND THEN RAISE EXCEPTION 'Invite not found'; END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Leave challenge
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.leave_challenge(p_challenge_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  UPDATE public.challenge_members
  SET status = 'left'
  WHERE challenge_id = p_challenge_id
    AND user_id = me
    AND status IN ('invited', 'accepted');

  IF NOT FOUND THEN RAISE EXCEPTION 'Not a member'; END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Get challenge detail with privacy-respecting progress
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_challenge_detail(p_challenge_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  c record;
  today date := current_date;
  total_days int;
  current_day int;
  members json;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.challenge_members
    WHERE challenge_id = p_challenge_id AND user_id = me AND status IN ('invited', 'accepted')
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO c FROM public.friend_challenges WHERE id = p_challenge_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Challenge not found'; END IF;

  -- Auto-complete past challenges
  IF c.end_date < today AND c.status = 'active' THEN
    UPDATE public.friend_challenges SET status = 'completed' WHERE id = p_challenge_id;
    c.status := 'completed';
  ELSIF c.start_date <= today AND c.status = 'pending' THEN
    UPDATE public.friend_challenges SET status = 'active' WHERE id = p_challenge_id;
    c.status := 'active';
  END IF;

  total_days := (c.end_date - c.start_date + 1);
  current_day := public.challenge_current_day(c.start_date, c.end_date, today);

  SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) INTO members
  FROM (
    SELECT
      cm.user_id,
      cm.status AS member_status,
      p.display_name,
      p.username,
      p.avatar_url,
      (cm.user_id = me) AS is_self,
      CASE
        WHEN cm.user_id = me THEN true
        WHEN coalesce(us.allow_friends_see_challenge_progress, true) = false THEN false
        ELSE true
      END AS progress_visible,
      CASE
        WHEN cm.user_id = me OR coalesce(us.allow_friends_see_challenge_progress, true) = true
        THEN public.count_qualifying_days(cm.user_id, c.start_date, LEAST(c.end_date, today))
        ELSE null
      END AS qualifying_days,
      CASE
        WHEN cm.user_id = me OR coalesce(us.allow_friends_see_challenge_progress, true) = true
        THEN public.count_today_completed_prayers(cm.user_id, today)
        ELSE null
      END AS today_completed
    FROM public.challenge_members cm
    JOIN public.profiles p ON p.id = cm.user_id
    LEFT JOIN public.user_settings us ON us.user_id = cm.user_id
    WHERE cm.challenge_id = p_challenge_id
      AND cm.status IN ('invited', 'accepted')
    ORDER BY (cm.user_id = me) DESC, p.display_name
  ) t;

  RETURN json_build_object(
    'id', c.id,
    'name', c.name,
    'type', c.type,
    'start_date', c.start_date,
    'end_date', c.end_date,
    'status', c.status,
    'creator_id', c.creator_id,
    'total_days', total_days,
    'current_day', current_day,
    'members', members
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Activate pending challenges (call on app load)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activate_due_challenges()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.friend_challenges
  SET status = 'active'
  WHERE status = 'pending' AND start_date <= current_date;

  UPDATE public.friend_challenges
  SET status = 'completed'
  WHERE status = 'active' AND end_date < current_date;
END;
$$;

-- ---------------------------------------------------------------------------
-- Update handle_new_user to set invite_code
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base text;
  uname text;
  icode text;
BEGIN
  base := lower(regexp_replace(split_part(coalesce(new.email, 'user'), '@', 1), '[^a-z0-9_]', '_', 'g'));
  IF length(base) < 3 THEN base := 'user'; END IF;
  uname := substring(base || '_' || replace(new.id::text, '-', ''), 1, 20);
  icode := substring(replace(gen_random_uuid()::text, '-', ''), 1, 8);

  INSERT INTO public.profiles (id, username, display_name, avatar_url, invite_code)
  VALUES (
    new.id,
    uname,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email, 'user'), '@', 1)),
    new.raw_user_meta_data->>'avatar_url',
    icode
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.streaks (user_id, current_streak, longest_streak)
  VALUES (new.id, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_settings (user_id)
  VALUES (new.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN new;
END;
$$;

-- ---------------------------------------------------------------------------
-- RLS helper RPCs + private schema (SECURITY DEFINER — no recursive policies)
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO postgres, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.get_my_challenge_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT challenge_id
  FROM public.challenge_members
  WHERE user_id = auth.uid()
    AND status IN ('invited', 'accepted', 'left');
$$;

REVOKE ALL ON FUNCTION private.get_my_challenge_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.get_my_challenge_ids() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_friend_profiles(p_user_ids uuid[])
RETURNS TABLE (
  id uuid,
  username text,
  display_name text,
  avatar_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.username, p.display_name, p.avatar_url
  FROM public.profiles p
  WHERE p.id = ANY(p_user_ids)
    AND EXISTS (
      SELECT 1 FROM public.friends f
      WHERE f.status = 'accepted'
        AND (
          (f.requester_id = auth.uid() AND f.receiver_id = p.id)
          OR (f.receiver_id = auth.uid() AND f.requester_id = p.id)
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.get_my_challenges_summary()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'active', coalesce((
      SELECT json_agg(row_to_json(t))
      FROM (
        SELECT fc.id, fc.name, fc.start_date, fc.end_date, fc.status, fc.creator_id,
               cm.status AS member_status,
               (fc.end_date - fc.start_date + 1)::int AS total_days,
               CASE WHEN current_date < fc.start_date THEN 0
                    WHEN current_date > fc.end_date THEN (fc.end_date - fc.start_date + 1)::int
                    ELSE (current_date - fc.start_date + 1)::int END AS current_day
        FROM public.challenge_members cm
        JOIN public.friend_challenges fc ON fc.id = cm.challenge_id
        WHERE cm.user_id = auth.uid() AND cm.status = 'accepted'
          AND fc.status IN ('pending', 'active')
        ORDER BY fc.start_date DESC
      ) t
    ), '[]'::json),
    'invites', coalesce((
      SELECT json_agg(row_to_json(t))
      FROM (
        SELECT fc.id, fc.name, fc.start_date, fc.end_date, fc.status, fc.creator_id,
               cm.status AS member_status,
               (fc.end_date - fc.start_date + 1)::int AS total_days,
               CASE WHEN current_date < fc.start_date THEN 0
                    WHEN current_date > fc.end_date THEN (fc.end_date - fc.start_date + 1)::int
                    ELSE (current_date - fc.start_date + 1)::int END AS current_day,
               json_build_object('id', p.id, 'username', p.username,
                 'display_name', p.display_name, 'avatar_url', p.avatar_url) AS inviter
        FROM public.challenge_members cm
        JOIN public.friend_challenges fc ON fc.id = cm.challenge_id
        JOIN public.profiles p ON p.id = fc.creator_id
        WHERE cm.user_id = auth.uid() AND cm.status = 'invited'
        ORDER BY fc.start_date DESC
      ) t
    ), '[]'::json),
    'completed', coalesce((
      SELECT json_agg(row_to_json(t))
      FROM (
        SELECT fc.id, fc.name, fc.start_date, fc.end_date, fc.status, fc.creator_id,
               cm.status AS member_status,
               (fc.end_date - fc.start_date + 1)::int AS total_days,
               CASE WHEN current_date < fc.start_date THEN 0
                    WHEN current_date > fc.end_date THEN (fc.end_date - fc.start_date + 1)::int
                    ELSE (current_date - fc.start_date + 1)::int END AS current_day
        FROM public.challenge_members cm
        JOIN public.friend_challenges fc ON fc.id = cm.challenge_id
        WHERE cm.user_id = auth.uid() AND cm.status = 'accepted'
          AND fc.status = 'completed'
        ORDER BY fc.end_date DESC
      ) t
    ), '[]'::json)
  ) INTO result;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_friend_ids_in_active_challenges(p_friend_ids uuid[])
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(array_agg(DISTINCT cm2.user_id), '{}')
  FROM public.challenge_members cm1
  JOIN public.challenge_members cm2 ON cm1.challenge_id = cm2.challenge_id
  JOIN public.friend_challenges fc ON fc.id = cm1.challenge_id
  WHERE cm1.user_id = auth.uid()
    AND cm1.status = 'accepted'
    AND cm2.status = 'accepted'
    AND cm2.user_id = ANY(p_friend_ids)
    AND fc.status IN ('pending', 'active');
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.friends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friend_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_progress ENABLE ROW LEVEL SECURITY;

-- friends: see own relationships
DROP POLICY IF EXISTS "friends_select_own" ON public.friends;
CREATE POLICY "friends_select_own" ON public.friends
  FOR SELECT USING (requester_id = auth.uid() OR receiver_id = auth.uid());

DROP POLICY IF EXISTS "friends_insert_requester" ON public.friends;
CREATE POLICY "friends_insert_requester" ON public.friends
  FOR INSERT WITH CHECK (requester_id = auth.uid());

DROP POLICY IF EXISTS "friends_update_participant" ON public.friends;
CREATE POLICY "friends_update_participant" ON public.friends
  FOR UPDATE USING (requester_id = auth.uid() OR receiver_id = auth.uid());

DROP POLICY IF EXISTS "friends_delete_participant" ON public.friends;
CREATE POLICY "friends_delete_participant" ON public.friends
  FOR DELETE USING (requester_id = auth.uid() OR receiver_id = auth.uid());

-- Limited profile read for accepted friends (display fields only via join in app/RPC)
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
  );

-- friend_challenges (uses private helper — never subquery challenge_members in policy)
DROP POLICY IF EXISTS "challenges_select_member" ON public.friend_challenges;
CREATE POLICY "challenges_select_member" ON public.friend_challenges
  FOR SELECT USING (
    creator_id = auth.uid()
    OR id IN (SELECT private.get_my_challenge_ids())
  );

DROP POLICY IF EXISTS "challenges_insert_creator" ON public.friend_challenges;
CREATE POLICY "challenges_insert_creator" ON public.friend_challenges
  FOR INSERT WITH CHECK (creator_id = auth.uid());

DROP POLICY IF EXISTS "challenges_update_creator" ON public.friend_challenges;
CREATE POLICY "challenges_update_creator" ON public.friend_challenges
  FOR UPDATE USING (creator_id = auth.uid());

-- challenge_members: own rows only (prevents infinite recursion)
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'challenge_members'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.challenge_members', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "challenge_members_select_own" ON public.challenge_members
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "challenge_members_update_own" ON public.challenge_members;
CREATE POLICY "challenge_members_update_own" ON public.challenge_members
  FOR UPDATE USING (user_id = auth.uid());

-- challenge_progress: own rows only (cache); friends use RPC
DROP POLICY IF EXISTS "challenge_progress_own" ON public.challenge_progress;
CREATE POLICY "challenge_progress_own" ON public.challenge_progress
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Grant execute on RPCs to authenticated users
GRANT EXECUTE ON FUNCTION public.get_friend_profiles(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_challenges_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_friend_ids_in_active_challenges(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_users_for_friend(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_friend_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_friend_request(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_friend(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.block_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_friend_challenge(text, date, date, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_challenge_invite(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_challenge(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_challenge_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_due_challenges() TO authenticated;
