<script setup lang="ts">
import { ref, computed } from 'vue'
import { newId } from '@/lib/id'
import { colorByKey, type UserColorKey } from '@/lib/colors'
import type { Stroke, Sticky, Tool } from '@/lib/types'

const props = defineProps<{
  strokes: Stroke[]
  liveStrokeList: Stroke[]            // 남이 지금 그리는 중(라벨 포함)
  stickyList: Sticky[]
  cursorList: { userId: string; x: number; y: number; nickname: string; colorKey: UserColorKey }[]
  tool: Tool
  myColorKey: UserColorKey
  myId: string
  myName: string
  canEdit: boolean                    // false 면 새 입력 차단(커서/조회는 허용)
}>()

const emit = defineEmits<{
  cursor: [x: number, y: number]
  drawMove: [stroke: Stroke]
  commit: [stroke: Stroke]
  stickyAdd: [sticky: Sticky]
  stickyUpdate: [sticky: Sticky]
  del: [id: string]
}>()

const surface = ref<HTMLDivElement | null>(null)
const myStroke = ref<Stroke | null>(null)   // 내가 그리는 중인 획(로컬 렌더)
const drawing = ref(false)

// 지우개 — 마우스 따라다니는 큰 ring + 충돌 검출.
const ERASE_R = 26
const eraserPos = ref<{ x: number; y: number } | null>(null)

function pt(e: PointerEvent): [number, number] {
  const r = surface.value!.getBoundingClientRect()
  return [Math.round(e.clientX - r.left), Math.round(e.clientY - r.top)]
}
function distSegSq(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1
  const lenSq = dx*dx + dy*dy
  let t = 0
  if (lenSq > 0) t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq))
  const qx = x1 + t * dx, qy = y1 + t * dy
  const ex = px - qx, ey = py - qy
  return ex*ex + ey*ey
}
function eraseNear(x: number, y: number) {
  const r2 = ERASE_R * ERASE_R
  for (const s of props.strokes) {
    const pts = s.points
    let hit = false
    for (let i = 0; i + 3 < pts.length; i += 2) {
      if (distSegSq(x, y, pts[i], pts[i+1], pts[i+2], pts[i+3]) <= r2) { hit = true; break }
    }
    if (hit) emit('del', s.id)
  }
}
function widthFor(tool: 'pen' | 'highlighter') { return tool === 'highlighter' ? 16 : 3.5 }
function pointsStr(p: number[]) {
  let s = ''
  for (let i = 0; i < p.length; i += 2) s += `${p[i]},${p[i + 1]} `
  return s.trim()
}
function opacityFor(t: string) { return t === 'highlighter' ? 0.4 : 1 }

// ── 포인터 ──
function onDown(e: PointerEvent) {
  if (!props.canEdit) return
  const [x, y] = pt(e)
  if (props.tool === 'sticky') {
    const s: Sticky = {
      id: newId('st'), authorId: props.myId, authorName: props.myName, colorKey: props.myColorKey,
      x: x - 86, y: y - 20, text: '', updatedBy: props.myId, updatedByName: props.myName, updatedAt: Date.now(),
    }
    emit('stickyAdd', s)
    return
  }
  if (props.tool === 'eraser') {
    surface.value?.setPointerCapture(e.pointerId)
    drawing.value = true  // 드래그 중 계속 지움
    eraseNear(x, y)
    return
  }
  if (props.tool === 'pen' || props.tool === 'highlighter') {
    surface.value?.setPointerCapture(e.pointerId)
    drawing.value = true
    myStroke.value = {
      id: newId('sk'), authorId: props.myId, authorName: props.myName, colorKey: props.myColorKey,
      tool: props.tool, width: widthFor(props.tool), points: [x, y],
    }
  }
}
function onMove(e: PointerEvent) {
  const [x, y] = pt(e)
  emit('cursor', x, y)
  if (props.tool === 'eraser') {
    eraserPos.value = { x, y }
    if (drawing.value) eraseNear(x, y)
    return
  }
  if (drawing.value && myStroke.value) {
    myStroke.value.points.push(x, y)
    emit('drawMove', myStroke.value)
  }
}
function onUp() {
  if (drawing.value && myStroke.value && myStroke.value.points.length >= 2) {
    emit('commit', myStroke.value)
  }
  drawing.value = false
  myStroke.value = null
}
function onLeave() {
  onUp()
  eraserPos.value = null
}

