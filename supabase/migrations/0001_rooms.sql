-- 놀터(Nolter) 백엔드 — 통합 마이그레이션
--
-- 모델(단순):
--   • 동기화 코드(개인 공간): 방 목록 + 프로필을 기기 간 동기화하는 용도 1가지.
--   • 방 코드 = 초대 코드: 방 1개당 코드 1개. 그 코드를 아는 사람이 방에 들어와 내 목록에 추가.
--   • 방장 = 방을 만든 사람(owner_id). 별도 관리자/마스터 코드 개념 없음.
--   • 실시간 협업(커서·획·스티키·메모·캘린더)은 Realtime Broadcast/Presence,
--     최종 상태 영속은 이 RPC 들(엔티티별 행).
--
-- 보안:
--   • rooms/entities/space 전부 RLS ON + 정책 0개 → 직접 접근 차단.
--   • 접근은 SECURITY DEFINER RPC 로만, `SET search_path` 고정.
--   • 평문 room_code 보관(테이블 RLS 로 잠겨 RPC 로만 노출 — 친구용 obscurity 모델).
--   • 호스트 권한(잠금 토글 등) 은 클라가 owner_id 매칭으로 판단(서버 강제 없음, honor system).
--
-- 적용: Supabase 대시보드 → SQL Editor 에 이 파일 전체 붙여넣고 RUN.

-- ── 테이블 ──────────────────────────────────────────────
create table if not exists public.rooms (
  code_hash  text primary key,            -- sha256(code)
  room_code  text,                         -- 평문 코드(생성된 방만 채워짐 — 공유용)
  title      text        not null default '새 놀터',
  owner_id   text,                         -- 만든 사람의 userId (호스트)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.entities (
  id         text        primary key,
  room_hash  text        not null references public.rooms(code_hash) on delete cascade,
  kind       text        not null,         -- 'stroke' | 'sticky' | 'event' | 'note' | 'config'
  author_id  text,
  data       jsonb       not null,
  updated_by text,
  updated_at timestamptz not null default now()
);
create index if not exists entities_room_kind_idx on public.entities (room_hash, kind);

-- 개인 공간(동기화 코드 → 방 목록 + 프로필). 워크아웃 vault 식 낙관적 잠금.
create table if not exists public.space (
  code_hash  text primary key,
  data       jsonb       not null default '{}'::jsonb,
  version    integer     not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.rooms    enable row level security;
alter table public.entities enable row level security;
alter table public.space    enable row level security;
revoke all on table public.rooms    from anon, authenticated;
revoke all on table public.entities from anon, authenticated;
revoke all on table public.space    from anon, authenticated;

-- ── 헬퍼: 코드 → sha256 hex ─────────────────────────────
create or replace function public.room_hash(p_code text)
returns text
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select encode(sha256(convert_to(coalesce(p_code, ''), 'UTF8')), 'hex');
$$;

-- ── 헬퍼: 서버측 랜덤 코드 생성(헷갈리는 글자 제외) ─────
create or replace function public.gen_code(p_len int default 12)
returns text
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, p_len);
$$;
revoke all on function public.gen_code(int) from public, anon, authenticated;

-- ── 방 생성(누구나) → {roomCode, title, ownerId} ───────
create or replace function public.room_create_simple(p_owner_id text, p_title text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_room text; v_title text;
begin
  v_room := public.gen_code(12);
  v_title := coalesce(nullif(left(p_title, 80), ''), '새 모임방');
  insert into public.rooms (code_hash, room_code, title, owner_id)
  values (public.room_hash(v_room), v_room, v_title, p_owner_id);
  return jsonb_build_object('roomCode', v_room, 'title', v_title, 'ownerId', p_owner_id);
end;
$$;

-- ── 방 조회(코드로) → {roomCode, title, ownerId} or null ─
create or replace function public.room_lookup(p_code text)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('roomCode', r.room_code, 'title', r.title, 'ownerId', r.owner_id)
  from public.rooms r
  where r.code_hash = public.room_hash(p_code)
  limit 1;
$$;

-- ── 방 전체 PULL: 메타 + 모든 엔티티 ───────────────────
create or replace function public.room_pull(p_code text)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'title',    (select r.title    from public.rooms r where r.code_hash = public.room_hash(p_code)),
    'ownerId',  (select r.owner_id from public.rooms r where r.code_hash = public.room_hash(p_code)),
    'entities', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'id', e.id, 'kind', e.kind, 'author_id', e.author_id,
                'data', e.data, 'updated_by', e.updated_by,
                'updated_at', e.updated_at))
       from public.entities e
       where e.room_hash = public.room_hash(p_code)),
      '[]'::jsonb)
  );
