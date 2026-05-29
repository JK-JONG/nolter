import { ref, reactive, shallowRef, computed, watch, onBeforeUnmount } from 'vue'
import { useThrottleFn, useDebounceFn } from '@vueuse/core'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import { sha256Hex, normalizeCode } from '@/lib/id'
import { useIdentity } from '@/stores/identity'
import { useSpace } from '@/stores/space'
import type { Stroke, Sticky, EventEntity, Peer, Cursor, Op, Tool, TabKey } from '@/lib/types'

// 한 방(room) 세션의 모든 것: 영속(strokes/stickies/events/memo/config) + 실시간(Presence/Broadcast).
// 데이터 흐름(레이스 방지): ① 채널 subscribe → ② RPC room_pull → ③ pull 결과를 기존 상태에 union 병합.
// supabase 미설정 시 mode='solo' — localStorage 만 사용.

const MEMO_ID = 'note:main'
const CONFIG_ID = 'room:config'

export function useRoom(rawCode: string) {
  const id = useIdentity()
  const me = useSpace()
  const code = normalizeCode(rawCode)
  const lsKey = `nolter.room.${code}`

  const title = ref('새 놀터')
  const ownerId = ref<string | null>(null)   // 방장(만든 사람) userId. null 이면 ad-hoc 방.
  const strokes = shallowRef<Stroke[]>([])
  const stickies = reactive(new Map<string, Sticky>())
  const events = reactive(new Map<string, EventEntity>())
  const memoText = ref('')
  const memoUpdatedAt = ref(0)
  const memoUpdatedByName = ref('')

  // 방장 제어(영속 config 엔티티에 동기화)
  const lockAll = ref(false)
  const lockedUsers = reactive(new Set<string>())

  const peers = reactive(new Map<string, Peer>())
  const cursors = reactive(new Map<string, Cursor>())
  const liveStrokes = reactive(new Map<string, Stroke>())
  const mode = ref<'live' | 'solo'>(supabaseConfigured ? 'live' : 'solo')
  const connected = ref(false)

  // 내 presence 상태(누적). myPresence() 가 매번 평탄화해서 channel.track() 한다.
  const myState = reactive({
    tool: 'pen' as Tool,
    isDrawing: false,
    tab: 'canvas' as TabKey,
    editing: null as 'memo' | null,
  })

  // 방장 = ownerId 가 내 userId 일 때(서버 pull 시 채워짐).
  const isHost = computed(() => !!ownerId.value && ownerId.value === id.userId)
  const canEdit = computed(() => isHost.value || (!lockAll.value && !lockedUsers.has(id.userId)))

  let channel: RealtimeChannel | null = null

  // ── localStorage ──
  function persistLocal() {
    try {
      localStorage.setItem(lsKey, JSON.stringify({
        title: title.value,
        strokes: strokes.value,
        stickies: [...stickies.values()],
        events: [...events.values()],
        memo: { text: memoText.value, updatedAt: memoUpdatedAt.value, updatedByName: memoUpdatedByName.value },
        config: { lockAll: lockAll.value, lockedUsers: [...lockedUsers] },
      }))
    } catch { /* 용량 초과 등 무시 */ }
  }
  function loadLocal() {
    try {
      const raw = localStorage.getItem(lsKey)
      if (!raw) return
      const d = JSON.parse(raw)
      if (d.title) title.value = d.title
      if (Array.isArray(d.strokes)) strokes.value = d.strokes
      if (Array.isArray(d.stickies)) for (const s of d.stickies) stickies.set(s.id, s)
      if (Array.isArray(d.events)) for (const e of d.events) events.set(e.id, e)
      if (d.memo) {
        memoText.value = d.memo.text ?? ''
        memoUpdatedAt.value = d.memo.updatedAt ?? 0
        memoUpdatedByName.value = d.memo.updatedByName ?? ''
      }
      if (d.config) {
        lockAll.value = !!d.config.lockAll
        for (const u of (d.config.lockedUsers ?? [])) lockedUsers.add(u)
      }
    } catch { /* 손상된 데이터 무시 */ }
  }
  loadLocal()

  // ── 병합 헬퍼 ──
  function mergeStroke(s: Stroke) {
    if (!strokes.value.some(x => x.id === s.id)) strokes.value = [...strokes.value, s]
  }
  function mergeSticky(s: Sticky) {
    const cur = stickies.get(s.id)
    if (!cur || s.updatedAt >= cur.updatedAt) stickies.set(s.id, s)
  }
  function mergeEvent(e: EventEntity) {
    const cur = events.get(e.id)
    if (!cur || e.updatedAt >= cur.updatedAt) events.set(e.id, e)
  }
  function applyMemo(text: string, updatedAt: number, updatedByName: string) {
    if (updatedAt >= memoUpdatedAt.value) {
      memoText.value = text
      memoUpdatedAt.value = updatedAt
      memoUpdatedByName.value = updatedByName
    }
  }
  function applyConfig(c: { lockAll: boolean; lockedUsers: string[] }) {
    lockAll.value = !!c.lockAll
    lockedUsers.clear()
    for (const u of c.lockedUsers || []) lockedUsers.add(u)
  }
  function removeEntity(eid: string) {
    if (strokes.value.some(x => x.id === eid)) strokes.value = strokes.value.filter(x => x.id !== eid)
    stickies.delete(eid)
    events.delete(eid)
  }

  // ── 들어오는 op/cursor 적용(self:false 라 자기 것은 안 옴) ──
  function onOp(op: Op) {
    switch (op.t) {
      case 'stroke:draw':   liveStrokes.set(op.stroke.authorId, op.stroke); break
      case 'stroke:add':    liveStrokes.delete(op.stroke.authorId); mergeStroke(op.stroke); persistLocal(); break
      case 'sticky:upsert': mergeSticky(op.sticky); persistLocal(); break
      case 'event:upsert':  mergeEvent(op.event); persistLocal(); break
      case 'note:set':      applyMemo(op.text, op.updatedAt, op.updatedByName); persistLocal(); break
      case 'config:set':    applyConfig({ lockAll: op.lockAll, lockedUsers: op.lockedUsers }); persistLocal(); break
      case 'delete':        removeEntity(op.id); persistLocal(); break
      case 'title':         title.value = op.title; persistLocal(); break
    }
  }
  function onCursor(p: { sender: string; x: number; y: number }) {
    if (p.sender !== id.userId) cursors.set(p.sender, { x: p.x, y: p.y })
  }

  // ── Presence ──
  function myPresence(): Peer & { userId: string } {
    return {
      userId: id.userId, nickname: me.nickname, colorKey: me.colorKey,
      tool: myState.tool, isDrawing: myState.isDrawing,
      tab: myState.tab, editing: myState.editing, isHost: isHost.value,
    }
  }
  function syncPresence() {
    if (!channel) return
    const state = channel.presenceState<Peer & { userId: string }>()
    const seen = new Set<string>()
    for (const key in state) {
      const meta = state[key]?.[0]
      if (!meta || meta.userId === id.userId) continue
      seen.add(meta.userId)
      peers.set(meta.userId, {
        userId: meta.userId, nickname: meta.nickname, colorKey: meta.colorKey,
        tool: meta.tool, isDrawing: meta.isDrawing,
        tab: meta.tab, editing: meta.editing, isHost: meta.isHost,
      })
    }
    for (const uid of [...peers.keys()]) if (!seen.has(uid)) peers.delete(uid)
    for (const uid of [...cursors.keys()]) if (!seen.has(uid)) cursors.delete(uid)
    for (const uid of [...liveStrokes.keys()]) if (!seen.has(uid)) liveStrokes.delete(uid)
  }

  // pull 응답으로 ownerId 가 늦게 채워지면 isHost 도 그때 바뀐다 → 재트랙.
  watch(isHost, () => { if (channel) channel.track(myPresence()) })

  // ── RPC ──
  // 다양한 엔티티(Stroke/Sticky/Event/memo data/config data) 를 받는 헬퍼라
  // 파라미터 타입은 느슨하게(`any`) — 호출부에서 형태가 보장된다.
  async function rpcUpsert(kind: string, obj: { id: string; authorId?: string } & Record<string, any>) {
    if (!supabase) return
    try {
      await supabase.rpc('room_upsert', {
        p_code: code, p_id: obj.id, p_kind: kind,
        p_author: obj.authorId ?? id.userId, p_data: obj, p_updated_by: id.userId,
      })
    } catch (e) { console.warn('[nolter] upsert 실패', e) }
  }
  async function rpcDelete(eid: string) {
    if (!supabase) return
    try { await supabase.rpc('room_delete', { p_code: code, p_id: eid }) }
    catch (e) { console.warn('[nolter] delete 실패', e) }
  }
  async function pullAndMerge() {
    if (!supabase) return
    try {
      const { data, error } = await supabase.rpc('room_pull', { p_code: code })
      if (error || !data) return
      if (data.title) title.value = data.title
      if (data.ownerId) ownerId.value = data.ownerId
      for (const e of (data.entities ?? [])) {
        if (e.kind === 'stroke') mergeStroke(e.data as Stroke)
        else if (e.kind === 'sticky') mergeSticky(e.data as Sticky)
        else if (e.kind === 'event') mergeEvent(e.data as EventEntity)
        else if (e.kind === 'note' && e.id === MEMO_ID) {
          const d = e.data as { text: string; updatedAt: number; updatedByName: string }
          applyMemo(d.text ?? '', d.updatedAt ?? 0, d.updatedByName ?? '')
        } else if (e.kind === 'config' && e.id === CONFIG_ID) {
          applyConfig(e.data as { lockAll: boolean; lockedUsers: string[] })
        }
      }
      persistLocal()
    } catch (e) { console.warn('[nolter] pull 실패', e) }
  }

  // ── 채널 연결 ──
  async function connect() {
    if (!supabase) return
    const hash = await sha256Hex(code)
    channel = supabase.channel(`room:${hash}`, {
      config: { presence: { key: id.userId }, broadcast: { self: false } },
    })
    channel
      .on('presence', { event: 'sync' }, syncPresence)
      .on('presence', { event: 'leave' }, syncPresence)
      .on('presence', { event: 'join' }, syncPresence)
      .on('broadcast', { event: 'cursor' }, ({ payload }) => onCursor(payload))
      .on('broadcast', { event: 'op' }, ({ payload }) => onOp(payload as Op))
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          connected.value = true
          await pullAndMerge()
          await channel!.track(myPresence())
        }
      })
  }
  connect()

  onBeforeUnmount(async () => {
    if (channel && supabase) {
      try { await channel.untrack() } catch { /* noop */ }
      await supabase.removeChannel(channel)
      channel = null
    }
  })

  // ── 액션 ──
  const sendCursor = useThrottleFn((x: number, y: number) => {
    channel?.send({ type: 'broadcast', event: 'cursor', payload: { sender: id.userId, x, y } })
  }, 40)
  const sendLiveStroke = useThrottleFn((stroke: Stroke) => {
    channel?.send({ type: 'broadcast', event: 'op', payload: { t: 'stroke:draw', sender: id.userId, stroke } })
  }, 55)

  async function pushPresence() { if (channel) await channel.track(myPresence()) }
  function setStatus(patch: Partial<typeof myState>) { Object.assign(myState, patch); pushPresence() }
  function setTab(tab: TabKey) { setStatus({ tab, editing: tab === 'memo' ? myState.editing : null }) }
  function setEditing(target: 'memo' | null) { setStatus({ editing: target }) }

  function commitStroke(stroke: Stroke) {
    if (!canEdit.value) return
    mergeStroke(stroke); persistLocal()
    channel?.send({ type: 'broadcast', event: 'op', payload: { t: 'stroke:add', sender: id.userId, stroke } })
    rpcUpsert('stroke', stroke)
  }
  function upsertSticky(sticky: Sticky) {
    if (!canEdit.value) return
    stickies.set(sticky.id, sticky); persistLocal()
    channel?.send({ type: 'broadcast', event: 'op', payload: { t: 'sticky:upsert', sender: id.userId, sticky } })
    rpcUpsert('sticky', sticky)
  }
  function upsertEvent(event: EventEntity) {
    if (!canEdit.value) return
    events.set(event.id, event); persistLocal()
    channel?.send({ type: 'broadcast', event: 'op', payload: { t: 'event:upsert', sender: id.userId, event } })
    rpcUpsert('event', event)
  }
  function deleteEntity(eid: string) {
    if (!canEdit.value) return
    removeEntity(eid); persistLocal()
    channel?.send({ type: 'broadcast', event: 'op', payload: { t: 'delete', sender: id.userId, id: eid } })
    rpcDelete(eid)
  }
  // 캔버스 전체 초기화 — 모든 stroke + sticky 삭제 (event/memo/config 는 보존).
  function clearCanvas() {
    if (!canEdit.value) return
    const ids: string[] = [
      ...strokes.value.map(s => s.id),
      ...[...stickies.keys()],
    ]
    for (const eid of ids) {
      removeEntity(eid)
      channel?.send({ type: 'broadcast', event: 'op', payload: { t: 'delete', sender: id.userId, id: eid } })
      rpcDelete(eid)
    }
    persistLocal()
  }
  function setTitle(t: string) {
    if (!canEdit.value) return
    title.value = t; persistLocal()
    channel?.send({ type: 'broadcast', event: 'op', payload: { t: 'title', sender: id.userId, title: t } })
    if (supabase) supabase.rpc('room_set_title', { p_code: code, p_title: t }).then(undefined, () => {})
  }

  // 메모: 타이핑 반응성을 위해 로컬은 즉시 반영, 서버/브로드캐스트는 디바운스로 합쳐 전송.
  const sendMemoDebounced = useDebounceFn((text: string) => {
    const upd = Date.now()
    applyMemo(text, upd, me.nickname)
    persistLocal()
    channel?.send({ type: 'broadcast', event: 'op', payload: { t: 'note:set', sender: id.userId, text, updatedBy: id.userId, updatedByName: me.nickname, updatedAt: upd } })
    rpcUpsert('note', { id: MEMO_ID, authorId: id.userId, text, updatedAt: upd, updatedByName: me.nickname })
  }, 250)
  function setMemo(text: string) {
    if (!canEdit.value) return
    memoText.value = text
    sendMemoDebounced(text)
  }

  // ── 방장 제어 ──
  function pushConfig() {
    const cfg = { lockAll: lockAll.value, lockedUsers: [...lockedUsers] }
    persistLocal()
    channel?.send({ type: 'broadcast', event: 'op', payload: { t: 'config:set', sender: id.userId, ...cfg } })
    rpcUpsert('config', { id: CONFIG_ID, authorId: id.userId, ...cfg })
  }
  function setLockAll(b: boolean) { if (!isHost.value) return; lockAll.value = b; pushConfig() }
  function toggleUserLock(uid: string) {
    if (!isHost.value || uid === id.userId) return
    if (lockedUsers.has(uid)) lockedUsers.delete(uid); else lockedUsers.add(uid)
    pushConfig()
  }

  return reactive({
    title, strokes, stickies, events, memoText, memoUpdatedByName,
    peers, cursors, liveStrokes, mode, connected,
    lockAll, lockedUsers, isHost, canEdit,
    sendCursor, sendLiveStroke, setStatus, setTab, setEditing,
    commitStroke, upsertSticky, upsertEvent, deleteEntity, clearCanvas, setTitle, setMemo,
    setLockAll, toggleUserLock,
  })
}

export type Room = ReturnType<typeof useRoom>

