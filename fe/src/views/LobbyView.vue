<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useIdentity } from '@/stores/identity'
import { useSpace } from '@/stores/space'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import { newRoomCode, normalizeCode, formatCode } from '@/lib/id'
import { USER_COLORS, colorByKey } from '@/lib/colors'

const router = useRouter()
const id = useIdentity()
const space = useSpace()

if (!space.ready) router.replace({ name: 'gate' })

// 방금 만든 방의 코드(공유용 배너)
const createdCode = ref('')
const createdTitle = ref('')

const newTitle = ref('')
const joinInput = ref('')
const msg = ref('')
const busy = ref(false)
const copiedKey = ref('')

const me = computed(() => space.color)

function roomColor(code: string) {
  let h = 0
  for (const c of code) h = (h + c.charCodeAt(0)) % USER_COLORS.length
  return USER_COLORS[h]
}
function enterRoom(code: string) { router.push({ name: 'room', params: { code } }) }

async function createRoom() {
  if (busy.value) return
  const title = newTitle.value.trim() || '새 모임방'
  busy.value = true; msg.value = ''
  try {
    let code: string, finalTitle = title
    if (supabase) {
      const { data, error } = await supabase.rpc('room_create_simple', { p_owner_id: id.userId, p_title: title })
      if (error || !data) { msg.value = '방 생성에 실패했어요.'; return }
      code = data.roomCode; finalTitle = data.title ?? title
    } else {
      // 솔로(서버 없음): 로컬 방 생성
      code = newRoomCode()
    }
    space.addRoom({ roomCode: code, title: finalTitle })
    createdCode.value = code; createdTitle.value = finalTitle
    newTitle.value = ''
  } finally { busy.value = false }
}

async function joinByInvite() {
  if (busy.value) return
  const code = normalizeCode(joinInput.value)
  if (code.length < 8) { msg.value = '방 초대 코드는 8자예요.'; return }
  busy.value = true; msg.value = ''
  try {
    if (supabase) {
      const { data } = await supabase.rpc('room_lookup', { p_code: code })
      if (data?.roomCode) {
        space.addRoom({ roomCode: data.roomCode, title: data.title })
        msg.value = `"${data.title}" 방이 추가됐어요!`
      } else {
        msg.value = '코드가 올바르지 않거나 없는 방이에요.'
        return
      }
    } else {
      // 솔로: 검증 없이 그냥 추가
      space.addRoom({ roomCode: code, title: '모임방' })
      msg.value = '방이 추가됐어요 (솔로 모드 — 다른 사람과 동기화 안 됨).'
    }
    joinInput.value = ''
  } finally { busy.value = false }
}

async function copy(text: string, key: string) {
  try { await navigator.clipboard.writeText(text); copiedKey.value = key; setTimeout(() => copiedKey.value = '', 1500) } catch { /* */ }
}
function leave() { space.logout(); router.replace({ name: 'gate' }) }
function dismissCreated() { createdCode.value = ''; createdTitle.value = '' }
</script>

