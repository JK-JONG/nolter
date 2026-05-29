<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useSpace } from '@/stores/space'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import { formatCode } from '@/lib/id'
import ConfirmModal from '@/components/ConfirmModal.vue'
import { useConfirm } from '@/composables/useConfirm'

const { state: confirmState, ask: askConfirm, resolve: resolveConfirm } = useConfirm()

const router = useRouter()
const space = useSpace()

if (!space.ready) router.replace({ name: 'gate' })
else if (!space.isAdmin) router.replace({ name: 'lobby' })

interface RoomRow {
  code_hash: string; room_code: string | null; title: string; owner_id: string | null
  created_at: string; updated_at: string; entity_count: number
}
interface MemberRow {
  code_hash: string; nickname: string; color_key: string
  room_count: number; version: number; updated_at: string
}

const rooms = ref<RoomRow[]>([])
const members = ref<MemberRow[]>([])
const loading = ref(false)
const error = ref('')
const busy = ref('')  // code_hash currently being deleted

async function load() {
  if (!supabase) return
  loading.value = true; error.value = ''
  try {
    const [r, m] = await Promise.all([
      supabase.rpc('admin_list_rooms'),
      supabase.rpc('admin_list_members'),
    ])
    if (r.error) throw r.error
    if (m.error) throw m.error
    rooms.value = (r.data ?? []) as RoomRow[]
    members.value = (m.data ?? []) as MemberRow[]
  } catch (e: unknown) {
    error.value = (e as Error)?.message ?? '조회 실패'
  } finally {
    loading.value = false
  }
}

async function deleteRoom(row: RoomRow) {
  if (!supabase) return
  const label = row.title || row.room_code || row.code_hash.slice(0, 8)
  const ok = await askConfirm({
    title: '방 삭제',
    message: `방 "${label}" 을(를) 삭제할까요?\n내부 엔티티(획·스티키 등)도 모두 사라집니다.`,
    confirmLabel: '삭제',
    tone: 'danger',
  })
  if (!ok) return
  busy.value = row.code_hash
  try {
    const { error: e } = await supabase.rpc('admin_delete_room', { p_code_hash: row.code_hash })
    if (e) throw e
    rooms.value = rooms.value.filter(r => r.code_hash !== row.code_hash)
  } catch (e: unknown) {
    error.value = (e as Error)?.message ?? '삭제 실패'
  } finally {
    busy.value = ''
  }
}

async function deleteMember(row: MemberRow) {
  if (!supabase) return
  const label = row.nickname || row.code_hash.slice(0, 8)
  const ok = await askConfirm({
    title: '멤버 삭제',
    message: `멤버 "${label}" 의 동기화 공간을 삭제할까요?\n본인 기기에서는 닉네임/방 목록이 유지되지만, 서버 동기화가 끊깁니다.`,
    confirmLabel: '삭제',
    tone: 'danger',
  })
  if (!ok) return
  busy.value = row.code_hash
  try {
    const { error: e } = await supabase.rpc('admin_delete_member', { p_code_hash: row.code_hash })
    if (e) throw e
    members.value = members.value.filter(m => m.code_hash !== row.code_hash)
  } catch (e: unknown) {
    error.value = (e as Error)?.message ?? '삭제 실패'
  } finally {
    busy.value = ''
  }
}

function back() { router.push({ name: 'lobby' }) }
function fmtDate(iso: string) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

onMounted(load)
</script>

