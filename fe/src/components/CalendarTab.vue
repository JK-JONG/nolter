<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { useIdentity } from '@/stores/identity'
import { useSpace } from '@/stores/space'
import { newId } from '@/lib/id'
import { colorByKey } from '@/lib/colors'
import type { Room } from '@/composables/useRoom'
import type { EventEntity } from '@/lib/types'

const props = defineProps<{ room: Room }>()
const id = useIdentity()
const space = useSpace()

// ── 날짜 헬퍼 ──
function pad(n: number) { return n.toString().padStart(2, '0') }
function makeDateISO(y: number, m: number, d: number) { return `${y}-${pad(m + 1)}-${pad(d)}` }
function todayISO() {
  const t = new Date()
  return makeDateISO(t.getFullYear(), t.getMonth(), t.getDate())
}

const today = todayISO()
const selectedDate = ref(today)
const viewYear = ref(new Date().getFullYear())
const viewMonth = ref(new Date().getMonth()) // 0-11

// ── 폼 ──
const newTitle = ref('')
const newTime = ref('')
const titleInputRef = ref<HTMLInputElement | null>(null)

// ── 데이터 파생 ──
const eventList = computed(() => [...props.room.events.values()] as EventEntity[])
const eventsByDay = computed(() => {
  const m = new Map<string, EventEntity[]>()
  for (const e of eventList.value) {
    const arr = m.get(e.date) ?? []
    arr.push(e)
    m.set(e.date, arr)
  }
  for (const arr of m.values()) arr.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''))
  return m
})
const selectedEvents = computed(() => eventsByDay.value.get(selectedDate.value) ?? [])

const monthLabel = computed(() => `${viewYear.value}년 ${viewMonth.value + 1}월`)
const grid = computed(() => {
  const first = new Date(viewYear.value, viewMonth.value, 1)
  const startWeekday = first.getDay()
  const daysInMonth = new Date(viewYear.value, viewMonth.value + 1, 0).getDate()
  const daysInPrev = new Date(viewYear.value, viewMonth.value, 0).getDate()
  const cells: { date: string; day: number; inMonth: boolean }[] = []
  for (let i = startWeekday - 1; i >= 0; i--) {
    const d = daysInPrev - i
    const py = viewMonth.value === 0 ? viewYear.value - 1 : viewYear.value
    const pm = viewMonth.value === 0 ? 11 : viewMonth.value - 1
    cells.push({ date: makeDateISO(py, pm, d), day: d, inMonth: false })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: makeDateISO(viewYear.value, viewMonth.value, d), day: d, inMonth: true })
  }
  let d = 1
  while (cells.length < 42) {
    const ny = viewMonth.value === 11 ? viewYear.value + 1 : viewYear.value
    const nm = viewMonth.value === 11 ? 0 : viewMonth.value + 1
    cells.push({ date: makeDateISO(ny, nm, d), day: d, inMonth: false })
    d++
  }
  return cells
})

function formatSelected() {
  try {
    return new Date(selectedDate.value + 'T00:00:00').toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })
  } catch { return selectedDate.value }
}

// ── 네비 ──
function prevMonth() {
  if (viewMonth.value === 0) { viewMonth.value = 11; viewYear.value-- } else viewMonth.value--
}
function nextMonth() {
  if (viewMonth.value === 11) { viewMonth.value = 0; viewYear.value++ } else viewMonth.value++
}
function goToday() {
  const t = new Date()
  viewYear.value = t.getFullYear()
  viewMonth.value = t.getMonth()
  selectedDate.value = today
}

function pickDay(cell: { date: string; inMonth: boolean }) {
  selectedDate.value = cell.date
  if (!cell.inMonth) {
    const d = new Date(cell.date + 'T00:00:00')
    viewMonth.value = d.getMonth()
    viewYear.value = d.getFullYear()
  }
  // "캘린더에서 바로 추가" — 셀 클릭 시 폼에 포커스
  if (props.room.canEdit) nextTick(() => titleInputRef.value?.focus())
}

// ── 동작 ──
function addEvent() {
  if (!newTitle.value.trim() || !props.room.canEdit) return
  const ev: EventEntity = {
    id: newId('ev'),
    authorId: id.userId, authorName: space.nickname, colorKey: space.colorKey,
    title: newTitle.value.trim(), date: selectedDate.value, time: newTime.value || undefined,
    updatedBy: id.userId, updatedByName: space.nickname, updatedAt: Date.now(),
  }
  props.room.upsertEvent(ev)
  newTitle.value = ''; newTime.value = ''
  titleInputRef.value?.focus()
}