$$;

-- ── 엔티티 UPSERT (id 기준) ────────────────────────────
-- 방이 없으면 자동 생성(평문 코드/오너 없는 ad-hoc 방). 다른 방 엔티티 변조 차단.
create or replace function public.room_upsert(
  p_code       text,
  p_id         text,
  p_kind       text,
  p_author     text,
  p_data       jsonb,
  p_updated_by text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_hash text := public.room_hash(p_code);
begin
  if p_code is null or length(p_code) < 12 then
    raise exception 'invalid room code';
  end if;

  insert into public.rooms (code_hash) values (v_hash)
  on conflict (code_hash) do update set updated_at = now();

  insert into public.entities (id, room_hash, kind, author_id, data, updated_by, updated_at)
  values (p_id, v_hash, p_kind, p_author, p_data, p_updated_by, now())
  on conflict (id) do update
    set data = excluded.data, updated_by = excluded.updated_by, updated_at = now()
    where public.entities.room_hash = v_hash;
end;
$$;

-- ── 엔티티 DELETE (방 범위 내) ─────────────────────────
create or replace function public.room_delete(p_code text, p_id text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.entities
  where id = p_id and room_hash = public.room_hash(p_code);
$$;

-- ── 방 제목 변경 ───────────────────────────────────────
create or replace function public.room_set_title(p_code text, p_title text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_hash text := public.room_hash(p_code);
begin
  if p_code is null or length(p_code) < 12 then raise exception 'invalid room code'; end if;
  insert into public.rooms (code_hash, title) values (v_hash, left(p_title, 80))
  on conflict (code_hash) do update set title = left(p_title, 80), updated_at = now();
end;
$$;

-- ── 개인 공간 동기화 (낙관적 잠금) ─────────────────────
create or replace function public.space_pull(p_code text)
returns table (data jsonb, version integer)
language sql
security definer
set search_path = public, pg_temp
as $$
  select s.data, s.version from public.space s where s.code_hash = public.room_hash(p_code);
$$;

create or replace function public.space_push(p_code text, p_data jsonb, p_expected_version integer)
returns table (version integer, conflict boolean, data jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_hash text := public.room_hash(p_code); v_cur public.space%rowtype;
begin
  if p_code is null or length(p_code) < 12 then raise exception 'invalid sync code'; end if;
  select * into v_cur from public.space where code_hash = v_hash for update;
  if not found then
    insert into public.space (code_hash, data, version) values (v_hash, p_data, 1);
    return query select 1, false, null::jsonb; return;
  end if;
  if v_cur.version <> p_expected_version then
    return query select v_cur.version, true, v_cur.data; return;
  end if;
  update public.space set data = p_data, version = v_cur.version + 1, updated_at = now() where code_hash = v_hash;
  return query select v_cur.version + 1, false, null::jsonb; return;
end;
$$;

-- ── 권한: anon 에 RPC 실행만 ───────────────────────────
revoke all on function public.room_hash(text) from public;
grant execute on function public.room_create_simple(text, text)                   to anon, authenticated;
grant execute on function public.room_lookup(text)                                to anon, authenticated;
grant execute on function public.room_pull(text)                                  to anon, authenticated;
grant execute on function public.room_upsert(text, text, text, text, jsonb, text) to anon, authenticated;
grant execute on function public.room_delete(text, text)                          to anon, authenticated;
grant execute on function public.room_set_title(text, text)                       to anon, authenticated;
grant execute on function public.space_pull(text)                                 to anon, authenticated;
grant execute on function public.space_push(text, jsonb, integer)                 to anon, authenticated;
