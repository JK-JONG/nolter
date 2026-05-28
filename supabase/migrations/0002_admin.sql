-- 놀터(Nolter) — Admin RPC
--
-- 보안 모델: 친구 모임 + invite-only obscurity. 별도 DB-side 토큰 검증 없이
-- anon 에 grant 하고, 클라이언트가 isAdmin 일 때만 호출하게 한다(기존 RPC 와 동일).
-- space.data 에는 평문 비밀번호가 들어가지 않으므로 nickname 만 노출되어도 안전.
--
-- 적용: Supabase 대시보드 → SQL Editor 에 이 파일 전체 붙여넣고 RUN.

-- ── 모든 방 목록 (엔티티 수 포함) ───────────────────────
create or replace function public.admin_list_rooms()
returns table (
  code_hash    text,
  room_code    text,
  title        text,
  owner_id     text,
  created_at   timestamptz,
  updated_at   timestamptz,
  entity_count bigint
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select r.code_hash, r.room_code, r.title, r.owner_id, r.created_at, r.updated_at,
         coalesce((select count(*) from public.entities e where e.room_hash = r.code_hash), 0)
  from public.rooms r
  order by r.created_at desc;
$$;

-- ── 모든 멤버(동기화 공간) 목록 ────────────────────────
-- space.data 의 profile.nickname / profile.colorKey 와 rooms 배열 길이를 같이.
create or replace function public.admin_list_members()
returns table (
  code_hash       text,
  nickname        text,
  color_key       text,
  room_count      bigint,
  version         integer,
  updated_at      timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select s.code_hash,
         coalesce(s.data->'profile'->>'nickname', ''),
         coalesce(s.data->'profile'->>'colorKey', ''),
         coalesce(jsonb_array_length(s.data->'rooms'), 0)::bigint,
         s.version,
         s.updated_at
  from public.space s
  order by s.updated_at desc;
$$;

-- ── 방 삭제 (entities 는 cascade) ──────────────────────
create or replace function public.admin_delete_room(p_code_hash text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.rooms where code_hash = p_code_hash;
$$;

-- ── 멤버(동기화 공간) 삭제 ─────────────────────────────
create or replace function public.admin_delete_member(p_code_hash text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.space where code_hash = p_code_hash;
$$;

-- ── 권한: anon 에 RPC 실행만 ───────────────────────────
grant execute on function public.admin_list_rooms()            to anon, authenticated;
grant execute on function public.admin_list_members()          to anon, authenticated;
grant execute on function public.admin_delete_room(text)       to anon, authenticated;
grant execute on function public.admin_delete_member(text)     to anon, authenticated;
