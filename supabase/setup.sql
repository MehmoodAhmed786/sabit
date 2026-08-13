-- Sabit Supabase setup: run in SQL Editor after your base schema exists.
-- Safe to re-run (uses IF NOT EXISTS / ON CONFLICT where possible).

-- ---------------------------------------------------------------------------
-- Laqabs reference data (required — table starts empty)
-- ---------------------------------------------------------------------------
INSERT INTO public.laqabs (id, name, meaning, requirement_days) VALUES
  ('al-badi',     'Al-Bādiʿ',      'The Initiator — first steps on the path',           3),
  ('as-sabit',    'As-Sābit',       'The Steadfast — consistency takes root',            7),
  ('al-muqim',    'Al-Muqīm',       'The Established — prayer becomes habit',           14),
  ('al-murabit',  'Al-Murābiṭ',     'The Sentinel — guarding your salah',               21),
  ('ash-shakir',  'Ash-Shākir',     'The Grateful — thankful for every rakah',          30),
  ('al-muhsin',   'Al-Muḥsin',      'The Excellent — striving for ihsan',               45),
  ('al-khalis',   'Al-Khāliṣ',      'The Sincere — salah with presence of heart',       60),
  ('al-mujahid',  'Al-Mujāhid',     'The Striver — effort through every season',        90),
  ('al-hafiz',    'Al-Ḥāfiẓ',       'The Preserver — protecting what you built',       120),
  ('al-mutasim',  'Al-Mu''taṣim',   'The One who holds fast — unwavering',             180),
  ('al-warith',   'Al-Wārith',      'The Inheritor — legacy of consistency',           270),
  ('al-amil',     'Al-Āmil',        'The Doer — a full year of steadfastness',         365)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Qada deduplication (app upserts on user + date + prayer)
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS qada_records_user_date_prayer_idx
  ON public.qada_records (user_id, original_date, prayer_name);

-- Prayer records deduplication (one row per user / day / prayer)
CREATE UNIQUE INDEX IF NOT EXISTS prayer_records_user_date_prayer_idx
  ON public.prayer_records (user_id, date, prayer_name);

-- Track which day streak evaluation has run through (Fajr boundary)
ALTER TABLE public.streaks ADD COLUMN IF NOT EXISTS last_evaluated_date date;

-- ---------------------------------------------------------------------------
-- User settings (notification preferences)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  notifications_enabled boolean NOT NULL DEFAULT true,
  fajr_notifications boolean NOT NULL DEFAULT true,
  dhuhr_notifications boolean NOT NULL DEFAULT true,
  asr_notifications boolean NOT NULL DEFAULT true,
  maghrib_notifications boolean NOT NULL DEFAULT true,
  isha_notifications boolean NOT NULL DEFAULT true,
  missed_prayer_notifications boolean NOT NULL DEFAULT true,
  qada_notifications boolean NOT NULL DEFAULT true,
  streak_notifications boolean NOT NULL DEFAULT true,
  laqab_notifications boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.user_settings (user_id)
SELECT p.id FROM public.profiles p
WHERE NOT EXISTS (SELECT 1 FROM public.user_settings s WHERE s.user_id = p.id)
ON CONFLICT (user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Auto-create profile + streak row on sign-up
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
BEGIN
  base := lower(regexp_replace(split_part(coalesce(new.email, 'user'), '@', 1), '[^a-z0-9_]', '_', 'g'));
  IF length(base) < 3 THEN base := 'user'; END IF;
  uname := substring(base || '_' || replace(new.id::text, '-', ''), 1, 20);

  INSERT INTO public.profiles (id, username, display_name, avatar_url)
  VALUES (
    new.id,
    uname,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email, 'user'), '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill profiles for existing auth users missing a row
INSERT INTO public.profiles (id, username, display_name, avatar_url)
SELECT
  u.id,
  substring(
    CASE WHEN length(regexp_replace(lower(split_part(coalesce(u.email, 'user'), '@', 1)), '[^a-z0-9_]', '_', 'g')) >= 3
         THEN regexp_replace(lower(split_part(coalesce(u.email, 'user'), '@', 1)), '[^a-z0-9_]', '_', 'g')
         ELSE 'user' END
    || '_' || replace(u.id::text, '-', ''),
    1, 20
  ),
  coalesce(u.raw_user_meta_data->>'full_name', split_part(coalesce(u.email, 'user'), '@', 1)),
  u.raw_user_meta_data->>'avatar_url'
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.streaks (user_id, current_streak, longest_streak)
SELECT u.id, 0, 0
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.streaks s WHERE s.user_id = u.id)
ON CONFLICT (user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prayer_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.laqabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_laqabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qada_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

-- profiles
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT USING (auth.uid() = id);
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id);
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- laqabs (read-only reference for all authenticated users)
DROP POLICY IF EXISTS "laqabs_select_all" ON public.laqabs;
CREATE POLICY "laqabs_select_all" ON public.laqabs FOR SELECT TO authenticated USING (true);

-- streaks
DROP POLICY IF EXISTS "streaks_select_own" ON public.streaks;
CREATE POLICY "streaks_select_own" ON public.streaks FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "streaks_update_own" ON public.streaks;
CREATE POLICY "streaks_update_own" ON public.streaks FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "streaks_insert_own" ON public.streaks;
CREATE POLICY "streaks_insert_own" ON public.streaks FOR INSERT WITH CHECK (auth.uid() = user_id);

-- prayer_records
DROP POLICY IF EXISTS "prayer_records_all_own" ON public.prayer_records;
CREATE POLICY "prayer_records_all_own" ON public.prayer_records
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- user_laqabs
DROP POLICY IF EXISTS "user_laqabs_all_own" ON public.user_laqabs;
CREATE POLICY "user_laqabs_all_own" ON public.user_laqabs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- qada_records
DROP POLICY IF EXISTS "qada_records_all_own" ON public.qada_records;
CREATE POLICY "qada_records_all_own" ON public.qada_records
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- user_settings
DROP POLICY IF EXISTS "user_settings_all_own" ON public.user_settings;
CREATE POLICY "user_settings_all_own" ON public.user_settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Notifications: run supabase/notifications.sql next
-- ---------------------------------------------------------------------------
