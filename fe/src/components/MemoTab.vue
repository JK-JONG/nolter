<script setup lang="ts">
import { computed } from 'vue'
import { colorByKey } from '@/lib/colors'
import type { Room } from '@/composables/useRoom'

const props = defineProps<{ room: Room }>()

const editingPeer = computed(() => [...props.room.peers.values()].find(p => p.editing === 'memo'))

function onInput(e: Event) { props.room.setMemo((e.target as HTMLTextAreaElement).value) }
function onFocus() { props.room.setEditing('memo') }
function onBlur() { props.room.setEditing(null) }
</script>

<template>
  <div class="memo">
    <header class="memo-head">
      <h2>공유 메모</h2>
      <span v-if="editingPeer" class="editing-pill" :style="{ background: colorByKey(editingPeer.colorKey).label }">
        <span class="ink"></span> {{ editingPeer.nickname }}님이 편집 중
      </span>
      <p v-if="!props.room.canEdit" class="locked">방장이 메모 편집을 막아뒀어요</p>
    </header>

    <textarea
      class="ta" :value="props.room.memoText" :readonly="!props.room.canEdit"
      placeholder="여기에 자유롭게 메모하세요. 모두에게 실시간으로 보여요."
      @input="onInput" @focus="onFocus" @blur="onBlur"
    ></textarea>

    <p v-if="props.room.memoUpdatedByName" class="last">마지막 편집: <b>{{ props.room.memoUpdatedByName }}</b></p>
  </div>
</template>

<style scoped>
.memo { max-width: 720px; margin: 0 auto; padding: 28px 24px 80px; display: flex; flex-direction: column; height: 100%; }
.memo-head { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.memo-head h2 { font-size: 24px; }
.editing-pill { display: inline-flex; align-items: center; gap: 6px; font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 12.5px; padding: 5px 11px; border-radius: var(--r-pill); color: #fff; box-shadow: var(--sh-sm); animation: pop-in .18s var(--ease); }
.editing-pill .ink { width: 2px; height: 12px; background: #fff; animation: blink 1s step-end infinite; }
.locked { color: var(--brand-ink); font-size: 12.5px; font-weight: 700; margin: 0 0 0 auto; }
.ta { flex: 1; min-height: 360px; width: 100%; padding: 18px 20px; background: var(--surface); border: 1.5px solid var(--line); border-radius: var(--r-lg); font-family: 'DM Sans', sans-serif; font-size: 15px; line-height: 1.65; color: var(--ink); resize: vertical; outline: none; transition: border-color .15s, box-shadow .15s; box-shadow: var(--sh-sm); }
.ta:focus { border-color: var(--brand); box-shadow: 0 0 0 4px var(--brand-soft); }
.ta[readonly] { background: var(--surface-2); color: var(--ink-soft); cursor: not-allowed; }
.last { font-size: 12px; color: var(--ink-faint); text-align: right; margin: 10px 4px 0 0; }
.last b { font-weight: 700; color: var(--ink-soft); }
</style>