function canDelete(e: EventEntity) { return props.room.isHost || e.authorId === id.userId }
function del(e: EventEntity) { if (canDelete(e)) props.room.deleteEntity(e.id) }

const weekdays = ['일', '월', '화', '수', '목', '금', '토']
</script>

<template>
  <div class="cal">
    <header class="cal-head">
      <h2>공유 캘린더</h2>
      <p v-if="!props.room.canEdit" class="locked">방장이 일정 편집을 막아뒀어요 · 보기 전용</p>
    </header>

    <div class="layout">
      <!-- ── 왼쪽: 월 그리드 미리보기 ── -->
      <section class="month">
        <div class="month-head">
          <button class="nav" @click="prevMonth" aria-label="이전 달">
            <svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <b class="label">{{ monthLabel }}</b>
          <button class="nav" @click="nextMonth" aria-label="다음 달">
            <svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
          </button>
          <button class="today-btn" @click="goToday">오늘</button>
        </div>

        <div class="dow">
          <span v-for="(w, i) in weekdays" :key="w" :class="{ sun: i === 0, sat: i === 6 }">{{ w }}</span>
        </div>

        <div class="grid">
          <button
            v-for="cell in grid" :key="cell.date" type="button"
            class="cell"
            :class="{
              out: !cell.inMonth,
              today: cell.date === today,
              sel: cell.date === selectedDate,
              has: (eventsByDay.get(cell.date)?.length ?? 0) > 0,
            }"
            @click="pickDay(cell)"
          >
            <span class="dnum">{{ cell.day }}</span>
            <span class="dots">
              <span v-for="e in (eventsByDay.get(cell.date) ?? []).slice(0, 3)" :key="e.id"
                    class="d" :style="{ background: colorByKey(e.colorKey).base }"></span>
              <span v-if="(eventsByDay.get(cell.date)?.length ?? 0) > 3" class="more">
                +{{ (eventsByDay.get(cell.date)?.length ?? 0) - 3 }}
              </span>
            </span>
          </button>
        </div>
      </section>

      <!-- ── 오른쪽: 선택 일자 빠른 등록 + 리스트 ── -->
      <section class="day">
        <div class="day-head">
          <h3>{{ formatSelected() }}</h3>
          <span v-if="selectedDate === today" class="today-chip">오늘</span>
        </div>

        <div v-if="props.room.canEdit" class="quick-add">
          <input ref="titleInputRef" v-model="newTitle" class="field"
                 placeholder="이 날에 일정 추가" maxlength="60" @keyup.enter="addEvent" />
          <div class="row">
            <input v-model="newTime" type="time" class="field time" />
            <button class="btn btn-primary" :disabled="!newTitle.trim()" @click="addEvent">추가</button>
          </div>
        </div>

        <ul v-if="selectedEvents.length" class="items">
          <li v-for="e in selectedEvents" :key="e.id" class="item"
              :style="{ '--c': colorByKey(e.colorKey).base, '--cs': colorByKey(e.colorKey).soft }">
            <span class="dot"></span>
            <div class="meta">
              <b class="t">{{ e.title }}</b>
              <span class="sub"><template v-if="e.time">{{ e.time }} · </template>{{ e.authorName }}</span>
            </div>
            <button v-if="canDelete(e)" class="del" @click="del(e)" title="삭제">
              <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
            </button>
          </li>
        </ul>
        <p v-else class="empty-day">
          이 날엔 아직 일정이 없어요.<br>
          <template v-if="props.room.canEdit">위에 적으면 바로 추가돼요.</template>
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.cal { max-width: 980px; margin: 0 auto; padding: 28px 24px 80px; }
.cal-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }
.cal-head h2 { font-size: 24px; }
.locked { color: var(--brand-ink); font-size: 12.5px; font-weight: 700; margin: 0; }

.layout { display: grid; grid-template-columns: 1.05fr 1fr; gap: 20px; align-items: start; }
@media (max-width: 760px) { .layout { grid-template-columns: 1fr; } }

