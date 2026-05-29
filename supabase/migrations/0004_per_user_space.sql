-- 놀터(Nolter) — 개인 space 행을 (syncCode, userId) 별로 분리
--
-- 배경: 동기화 코드 = 초대 게이트. 같은 코드를 친구끼리 공유하면
-- 기존 모델(`code_hash = sha256(syncCode)`)에서는 모두가 같은 행을 덮어쓰며
-- 프로필(닉/비번/색)·룸 목록이 1슬롯이라 마지막 사용자만 살아남았다.
-- 이 마이그레이션에서:
--   • space.code_hash = sha256(syncCode + ':' + userId)  → 디바이스마다 1행
--   • space_pull / space_push 에 p_user_id 추가
--   • admin_list_members 는 nickname/colorKey/room_count 그대로 모든 행 열거
-- 룸/엔티티(`rooms`, `entities`)는 공유 자원이라 그대로 둔다.
--
-- 적용: Supabase 대시보드 → SQL Editor 에 이 파일 전체 RUN.

-- ── 헬퍼: (code, userId) → 개인 hash ──
create or replace function public.space_hash(p_code text, p_user_id text)
returns text
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select encode(
    sha256(convert_to(coalesce(p_code, '') || ':' || coalesce(p_user_id, ''), 'UTF8')),
    'hex'
  );
$$;

-- ── 개인 공간 PULL (user 단위) ──
drop function if exists public.space_pull(text);
create or replace function public.space_pull(p_code text, p_user_id text)
returns table (data jsonb, version integer)
language sql
security definer
set search_path = public, pg_temp
as $$
  select s.data, s.version
  from public.space s
  where s.code_hash = public.space_hash(p_code, p_user_id);
$$;

-- ── 개인 공간 PUSH (user 단위, 낙관적 잠금) ──
drop function if exists public.space_push(text, jsonb, integer);
create or replace function public.space_push(
  p_code text, p_user_id text, p_data jsonb, p_expected_version integer
)
returns table (version integer, conflict boolean, data jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_hash text := public.space_hash(p_code, p_user_id); v_cur public.space%rowtype;
begin
  if p_code is null or length(p_code) < 12 then raise exception 'invalid sync code'; end if;
  if p_user_id is null or length(p_user_id) < 4 then raise exception 'invalid user id'; end if;
  select * into v_cur from public.space where code_hash = v_hash for update;
  if not found then
    insert into public.space (code_hash, data, version) values (v_hash, p_data, 1);
    return query select 1, false, null::jsonb; return;
  end if;
  if v_cur.version <> p_expected_version then
    return query select v_cur.version, true, v_cur.data; return;
  end if;
  update public.space set data = p_data, version = v_cur.version + 1, updated_at = now()
  where code_hash = v_hash;
  return query select v_cur.version + 1, false, null::jsonb; return;
end;
$$;

-- ── 권한 ──
grant execute on function public.space_pull(text, text)                   to anon, authenticated;
grant execute on function public.space_push(text, text, jsonb, integer)   to anon, authenticated;
