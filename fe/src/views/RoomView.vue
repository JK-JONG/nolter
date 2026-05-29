<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useIdentity } from '@/stores/identity'
import { useSpace } from '@/stores/space'
import { useRoom } from '@/composables/useRoom'
import { formatCode, normalizeCode } from '@/lib/id'
import { colorByKey, type UserColorKey } from '@/lib/colors'
import { supabase } from '@/lib/supabase'
import type { Tool, TabKey, Stroke, Sticky, Peer } from '@/lib/types'
import DrawCanvas from '@/components/DrawCanvas.vue'
import CalendarTab from '@/components/CalendarTab.vue'
import MemoTab from '@/components/MemoTab.vue'

const props = defineProps<{ code: string }>()
const router = useRouter()
const id = useIdentity()       // userId
const space = useSpace()       // 프로필(닉네임·색)

// 공간/프로필 미설정으로 직접 /r/:code 로 들어온 경우 게이트로.
if (!space.ready) router.replace({ name: 'gate' })

// 방 코드 검증: 코드 자체가 짧거나, 내 방 목록에도 없고 서버에도 없는 방이면 로비로.
// 이미 내가 추가한 방이면 통과. 아니면 supabase 가 있을 때 room_lookup 으로 확인 후
// 없는 방이면 차단 (URL 만 찍어서 임의 코드로 들어가는 우회 방지).
const normalized = normalizeCode(props.code)
if (normalized.length < 8) {
  router.replace({ name: 'lobby' })
} else if (!space.hasRoom(normalized) && supabase) {
  ;(async () => {
    try {
      const { data } = await supabase!.rpc('room_lookup', { p_code: normalized })
      if (!data?.roomCode) {
        router.replace({ name: 'lobby' })
      } else {
        // 방이 존재하면 자동으로 내 목록에 추가 (초대 링크 직진입 흐름)
        space.addRoom({ roomCode: data.roomCode, title: data.title })
      }
    } catch { router.replace({ name: 'lobby' }) }
  })()
}

const room = useRoom(props.code)

const tab = ref<TabKey>('canvas')
const tool = ref<Tool>('pen')

function changeTab(t: TabKey) { tab.value = t; room.setTab(t) }
function hostMaybeLock(p: Peer) { if (room.isHost) room.toggleUserLock(p.userId) }

// ── DrawCanvas 로 내려보낼 파생 목록 ──
const liveStrokeList = computed(() => [...room.liveStrokes.values()])
const stickyList = computed(() => [...room.stickies.values()])
const peerList = computed(() => [...room.peers.values()])
const cursorList = computed(() =>
  [...room.cursors.entries()].flatMap(([uid, c]) => {
    const p = room.peers.get(uid)
    return p ? [{ userId: uid, x: c.x, y: c.y, nickname: p.nickname, colorKey: p.colorKey }] : []
  })
)
const drawingPeer = computed(() => peerList.value.find(p => p.isDrawing))
const myColor = computed(() => colorByKey(space.colorKey))

// ── 드로잉 상태 전이(밴드 스팸 방지) ──
let drawingFlag = false
function onDrawMove(stroke: Stroke) {
  room.sendLiveStroke(stroke)
  if (!drawingFlag) { drawingFlag = true; room.setStatus({ tool: tool.value, isDrawing: true }) }
}
function onCommit(stroke: Stroke) {
  room.commitStroke(stroke)
  drawingFlag = false
  room.setStatus({ tool: tool.value, isDrawing: false })
}
function pickTool(t: Tool) { tool.value = t; room.setStatus({ tool: t, isDrawing: false }) }

// ── 초대 링크 복사 ──
const copied = ref(false)
async function invite() {
  try { await navigator.clipboard.writeText(window.location.href); copied.value = true; setTimeout(() => copied.value = false, 1800) }
  catch { /* 클립보드 거부 시 무시 */ }
}