/* ── 월 그리드 ── */
.month { background: var(--surface); border-radius: var(--r-lg); padding: 18px; box-shadow: var(--sh-sm); border: 1px solid var(--line-soft); }
.month-head { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.month-head .label { font-family: 'Nunito', sans-serif; font-weight: 900; font-size: 17px; flex: 1; text-align: center; letter-spacing: -.01em; }
.nav { width: 32px; height: 32px; border-radius: var(--r-pill); border: none; background: var(--surface-2); cursor: pointer; display: grid; place-items: center; color: var(--ink-soft); transition: all .15s var(--ease); }
.nav:hover { background: var(--brand-soft); color: var(--brand-ink); transform: translateY(-1px); }
.nav svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
.today-btn { border: none; background: var(--surface-2); color: var(--ink-soft); border-radius: var(--r-pill); padding: 6px 13px; font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 12px; cursor: pointer; transition: all .15s; }
.today-btn:hover { background: var(--brand-soft); color: var(--brand-ink); }

.dow { display: grid; grid-template-columns: repeat(7, 1fr); margin-bottom: 6px; }
.dow span { text-align: center; font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 11px; color: var(--ink-faint); padding: 4px 0; }
.dow .sun { color: #E0707F; }
.dow .sat { color: #5AAEFF; }

.grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
.cell { aspect-ratio: 1 / 1.05; border: none; background: transparent; border-radius: 10px; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: space-between; padding: 6px 4px 5px; transition: background .15s; position: relative; }
.cell .dnum { font-family: 'Nunito', sans-serif; font-weight: 700; font-size: 13px; color: var(--ink); position: relative; z-index: 1; }
.cell .dots { display: flex; gap: 2px; align-items: center; height: 8px; }
.cell .dots .d { width: 5px; height: 5px; border-radius: var(--r-pill); }
.cell .dots .more { font-size: 9px; font-weight: 800; color: var(--ink-faint); font-family: 'Nunito', sans-serif; margin-left: 2px; }
.cell.out .dnum { color: var(--ink-faint); opacity: .55; }
.cell:hover:not(.sel) { background: var(--surface-2); }

.cell.today::before { content: ''; position: absolute; top: 4px; left: 50%; transform: translateX(-50%); width: 22px; height: 22px; border-radius: var(--r-pill); border: 1.8px solid var(--brand); }
.cell.today .dnum { color: var(--brand-ink); }

.cell.sel { background: var(--ink); }
.cell.sel .dnum { color: #fff; }
.cell.sel.today::before { border-color: #fff; }
.cell.sel .dots .more { color: rgba(255,255,255,.7); }

/* ── 우측 일자 디테일 ── */
.day { background: var(--surface); border-radius: var(--r-lg); padding: 18px; box-shadow: var(--sh-sm); border: 1px solid var(--line-soft); display: flex; flex-direction: column; gap: 14px; min-height: 280px; }
.day-head { display: flex; align-items: center; gap: 10px; }
.day-head h3 { font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 17px; }
.today-chip { font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 11px; padding: 3px 9px; border-radius: var(--r-pill); background: var(--brand-soft); color: var(--brand-ink); }

.quick-add { display: flex; flex-direction: column; gap: 8px; padding: 10px; background: var(--surface-2); border-radius: var(--r); }
.quick-add .field { padding: 10px 12px; font-size: 14px; background: var(--surface); }
.quick-add .row { display: flex; gap: 8px; }
.quick-add .row .field.time { flex: 1; min-width: 0; }
.quick-add .row .btn { padding: 10px 16px; font-size: 13px; flex: none; }

.items { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: var(--surface); border: 1px solid var(--line-soft); border-left: 4px solid var(--c); border-radius: var(--r); }
.item .dot { width: 9px; height: 9px; border-radius: var(--r-pill); background: var(--c); flex: none; box-shadow: 0 0 0 3px var(--cs); }
.item .meta { flex: 1; min-width: 0; }
.item .t { font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 14px; display: block; }
.item .sub { font-size: 11.5px; color: var(--ink-faint); }
.item .del { border: none; background: transparent; cursor: pointer; color: var(--ink-faint); padding: 5px; border-radius: 8px; display: grid; place-items: center; opacity: 0; transition: opacity .15s; }
.item .del svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; }
.item:hover .del { opacity: 1; }
.item .del:hover { background: var(--surface-2); color: var(--ink); }

.empty-day { color: var(--ink-faint); font-size: 13px; text-align: center; padding: 30px 0 14px; margin: 0; line-height: 1.6; }
</style>