const cursorStyle = computed(() => {
  if (props.tool === 'hand') return 'grab'
  if (props.tool === 'eraser') return 'none'  // 자체 큰 ring cursor 사용
  return 'crosshair'
})

// ── 스티키 드래그 + 편집 ──
const dragId = ref<string | null>(null)
let dragOff = [0, 0]
function stickyDown(e: PointerEvent, s: Sticky) {
  if (!props.canEdit) return
  if ((e.target as HTMLElement).tagName === 'TEXTAREA') return // 편집 중엔 드래그 안 함
  e.stopPropagation()
  const [x, y] = pt(e)
  dragId.value = s.id
  dragOff = [x - s.x, y - s.y]
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
function stickyMove(e: PointerEvent, s: Sticky) {
  emitCursorFromEvent(e)
  if (dragId.value !== s.id) return
  const [x, y] = pt(e)
  emit('stickyUpdate', { ...s, x: x - dragOff[0], y: y - dragOff[1], updatedBy: props.myId, updatedByName: props.myName, updatedAt: Date.now() })
}
function stickyUp() { dragId.value = null }
function emitCursorFromEvent(e: PointerEvent) { const [x, y] = pt(e); emit('cursor', x, y) }
function onStickyText(s: Sticky, text: string) {
  emit('stickyUpdate', { ...s, text, updatedBy: props.myId, updatedByName: props.myName, updatedAt: Date.now() })
}

// 라이브 획 라벨 위치: 획의 마지막 점 근처
function labelPos(s: Stroke) {
  const n = s.points.length
  const x = n >= 2 ? s.points[n - 2] : 0
  const y = n >= 1 ? s.points[n - 1] : 0
  return { left: x + 10 + 'px', top: y - 8 + 'px', background: colorByKey(s.colorKey).label }
}
</script>

<template>
  <div
    ref="surface" class="surface bg-dots"
    :style="{ cursor: cursorStyle }"
    @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointerleave="onLeave"
  >
    <!-- 지우개 cursor (큰 ring) — tool='eraser' 일 때만 -->
    <div
      v-if="tool === 'eraser' && eraserPos"
      class="eraser-cursor"
      :style="{ left: eraserPos.x + 'px', top: eraserPos.y + 'px' }"
      aria-hidden="true"
    ></div>
    <!-- 확정 + 내가 그리는 중 + 남이 그리는 중: 한 SVG 레이어 -->
    <svg class="ink" width="100%" height="100%">
      <polyline
        v-for="s in strokes" :key="s.id"
        :points="pointsStr(s.points)" fill="none"
        :stroke="colorByKey(s.colorKey).base" :stroke-width="s.width"
        :stroke-opacity="opacityFor(s.tool)" stroke-linecap="round" stroke-linejoin="round"
      />
      <polyline
        v-for="s in liveStrokeList" :key="'live-' + s.id"
        :points="pointsStr(s.points)" fill="none"
        :stroke="colorByKey(s.colorKey).base" :stroke-width="s.width"
        :stroke-opacity="opacityFor(s.tool)" stroke-linecap="round" stroke-linejoin="round"
      />
      <polyline
        v-if="myStroke"
        :points="pointsStr(myStroke.points)" fill="none"
        :stroke="colorByKey(myStroke.colorKey).base" :stroke-width="myStroke.width"
        :stroke-opacity="opacityFor(myStroke.tool)" stroke-linecap="round" stroke-linejoin="round"
      />
    </svg>

    <!-- 남이 그리는 중인 획에 이름표(캐치마인드) -->
    <span
      v-for="s in liveStrokeList" :key="'lab-' + s.id" class="stroke-label"
      :style="labelPos(s)"
    >{{ s.authorName }} · 그리는 중</span>

    <!-- 스티키 노트 -->
    <div
      v-for="s in stickyList" :key="s.id" class="sticky"
      :style="{ left: s.x + 'px', top: s.y + 'px', background: colorByKey(s.colorKey).soft, boxShadow: 'var(--sh)' }"
      @pointerdown="stickyDown($event, s)" @pointermove="stickyMove($event, s)" @pointerup="stickyUp"
    >
      <textarea
        class="sticky-text" :style="{ color: colorByKey(s.colorKey).ink }"
        :value="s.text" placeholder="메모…" rows="3" :readonly="!props.canEdit"
        @input="onStickyText(s, ($event.target as HTMLTextAreaElement).value)"
        @pointerdown.stop
      ></textarea>
      <div class="sticky-foot">
        <span class="by" :style="{ color: colorByKey(s.colorKey).ink }">
          <span class="udot" :style="{ background: colorByKey(s.colorKey).base }"></span>{{ s.authorName }}
        </span>
        <button class="sticky-del" @pointerdown.stop @click="emit('del', s.id)" aria-label="삭제">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
    </div>

    <!-- 라이브 커서(남) -->
    <div
      v-for="c in cursorList" :key="c.userId" class="cursor"
      :style="{ transform: `translate(${c.x}px, ${c.y}px)` }"
    >
      <svg width="22" height="22" viewBox="0 0 20 20"><path d="M2 2 L2 16 L6 12 L9 18 L11 17 L8 11 L14 11 Z" :fill="colorByKey(c.colorKey).base" stroke="#fff" stroke-width="1.3"/></svg>
      <span class="tag" :style="{ background: colorByKey(c.colorKey).label }">{{ c.nickname }}</span>
    </div>
  </div>
</template>

<style scoped>
.surface { position: absolute; inset: 0; overflow: hidden; touch-action: none; user-select: none; }
.ink { position: absolute; inset: 0; pointer-events: none; }

.stroke-label {
  position: absolute; font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 11px; color: #fff;
  padding: 2px 8px; border-radius: var(--r-pill); box-shadow: var(--sh-sm); pointer-events: none; white-space: nowrap;
  animation: pop-in .15s var(--ease);
}

.sticky {
  position: absolute; width: 172px; padding: 12px 13px 8px; border-radius: 14px;
  border: 1px solid rgba(0,0,0,.04); transform: rotate(-1.5deg); cursor: grab;
  animation: pop-in .18s var(--ease);
}
.sticky:active { cursor: grabbing; }
.sticky-text {
  width: 100%; border: none; background: transparent; resize: none; outline: none;
  font-family: 'DM Sans', sans-serif; font-size: 14px; line-height: 1.45; font-weight: 500;
}
.sticky-text::placeholder { opacity: .5; }
.sticky-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 4px; }
.sticky .by { display: flex; align-items: center; gap: 6px; font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 11.5px; }
.sticky .udot { width: 11px; height: 11px; }
.sticky-del { border: none; background: transparent; cursor: pointer; color: var(--ink-faint); padding: 4px; border-radius: 8px; display: grid; place-items: center; }
.sticky-del:hover { background: rgba(0,0,0,.06); color: var(--ink); }

.cursor { position: absolute; left: 0; top: 0; z-index: 40; pointer-events: none; will-change: transform; }
.cursor svg { display: block; filter: drop-shadow(0 2px 3px rgba(43,39,51,.25)); }
.cursor .tag {
  position: absolute; left: 16px; top: 16px; white-space: nowrap;
  font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 12.5px; color: #fff;
  padding: 3px 10px; border-radius: var(--r-pill); box-shadow: var(--sh-sm);
}

/* 지우개 ring — 마우스 위치 중심으로 큰 원 */
.eraser-cursor {
  position: absolute; width: 52px; height: 52px;
  border: 2px solid var(--ink); background: rgba(255,255,255,.35);
  border-radius: 50%; pointer-events: none;
  transform: translate(-50%, -50%); z-index: 50;
  box-shadow: 0 0 0 1px rgba(0,0,0,.1), inset 0 0 0 2px rgba(255,255,255,.6);
}
</style>