<template>
  <div class="page bg-dots">
    <div class="wrap">
      <!-- 헤더 -->
      <header class="top">
        <div class="logo"><span class="mark">✦</span> 놀터</div>
        <div class="me">
          <span class="uavatar" :style="{ background: me.base }">{{ (space.nickname || '나').charAt(0) }}</span>
          <div class="me-text">
            <b>{{ space.nickname }} <span v-if="space.isAdmin" class="admintag">ADMIN</span></b>
            <span>{{ me.name }}</span>
          </div>
          <button v-if="space.isAdmin" class="iconbtn" title="설정" @click="router.push({ name: 'admin' })">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
          <button class="iconbtn" title="공간 나가기" @click="leave">
            <svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>
          </button>
        </div>
      </header>

      <!-- 좌상단 액션 — 모두 admin 전용 (방 추가/생성) -->
      <div v-if="space.isAdmin" class="topzone">
        <div class="zone invite-zone">
          <label class="zone-label" for="invite">
            <svg viewBox="0 0 24 24" class="ti"><path d="M9 15l6-6M10 6l1-1a4 4 0 0 1 6 6l-1 1M14 18l-1 1a4 4 0 0 1-6-6l1-1"/></svg>
            초대코드 입력 <span class="admin-only">ADMIN</span>
          </label>
          <div class="zone-row">
            <input id="invite" v-model="joinInput" class="field code-field"
                   placeholder="ABCD-EFGH" maxlength="12" @keyup.enter="joinByInvite" />
            <button class="btn btn-primary" :disabled="busy" @click="joinByInvite">방 추가</button>
          </div>
        </div>

        <div class="zone create-zone">
          <label class="zone-label" for="newtitle">
            <svg viewBox="0 0 24 24" class="ti"><path d="M12 5v14M5 12h14"/></svg>
            새 모임방 만들기 <span class="admin-only">ADMIN</span>
          </label>
          <div class="zone-row">
            <input id="newtitle" v-model="newTitle" class="field"
                   placeholder="방 이름 (선택)" maxlength="40" @keyup.enter="createRoom" />
            <button class="btn btn-ghost" :disabled="busy" @click="createRoom">만들기</button>
          </div>
        </div>
      </div>

      <!-- 방금 만든 방 코드 공유 배너 -->
      <div v-if="createdCode" class="created-card">
        <div class="cc-text">
          <b>"{{ createdTitle }}" 방이 만들어졌어요!</b>
          <span>아래 코드를 친구에게 공유하면 그 친구도 이 방에 들어올 수 있어요.</span>
        </div>
        <code class="cc-code">{{ formatCode(createdCode) }}</code>
        <button class="btn btn-soft" @click="copy(createdCode, 'created')">
          {{ copiedKey === 'created' ? '복사됨!' : '코드 복사' }}
        </button>
        <button class="cc-x" @click="dismissCreated" aria-label="닫기">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>

      <p v-if="msg" class="msg">{{ msg }}</p>

      <!-- 방 목록 -->
      <div class="listhead">
        <h2>내 모임방</h2>
        <span class="count">{{ space.rooms.length }}개</span>
      </div>

      <div v-if="space.rooms.length" class="rooms">
        <div
          v-for="r in space.rooms" :key="r.roomCode" class="roomcard"
          :style="{ '--rc': roomColor(r.roomCode).base, '--rcs': roomColor(r.roomCode).soft, '--rci': roomColor(r.roomCode).ink }"
        >
          <button class="rc-main" @click="enterRoom(r.roomCode)">
            <span class="rc-dot"></span>
            <span class="rc-body">
              <span class="rc-title">{{ r.title }}</span>
              <span class="rc-code">{{ formatCode(r.roomCode) }}</span>
            </span>
            <svg class="rc-arrow" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
          </button>
          <button class="rc-copy" title="방 코드 복사" @click.stop="copy(r.roomCode, r.roomCode)">
            {{ copiedKey === r.roomCode ? '복사됨' : '코드 복사' }}
          </button>
          <button class="rc-remove" title="목록에서 빼기" @click="space.removeRoom(r.roomCode)">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
      </div>
      <div v-else class="empty">
        <div class="emoji">🪧</div>
        <p>아직 추가된 모임방이 없어요.<br>위에서 새 방을 만들거나, 친구한테 받은 코드를 입력해보세요.</p>
      </div>

      <p v-if="!supabaseConfigured" class="solo-note">⚠️ 실시간 동기화가 꺼져 있어요(.env 미설정). 지금은 이 기기 안에서만 동작하는 솔로 모드입니다.</p>
    </div>
  </div>
</template>

<style scoped>
.page { min-height: 100dvh; padding: 32px 20px 80px; }
.wrap { max-width: 760px; margin: 0 auto; }