function onTitleInput(e: Event) { room.setTitle((e.target as HTMLElement).innerText.trim().slice(0, 80)) }

function confirmClearCanvas() {
  const n = room.strokes.length + room.stickies.size
  if (n === 0) return
  if (confirm(`캔버스의 획·스티키 ${n}개를 모두 삭제할까요? 되돌릴 수 없어요.`)) {
    room.clearCanvas()
  }
}

const tools: { key: Tool; label: string }[] = [
  { key: 'pen', label: '펜' }, { key: 'highlighter', label: '형광펜' },
  { key: 'sticky', label: '스티키 노트' }, { key: 'eraser', label: '지우개' }, { key: 'hand', label: '이동' },
]
function avatarText(name: string) { return (name || '?').trim().charAt(0) }
</script>

<template>
  <div class="app">
    <!-- 상단 바 -->
    <header class="topbar">
      <button class="logo logobtn" title="로비로" @click="router.push({ name: 'lobby' })"><span class="mark" style="width:26px;height:26px;font-size:13px">✦</span> 놀터</button>

      <div class="room">
        <b class="title" contenteditable spellcheck="false" @blur="onTitleInput">{{ room.title }}</b>
        <span>방 코드 <span class="codepill">{{ formatCode(props.code) }}</span>
          <span v-if="room.mode === 'solo'" class="solo">· 혼자 모드(실시간 꺼짐)</span>
        </span>
      </div>

      <nav class="tabs">
        <button :class="{ on: tab === 'canvas' }" @click="changeTab('canvas')">
          <svg viewBox="0 0 24 24" class="ti"><path d="M3 21l3.5-1 11-11-2.5-2.5-11 11z"/><path d="M14 6l2.5 2.5"/></svg> 캔버스
        </button>
        <button :class="{ on: tab === 'memo' }" @click="changeTab('memo')">
          <svg viewBox="0 0 24 24" class="ti"><path d="M5 4h14v16H5z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg> 메모
        </button>
        <button :class="{ on: tab === 'calendar' }" @click="changeTab('calendar')">
          <svg viewBox="0 0 24 24" class="ti"><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 9h16M8 3v4M16 3v4"/></svg> 캘린더
        </button>
      </nav>

      <div class="presence">
        <span class="uavatar" :style="{ background: myColor.base }" :title="space.nickname + '(나)' + (room.isHost ? ' · 방장' : '')">
          {{ avatarText(space.nickname) }}
          <svg v-if="room.isHost" class="hostbadge" viewBox="0 0 24 24"><path d="M3 19h18M5 8l4 4 3-6 3 6 4-4-2 9H7z"/></svg>
        </span>
        <button
          v-for="p in peerList" :key="p.userId" type="button" class="uavatar peer"
          :class="{ drawing: p.isDrawing, locked: room.lockedUsers.has(p.userId), host: p.isHost, clickable: room.isHost }"
          :style="{ background: colorByKey(p.colorKey).base, '--ring': colorByKey(p.colorKey).base }"
          :title="p.nickname + (p.isHost ? ' · 방장' : '') + (p.isDrawing ? ' · 그리는 중' : '') + (room.lockedUsers.has(p.userId) ? ' · 잠금' : '') + (room.isHost && !p.isHost ? ' · 클릭해서 잠금/해제' : '')"
          @click="hostMaybeLock(p)"
        >
          {{ avatarText(p.nickname) }}
          <svg v-if="p.isHost" class="hostbadge" viewBox="0 0 24 24"><path d="M3 19h18M5 8l4 4 3-6 3 6 4-4-2 9H7z"/></svg>
          <svg v-else-if="room.lockedUsers.has(p.userId)" class="lockbadge" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
        </button>
      </div>

      <button v-if="room.isHost" class="btn lockall" :class="{ on: room.lockAll }" :title="room.lockAll ? '잠금 해제' : '전체 그리기 잠금'" @click="room.setLockAll(!room.lockAll)">
        <svg viewBox="0 0 24 24" class="ti">
          <rect x="5" y="11" width="14" height="9" rx="2"/>
          <path v-if="room.lockAll" d="M8 11V8a4 4 0 0 1 8 0v3"/>
          <path v-else d="M8 11V8a4 4 0 0 1 7-2.7"/>
        </svg>
        {{ room.lockAll ? '전체 잠금' : '잠그기' }}
      </button>

      <button class="btn btn-soft invite" @click="invite">
        <svg viewBox="0 0 24 24" class="ti" style="stroke:currentColor"><path d="M9 15l6-6M10 6l1-1a4 4 0 0 1 6 6l-1 1M14 18l-1 1a4 4 0 0 1-6-6l1-1"/></svg>
        {{ copied ? '복사됨!' : '초대' }}
      </button>
    </header>

    <!-- 본문 -->
    <div class="body">
      <!-- 도구 독 (캔버스 탭에서만) -->
      <aside v-if="tab === 'canvas'" class="dock">
        <button
          v-for="t in tools" :key="t.key" class="tool" :class="{ on: tool === t.key }"
          :title="t.label" :aria-pressed="tool === t.key" @click="pickTool(t.key)"
        >
          <svg v-if="t.key === 'pen'" viewBox="0 0 24 24"><path d="M3 21l3.5-1 11-11-2.5-2.5-11 11z"/><path d="M14 6l2.5 2.5"/></svg>
          <svg v-else-if="t.key === 'highlighter'" viewBox="0 0 24 24"><path d="M9 14l-3 3v3h4l2.5-2.5"/><path d="M12 11l5-5 3 3-5 5z"/></svg>
          <svg v-else-if="t.key === 'sticky'" viewBox="0 0 24 24"><path d="M5 4h14v10l-5 5H5z"/><path d="M14 19v-5h5"/></svg>
          <svg v-else-if="t.key === 'eraser'" viewBox="0 0 24 24"><path d="m7 21-4-4 11-11 4 4-7 7z"/><path d="M21 21H9"/></svg>
          <svg v-else viewBox="0 0 24 24"><path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/></svg>
        </button>
        <div class="sep"></div>
        <div class="mycolor" :style="{ background: myColor.base }" :title="'내 색 · ' + myColor.name"></div>
        <div class="sep"></div>
        <button
          v-if="room.canEdit"
          class="tool clear-all" type="button"
          title="캔버스 전체 초기화 (획·스티키 모두 삭제)"
          @click="confirmClearCanvas"
        >
          <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </aside>

      <!-- 캔버스 -->
      <main v-show="tab === 'canvas'" class="stage">
        <DrawCanvas
          :strokes="room.strokes" :live-stroke-list="liveStrokeList" :sticky-list="stickyList"
          :cursor-list="cursorList" :tool="tool" :my-color-key="space.colorKey as UserColorKey"
          :my-id="id.userId" :my-name="space.nickname" :can-edit="room.canEdit"
          @cursor="room.sendCursor" @draw-move="onDrawMove" @commit="onCommit"
          @sticky-add="(s: Sticky) => room.upsertSticky(s)" @sticky-update="(s: Sticky) => room.upsertSticky(s)"
          @del="(eid: string) => room.deleteEntity(eid)"
        />

        <!-- 보기 전용 배너(방장이 잠갔을 때) -->
        <div v-if="!room.canEdit" class="lockbanner">
          <svg viewBox="0 0 24 24" class="ti" style="width:16px;height:16px"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
          {{ room.lockAll ? '방장이 전체 그리기를 잠갔어요' : '방장이 당신의 그리기를 잠갔어요' }} · 보기 전용
        </div>

        <!-- 라이브 상태 배너 -->
        <div v-if="drawingPeer" class="livebar">
          <span class="uavatar" style="width:26px;height:26px;font-size:11px" :style="{ background: colorByKey(drawingPeer.colorKey).base }">{{ avatarText(drawingPeer.nickname) }}</span>
          <b :style="{ color: colorByKey(drawingPeer.colorKey).ink }">{{ drawingPeer.nickname }}님이 그리는 중</b>
          <span class="dots" :style="{ '--c': colorByKey(drawingPeer.colorKey).base }"><span></span><span></span><span></span></span>
        </div>

        <!-- 줌(시각용 placeholder) -->
        <div class="zoom"><button aria-label="축소">−</button><span>100%</span><button aria-label="확대">+</button></div>
      </main>

      <!-- 메모 / 캘린더 -->
      <main v-show="tab === 'memo'" class="stage tab-stage"><MemoTab :room="room" /></main>
      <main v-show="tab === 'calendar'" class="stage tab-stage"><CalendarTab :room="room" /></main>
    </div>
  </div>
