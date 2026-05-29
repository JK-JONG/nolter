-- 놀터(Nolter) — 방 초대 코드 자리수 변경: 12 → 8
--
-- 동기화 코드(12자)와 방 초대 코드(12자)가 같은 자리수라 헷갈렸음.
-- 방 초대 코드는 8자로 줄여 시각적으로 명확히 구분되게 한다 (32^8 ≈ 1.1조).
--
-- 변경 함수:
--   · room_create_simple — gen_code(8) 로 짧게 발급
--   · room_upsert        — length 검증 12 → 8
--   · room_set_title     — length 검증 12 → 8
-- (space_push 는 동기화 코드 검증이라 12 유지)
--
-- 기존 12자 방 코드는 그대로 보존됨 — DB 에 이미 들어간 방은 12자로 남아있어도 OK.
-- 신규 발급분만 8자가 된다.

create or replace function public.room_create_simple(p_owner_id text, p_title text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_room text; v_title text;
begin
  v_room := public.gen_code(8);
  v_title := coalesce(nullif(left(p_title, 80), ''), '새 모임방');
  insert into public.rooms (code_hash, room_code, title, owner_id)
  values (public.room_hash(v_room), v_room, v_title, p_owner_id);
  return jsonb_build_object('roomCode', v_room, 'title', v_title, 'ownerId', p_owner_id);
end;
$$;

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
  if p_code is null or length(p_code) < 8 then
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

create or replace function public.room_set_title(p_code text, p_title text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_hash text := public.room_hash(p_code);
begin
  if p_code is null or length(p_code) < 8 then raise exception 'invalid room code'; end if;
  insert into public.rooms (code_hash, title) values (v_hash, left(p_title, 80))
  on conflict (code_hash) do update set title = left(p_title, 80), updated_at = now();
end;
$$;
