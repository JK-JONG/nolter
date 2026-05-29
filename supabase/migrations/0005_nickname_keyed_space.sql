-- 놀터(Nolter) — space 행을 (syncCode, nickname) 으로 재키
--
-- 변경 배경: 0004 에서 (syncCode, userId) 로 키했으나, 사용자 의도는
--   "게이트 안에서 닉네임으로 멤버 식별 + 같은 닉네임은 디바이스 간 로밍"
-- 이고, 가입 시 닉네임 중복은 명시적으로 막아야 했다.
--
-- 변경:
--   • space_hash(p_code, p_nick) — nickname(소문자/트림) 기반.
--   • space_lookup_member(code, nick) — 닉네임 존재 여부 + 색.
--   • space_signup(code, nick, hash, color) — INSERT only, 중복 시 'duplicate'.
--   • space_login(code, nick, hash) — 해시 일치 시 data+version 반환.
--   • space_pull/push 는 (code, nick) 키로 재정의.
--
-- 0004 에 의해 만들어진 (code+userId) 기준 행들은 새 키와 안 맞아서
-- 자동으로 "고아"가 되며, admin 화면에서 닉네임이 없거나 색상이 빈 행으로
-- 보일 수 있다. 필요 시 admin 페이지에서 직접 삭제.
--
-- 적용: Supabase 대시보드 → SQL Editor 에 이 파일 전체 RUN.

-- ── 헬퍼: (code, nickname) → hash ──
create or replace function public.space_hash(p_code text, p_nick text)
returns text
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select encode(
    sha256(convert_to(
      coalesce(p_code, '') || ':' || lower(trim(coalesce(p_nick, ''))),
      'UTF8'
    )),
    'hex'
  );
$$;

-- ── 닉네임 존재 여부 ──
create or replace function public.space_lookup_member(p_code text, p_nick text)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select jsonb_build_object(
       'exists', true,
       'colorKey', s.data->'profile'->>'colorKey'
     ) from public.space s
     where s.code_hash = public.space_hash(p_code, p_nick)),
    jsonb_build_object('exists', false)
  );
$$;

-- ── 신규 가입 — 닉네임 중복 시 ok=false reason='duplicate' ──
create or replace function public.space_signup(
  p_code text, p_nick text, p_hash text, p_color text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_nick text := trim(coalesce(p_nick, '')); v_hash text;
begin
  if p_code is null or length(p_code) < 12 then raise exception 'invalid sync code'; end if;
  if v_nick = '' then raise exception 'invalid nickname'; end if;
  if p_hash is null or length(p_hash) < 16 then raise exception 'invalid password hash'; end if;
  v_hash := public.space_hash(p_code, v_nick);
  if exists (select 1 from public.space where code_hash = v_hash) then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;
  insert into public.space (code_hash, data, version)
  values (
    v_hash,
    jsonb_build_object(
      'profile', jsonb_build_object(
        'nickname', v_nick,
        'passwordHash', p_hash,
        'colorKey', coalesce(p_color, 'mint')
      ),
      'rooms', '[]'::jsonb
    ),
    1
  );
  return jsonb_build_object('ok', true, 'version', 1);
end;
$$;

-- ── 로그인 — 닉네임+해시 검증 후 데이터/버전 반환 ──
create or replace function public.space_login(
  p_code text, p_nick text, p_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_hash text := public.space_hash(p_code, p_nick); v_row public.space%rowtype;
begin
  select * into v_row from public.space where code_hash = v_hash;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_member');
  end if;
  if v_row.data->'profile'->>'passwordHash' <> p_hash then
    return jsonb_build_object('ok', false, 'reason', 'bad_password');
  end if;
  return jsonb_build_object(
    'ok', true,
    'data', v_row.data,
    'version', v_row.version
  );
end;
$$;

-- ── pull/push — (code, nick) 키 ──
-- 0004 의 (text, text) 시그니처를 동일하게 유지하므로 OR REPLACE 만으로 본문 교체.
create or replace function public.space_pull(p_code text, p_nick text)
returns table (data jsonb, version integer)
language sql
security definer
set search_path = public, pg_temp
as $$
  select s.data, s.version
  from public.space s
  where s.code_hash = public.space_hash(p_code, p_nick);
$$;

create or replace function public.space_push(
  p_code text, p_nick text, p_data jsonb, p_expected_version integer
)
returns table (version integer, conflict boolean, data jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_hash text := public.space_hash(p_code, p_nick); v_cur public.space%rowtype;
begin
  if p_code is null or length(p_code) < 12 then raise exception 'invalid sync code'; end if;
  if p_nick is null or length(trim(p_nick)) < 1 then raise exception 'invalid nickname'; end if;
  select * into v_cur from public.space where code_hash = v_hash for update;
  if not found then
    -- 가입은 space_signup 으로만 — push 가 자동 가입을 만들지 않는다.
    return query select 0, false, null::jsonb; return;
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
grant execute on function public.space_lookup_member(text, text)              to anon, authenticated;
grant execute on function public.space_signup(text, text, text, text)         to anon, authenticated;
grant execute on function public.space_login(text, text, text)                to anon, authenticated;
grant execute on function public.space_pull(text, text)                       to anon, authenticated;
grant execute on function public.space_push(text, text, jsonb, integer)       to anon, authenticated;