.top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
.me { display: flex; align-items: center; gap: 10px; background: var(--surface); padding: 7px 8px 7px 10px; border-radius: var(--r-pill); box-shadow: var(--sh-sm); border: 1px solid var(--line-soft); }
.me-text { display: flex; flex-direction: column; line-height: 1.15; }
.me-text b { font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 14px; }
.me-text span { font-size: 11.5px; color: var(--ink-faint); }
.iconbtn { width: 34px; height: 34px; border: none; background: var(--surface-2); border-radius: var(--r-pill); cursor: pointer; display: grid; place-items: center; color: var(--ink-soft); }
.iconbtn svg, .rc-arrow, .rc-remove svg, .cc-x svg, .ti { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.iconbtn:hover { background: var(--brand-soft); color: var(--brand-ink); }

/* 좌상단 액션 존 — admin 전용 (방 추가/생성) */
.topzone { display: grid; grid-template-columns: 1.4fr 1fr; gap: 14px; margin-bottom: 22px; }
.admin-only { display: inline-block; font-family: 'Nunito', sans-serif; font-weight: 900; font-size: 9.5px; letter-spacing: .12em; background: var(--ink); color: #fff; padding: 2px 6px; border-radius: var(--r-pill); margin-left: 4px; vertical-align: middle; }
.admintag { display: inline-block; font-family: 'Nunito', sans-serif; font-weight: 900; font-size: 9px; letter-spacing: .12em; background: var(--ink); color: #fff; padding: 2px 6px; border-radius: var(--r-pill); margin-left: 4px; vertical-align: middle; }
.zone { background: var(--surface); border-radius: var(--r-lg); padding: 16px 18px; box-shadow: var(--sh-sm); border: 1px solid var(--line-soft); }
.zone.invite-zone { border: 2px solid var(--brand); background: linear-gradient(180deg, #FFFBF7 0%, var(--surface) 70%); box-shadow: var(--sh); }
.zone-label { display: flex; align-items: center; gap: 7px; font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 13px; color: var(--ink-soft); margin-bottom: 10px; }
.zone.invite-zone .zone-label { color: var(--brand-ink); font-size: 14px; }
.zone-row { display: flex; gap: 8px; }
.zone-row .field { flex: 1; padding: 11px 13px; font-size: 14px; min-width: 0; }
.zone-row .btn { flex: none; padding: 11px 16px; font-size: 13px; }
.invite-zone .field.code-field { letter-spacing: .12em; font-family: 'Nunito', sans-serif; font-weight: 800; text-transform: uppercase; }

/* 방금 만든 방 배너 */
.created-card { position: relative; display: flex; align-items: center; gap: 14px; padding: 14px 44px 14px 16px; margin-bottom: 18px; background: linear-gradient(135deg, var(--brand-soft), #FFF6EE); border-radius: var(--r-lg); box-shadow: var(--sh-sm); border: 1px solid var(--line-soft); flex-wrap: wrap; }
.cc-text { display: flex; flex-direction: column; line-height: 1.3; flex: 1; min-width: 200px; }
.cc-text b { font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 14px; color: var(--brand-ink); }
.cc-text span { font-size: 12px; color: var(--ink-soft); margin-top: 2px; }
.cc-code { font-family: 'Nunito', sans-serif; font-weight: 900; font-size: 16px; letter-spacing: .08em; color: var(--ink); background: #fff; padding: 6px 12px; border-radius: var(--r-pill); border: 1.5px solid var(--brand); }
.cc-x { position: absolute; top: 8px; right: 8px; width: 24px; height: 24px; border: none; background: transparent; cursor: pointer; color: var(--ink-faint); border-radius: 6px; display: grid; place-items: center; }
.cc-x:hover { background: rgba(0,0,0,.06); color: var(--ink); }

.msg { margin: 0 0 16px; text-align: center; font-size: 13.5px; font-weight: 600; color: var(--brand-ink); }

.listhead { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; }
.listhead h2 { font-size: 22px; }
.count { font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 13px; color: var(--ink-faint); }

.rooms { display: flex; flex-direction: column; gap: 10px; margin-bottom: 24px; }
.roomcard { position: relative; background: var(--surface); border-radius: var(--r-lg); box-shadow: var(--sh-sm); border: 1px solid var(--line-soft); overflow: hidden; transition: box-shadow .18s, transform .15s var(--ease); }
.roomcard:hover { box-shadow: var(--sh); transform: translateY(-1px); }
.rc-main { width: 100%; display: flex; align-items: center; gap: 12px; padding: 13px 40px 13px 16px; border: none; background: transparent; cursor: pointer; text-align: left; }
.rc-dot { width: 12px; height: 12px; border-radius: var(--r-pill); background: var(--rc); flex: none; box-shadow: 0 0 0 4px var(--rcs); }
.rc-body { flex: 1; display: flex; flex-direction: column; line-height: 1.2; min-width: 0; }
.rc-title { font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 15.5px; color: var(--ink); }
.rc-code { font-family: 'Nunito', sans-serif; font-weight: 700; font-size: 11.5px; color: var(--ink-faint); letter-spacing: .08em; margin-top: 2px; }
.rc-arrow { color: var(--ink-faint); }
.rc-copy { position: absolute; top: 50%; right: 38px; transform: translateY(-50%); border: none; background: var(--surface-2); color: var(--ink-soft); font-family: 'Nunito', sans-serif; font-weight: 700; font-size: 11px; padding: 4px 9px; border-radius: var(--r-pill); cursor: pointer; opacity: 0; transition: opacity .15s; }
.roomcard:hover .rc-copy { opacity: 1; }
.rc-copy:hover { background: var(--brand-soft); color: var(--brand-ink); }
.rc-remove { position: absolute; top: 8px; right: 8px; width: 24px; height: 24px; border: none; background: transparent; cursor: pointer; color: var(--ink-faint); border-radius: 6px; display: grid; place-items: center; opacity: 0; transition: opacity .15s; }
.roomcard:hover .rc-remove { opacity: 1; }
.rc-remove:hover { background: var(--surface-2); color: var(--ink); }

.empty { text-align: center; color: var(--ink-soft); padding: 36px 0 40px; }
.empty .emoji { font-size: 46px; margin-bottom: 10px; }
.empty p { font-size: 14px; line-height: 1.6; }

.sync { background: var(--surface); border-radius: var(--r); padding: 10px 14px; box-shadow: var(--sh-sm); border: 1px solid var(--line-soft); margin-top: 18px; }
.sync summary { cursor: pointer; font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 13px; color: var(--ink-soft); list-style: none; }
.sync summary::-webkit-details-marker { display: none; }
.sync summary::before { content: '▸ '; }
.sync[open] summary::before { content: '▾ '; }
.sync-body { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
.sync-body code { font-family: 'Nunito', sans-serif; font-weight: 900; font-size: 15px; letter-spacing: .08em; color: var(--ink); }
.sync-body p { flex: 1 1 100%; font-size: 12px; color: var(--ink-faint); margin: 0; line-height: 1.5; }

.solo-note { margin: 18px 0 0; text-align: center; font-size: 12.5px; color: var(--ink-faint); line-height: 1.5; }

@media (max-width: 640px) {
  .topzone { grid-template-columns: 1fr; }
  .zone-row { flex-direction: column; }
  .zone-row .btn { width: 100%; }
}
</style>