<template>
  <div class="page bg-dots">
    <div class="wrap">
      <header class="top">
        <button class="back" @click="back" aria-label="로비로">←</button>
        <h1 class="title">설정</h1>
        <span class="admintag">ADMIN</span>
        <button class="refresh" :disabled="loading" @click="load" title="새로고침">
          <svg viewBox="0 0 24 24"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
        </button>
      </header>

      <p v-if="!supabaseConfigured" class="warn">⚠️ Supabase 미설정 — 실제 데이터를 볼 수 없습니다.</p>
      <p v-if="error" class="err">⚠️ {{ error }}</p>

      <section class="card">
        <div class="sec-head">
          <h2 class="sec-title">모든 모임방</h2>
          <span class="count">{{ rooms.length }}개</span>
        </div>

        <div v-if="loading && rooms.length === 0" class="placeholder">불러오는 중…</div>
        <div v-else-if="rooms.length === 0" class="placeholder">
          <div class="ph-emoji">🗂️</div>
          <p>아직 생성된 방이 없어요.</p>
        </div>
        <table v-else class="tbl">
          <thead>
            <tr><th>제목</th><th>코드</th><th>오너</th><th>엔티티</th><th>생성</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="r in rooms" :key="r.code_hash">
              <td class="strong">{{ r.title }}</td>
              <td><code v-if="r.room_code">{{ formatCode(r.room_code) }}</code><span v-else class="muted">(미공개)</span></td>
              <td><span class="muted">{{ r.owner_id ? r.owner_id.slice(0, 8) + '…' : '—' }}</span></td>
              <td>{{ r.entity_count }}</td>
              <td><span class="muted">{{ fmtDate(r.created_at) }}</span></td>
              <td>
                <button class="del" :disabled="busy === r.code_hash" @click="deleteRoom(r)">
                  {{ busy === r.code_hash ? '…' : '삭제' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="card">
        <div class="sec-head">
          <h2 class="sec-title">모든 멤버</h2>
          <span class="count">{{ members.length }}명</span>
        </div>

        <div v-if="loading && members.length === 0" class="placeholder">불러오는 중…</div>
        <div v-else-if="members.length === 0" class="placeholder">
          <div class="ph-emoji">👥</div>
          <p>아직 등록된 멤버가 없어요.</p>
        </div>
        <table v-else class="tbl">
          <thead>
            <tr><th>닉네임</th><th>색</th><th>방 수</th><th>v</th><th>업데이트</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="m in members" :key="m.code_hash">
              <td class="strong">{{ m.nickname || '—' }}</td>
              <td><span class="muted">{{ m.color_key }}</span></td>
              <td>{{ m.room_count }}</td>
              <td><span class="muted">{{ m.version }}</span></td>
              <td><span class="muted">{{ fmtDate(m.updated_at) }}</span></td>
              <td>
                <button class="del" :disabled="busy === m.code_hash" @click="deleteMember(m)">
                  {{ busy === m.code_hash ? '…' : '삭제' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>

    <ConfirmModal
      :open="confirmState.open"
      :title="confirmState.title"
      :message="confirmState.message"
      :confirm-label="confirmState.confirmLabel"
      :cancel-label="confirmState.cancelLabel"
      :tone="confirmState.tone"
      @confirm="resolveConfirm(true)"
      @cancel="resolveConfirm(false)"
    />
  </div>
</template>

<style scoped>
.page { min-height: 100dvh; padding: 32px 20px 80px; }
.wrap { max-width: 920px; margin: 0 auto; }

.top { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
.back { width: 36px; height: 36px; border-radius: var(--r-pill); border: 1px solid var(--line); background: var(--surface); cursor: pointer; font-size: 17px; color: var(--ink-soft); display: grid; place-items: center; transition: all .15s var(--ease); }
.back:hover { background: var(--surface-2); color: var(--ink); }
.title { font-size: 24px; flex: 1; margin: 0; }
.admintag { font-family: 'Nunito', sans-serif; font-weight: 900; font-size: 11px; letter-spacing: .12em; background: var(--ink); color: #fff; padding: 4px 10px; border-radius: var(--r-pill); }
.refresh { width: 36px; height: 36px; border-radius: var(--r-pill); border: 1px solid var(--line); background: var(--surface); cursor: pointer; color: var(--ink-soft); display: grid; place-items: center; transition: all .15s var(--ease); }
.refresh svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.refresh:hover:not(:disabled) { background: var(--surface-2); color: var(--ink); }
.refresh:disabled { opacity: .5; cursor: wait; }

.warn, .err { background: #FFF6F0; color: #C2386F; border: 1px solid #F4C2C2; padding: 10px 14px; border-radius: var(--r); font-size: 13.5px; margin: 0 0 16px; }
.err { background: #FCE7E7; }

.card { background: var(--surface); border-radius: var(--r-lg); padding: 22px; box-shadow: var(--sh-sm); border: 1px solid var(--line-soft); margin-bottom: 16px; }
.sec-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 14px; }
.sec-title { font-size: 18px; margin: 0; }
.count { font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 12.5px; color: var(--ink-faint); }

.placeholder { text-align: center; padding: 28px 0; color: var(--ink-soft); background: var(--surface-2); border-radius: var(--r); border: 1px dashed var(--line); }
.ph-emoji { font-size: 36px; margin-bottom: 8px; }
.placeholder p { font-size: 13.5px; margin: 0; }

.tbl { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.tbl thead th { text-align: left; font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 11.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-faint); padding: 8px 10px; border-bottom: 1px solid var(--line-soft); }
.tbl tbody td { padding: 10px; border-bottom: 1px solid var(--line-soft); vertical-align: middle; }
.tbl tbody tr:last-child td { border-bottom: none; }
.tbl .strong { font-weight: 700; color: var(--ink); }
.tbl .muted { color: var(--ink-faint); font-size: 12.5px; }
.tbl code { font-family: 'Nunito', sans-serif; font-weight: 700; font-size: 12px; letter-spacing: .06em; background: var(--surface-2); padding: 2px 6px; border-radius: 4px; }

.del { padding: 5px 11px; font-size: 12px; font-family: 'Nunito', sans-serif; font-weight: 700; background: transparent; color: #C2386F; border: 1px solid #F4C2C2; border-radius: var(--r-pill); cursor: pointer; transition: all .15s var(--ease); }
.del:hover:not(:disabled) { background: #C2386F; color: #fff; border-color: #C2386F; }
.del:disabled { opacity: .5; cursor: wait; }

@media (max-width: 640px) {
  .tbl { font-size: 12.5px; }
  .tbl thead th, .tbl tbody td { padding: 6px 6px; }
}
</style>