</template>

<style scoped>
.app { display: flex; flex-direction: column; height: 100dvh; overflow: hidden; }

.topbar { display: flex; align-items: center; gap: 16px; padding: 11px 16px; background: var(--surface); border-bottom: 1px solid var(--line); z-index: 30; flex: none; }
.logobtn { border: none; background: transparent; cursor: pointer; padding: 0; transition: transform .15s var(--ease); }
.logobtn:hover { transform: scale(1.04); }
.room { display: flex; flex-direction: column; line-height: 1.15; min-width: 0; }
.room .title { font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 15px; outline: none; border-radius: 6px; padding: 0 2px; }
.room .title:focus { background: var(--brand-soft); }
.room span { font-size: 11.5px; color: var(--ink-faint); display: flex; align-items: center; gap: 5px; }
.room .codepill { font-variant-numeric: tabular-nums; background: var(--surface-2); padding: 1px 7px; border-radius: var(--r-pill); font-weight: 700; color: var(--ink-soft); }
.room .solo { color: var(--brand-ink); font-weight: 700; }

.tabs { display: flex; gap: 4px; margin: 0 auto; background: var(--surface-2); padding: 4px; border-radius: var(--r-pill); flex: none; }
.tabs button { border: none; background: transparent; cursor: pointer; padding: 8px 16px; border-radius: var(--r-pill); font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 13.5px; color: var(--ink-soft); display: flex; align-items: center; gap: 6px; transition: all .18s var(--ease); }
.tabs button.on { background: var(--surface); color: var(--ink); box-shadow: var(--sh-sm); }
.ti { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

.presence { display: flex; align-items: center; }
.presence .uavatar { margin-left: -9px; transition: transform .15s var(--ease); position: relative; }
.presence .uavatar:first-child { margin-left: 0; }
.presence .uavatar:hover { transform: translateY(-3px) scale(1.05); z-index: 5; }
.presence .uavatar.drawing::after { content: ''; position: absolute; inset: -3px; border-radius: var(--r-pill); border: 2.5px solid var(--ring, var(--brand)); animation: ring 1.3s ease-out infinite; }
@keyframes ring { 0% { transform: scale(1); opacity: .7; } 100% { transform: scale(1.35); opacity: 0; } }
.presence .peer { border: 2.5px solid #fff; padding: 0; }
.presence .peer.clickable { cursor: pointer; }
.presence .peer.locked { filter: saturate(.55) opacity(.75); }
.hostbadge { position: absolute; right: -3px; top: -3px; width: 14px; height: 14px; padding: 2px; background: var(--brand); border-radius: var(--r-pill); border: 2px solid #fff; color: #fff; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linejoin: round; }
.lockbadge { position: absolute; right: -4px; bottom: -4px; width: 16px; height: 16px; padding: 2px; background: #2B2733; border-radius: var(--r-pill); border: 2px solid #fff; color: #fff; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }

.lockall { background: var(--surface-2); color: var(--ink-soft); padding: 8px 14px; font-size: 13px; box-shadow: var(--sh-sm); border: 1.5px solid var(--line); }
.lockall:hover { background: #fff; }
.lockall.on { background: var(--ink); color: #fff; border-color: var(--ink); }
.lockall .ti { width: 15px; height: 15px; }

.lockbanner { position: absolute; top: 14px; left: 50%; transform: translateX(-50%); z-index: 28; display: flex; align-items: center; gap: 7px; background: var(--ink); color: #fff; padding: 8px 14px; border-radius: var(--r-pill); font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 12.5px; box-shadow: var(--sh-lg); animation: pop-in .2s var(--ease); }
.lockbanner .ti { stroke: currentColor; fill: none; }

.tab-stage { overflow: auto; background: var(--paper); }

.invite { margin-left: auto; padding: 9px 16px; }

.body { flex: 1; display: flex; min-height: 0; position: relative; }
.dock { width: 60px; flex: none; background: var(--surface); border-right: 1px solid var(--line); display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 14px 0; z-index: 20; }
.tool.clear-all { color: #C2386F; }
.tool.clear-all:hover { background: #FCE7E7; color: #C2386F; }

.tool { width: 42px; height: 42px; border-radius: var(--r-sm); border: none; background: transparent; cursor: pointer; display: grid; place-items: center; color: var(--ink-soft); transition: all .15s var(--ease); }
.tool svg { width: 21px; height: 21px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.tool:hover { background: var(--surface-2); transform: translateY(-1px); }
.tool.on { background: var(--ink); color: #fff; box-shadow: var(--sh-sm); }
.dock .sep { width: 26px; height: 1px; background: var(--line); margin: 6px 0; }
.dock .mycolor { width: 30px; height: 30px; border-radius: var(--r-pill); border: 3px solid #fff; box-shadow: 0 0 0 1.5px var(--line), var(--sh-sm); margin-top: 2px; }

.stage { flex: 1; position: relative; overflow: hidden; }

.livebar { position: absolute; left: 18px; bottom: 18px; z-index: 25; display: flex; gap: 9px; align-items: center; background: var(--surface); padding: 8px 15px 8px 10px; border-radius: var(--r-pill); box-shadow: var(--sh); border: 1px solid var(--line-soft); animation: pop-in .2s var(--ease); }
.livebar b { font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 13px; }
.dots span { display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: var(--c, var(--brand)); margin-left: 2px; animation: jump 1s infinite; }
.dots span:nth-child(2) { animation-delay: .15s; } .dots span:nth-child(3) { animation-delay: .3s; }
@keyframes jump { 0%, 60%, 100% { transform: translateY(0); opacity: .4; } 30% { transform: translateY(-5px); opacity: 1; } }

.zoom { position: absolute; right: 18px; bottom: 18px; z-index: 25; display: flex; align-items: center; gap: 2px; background: var(--surface); padding: 5px; border-radius: var(--r-pill); box-shadow: var(--sh); border: 1px solid var(--line-soft); }
.zoom button { width: 32px; height: 32px; border: none; background: transparent; border-radius: var(--r-pill); cursor: pointer; font-size: 17px; color: var(--ink-soft); }
.zoom button:hover { background: var(--surface-2); }
.zoom span { font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 12.5px; padding: 0 8px; color: var(--ink-soft); font-variant-numeric: tabular-nums; }

.placeholder { display: grid; place-items: center; }
.empty { text-align: center; color: var(--ink-soft); }
.empty .emoji { font-size: 52px; margin-bottom: 12px; }
.empty h2 { font-size: 22px; color: var(--ink); margin-bottom: 8px; }
.empty p { font-size: 14px; line-height: 1.6; }

@media (max-width: 720px) {
  .tabs { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); z-index: 40; box-shadow: var(--sh-lg); }
  .room .title { max-width: 120px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
}
</style>
