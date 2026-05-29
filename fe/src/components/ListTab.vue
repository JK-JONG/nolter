<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { useIdentity } from '@/stores/identity'
import { useSpace } from '@/stores/space'
import { newId } from '@/lib/id'
import { colorByKey } from '@/lib/colors'
import type { Room } from '@/composables/useRoom'
import type { ListItem } from '@/lib/types'

const props = defineProps<{ room: Room }>()
const id = useIdentity()
const space = useSpace()

const newText = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

// 정렬: 미완료 먼저, 같은 상태 안에서는 추가 시간순.
const items = computed(() => {
  const arr = [...props.room.listItems.values()] as ListItem[]
  return arr.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1
    return a.updatedAt - b.updatedAt
  })
})
const remaining = computed(() => items.value.filter(i => !i.done).length)

function addItem() {
  const t = newText.value.trim()
  if (!t || !props.room.canEdit) return
  const item: ListItem = {
    id: newId('li'),
    authorId: id.userId, authorName: space.nickname, colorKey: space.colorKey,
    text: t, done: false,
    updatedBy: id.userId, updatedByName: space.nickname, updatedAt: Date.now(),
  }
  props.room.upsertListItem(item)
  newText.value = ''
  nextTick(() => inputRef.value?.focus())
}

function toggle(it: ListItem) {
  if (!props.room.canEdit) return
  props.room.upsertListItem({
    ...it, done: !it.done,
    updatedBy: id.userId, updatedByName: space.nickname, updatedAt: Date.now(),
  })
}

function editText(it: ListItem, e: Event) {
  if (!props.room.canEdit) return
  const v = (e.target as HTMLElement).innerText.trim().slice(0, 200)
  if (v === it.text) return
  props.room.upsertListItem({
    ...it, text: v,
    updatedBy: id.userId, updatedByName: space.nickname, updatedAt: Date.now(),
  })
}

function canDelete(it: ListItem) { return props.room.isHost || it.authorId === id.userId }
function del(it: ListItem) { if (canDelete(it)) props.room.deleteEntity(it.id) }
</script>

<template>
  <div class="list">
    <header class="head">
      <h2>공유 리스트</h2>
      <span v-if="items.length" class="count">{{ remaining }} / {{ items.length }} 남음</span>
      <p v-if="!props.room.canEdit" class="locked">방장이 편집을 막아뒀어요 · 보기 전용</p>
    </header>

    <div v-if="props.room.canEdit" class="add">
      <input ref="inputRef" v-model="newText" class="field"
             placeholder="할 일을 적고 Enter" maxlength="200" @keyup.enter="addItem" />
      <button class="btn btn-primary" :disabled="!newText.trim()" @click="addItem">추가</button>
    </div>

    <ul v-if="items.length" class="items">
      <li v-for="it in items" :key="it.id" class="item"
          :class="{ done: it.done }"
          :style="{ '--c': colorByKey(it.colorKey).base, '--cs': colorByKey(it.colorKey).soft }">
        <button class="check" :aria-pressed="it.done" :disabled="!props.room.canEdit" @click="toggle(it)">
          <svg v-if="it.done" viewBox="0 0 24 24"><path d="M4 12l5 5 11-11"/></svg>
        </button>
        <span
          class="text"
          :contenteditable="props.room.canEdit && !it.done"
          spellcheck="false"
          @blur="editText(it, $event)"
        >{{ it.text }}</span>
        <span class="by">· {{ it.authorName }}</span>
        <button v-if="canDelete(it)" class="del" :disabled="!props.room.canEdit" @click="del(it)" title="삭제">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </li>
    </ul>
    <p v-else class="empty">
      아직 항목이 없어요.<br>
      <template v-if="props.room.canEdit">위에 적고 Enter 하면 바로 추가돼요.</template>
    </p>
  </div>
</template>

<style scoped>
.list { max-width: 720px; margin: 0 auto; padding: 28px 24px 80px; }
.head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.head h2 { font-size: 24px; }
.count { font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 12.5px; color: var(--ink-faint); }
.locked { color: var(--brand-ink); font-size: 12.5px; font-weight: 700; margin: 0 0 0 auto; }

.add { display: flex; gap: 8px; margin-bottom: 14px; padding: 10px; background: var(--surface-2); border-radius: var(--r); }
.add .field { flex: 1; padding: 10px 12px; font-size: 14px; background: var(--surface); }
.add .btn { padding: 10px 16px; font-size: 13px; }

.items { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.item {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  background: var(--surface); border: 1px solid var(--line-soft);
  border-left: 4px solid var(--c); border-radius: var(--r);
  transition: all .15s var(--ease, ease-out);
}
.item.done { opacity: .58; }
.item.done .text { text-decoration: line-through; color: var(--ink-faint); }

.check {
  width: 22px; height: 22px; flex: none; border-radius: 6px;
  border: 2px solid var(--c); background: transparent; cursor: pointer;
  display: grid; place-items: center; color: #fff;
  transition: all .15s var(--ease, ease-out);
}
.check[aria-pressed="true"] { background: var(--c); }
.check svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.check:disabled { cursor: not-allowed; opacity: .5; }

.text {
  flex: 1; min-width: 0; font-size: 14px; line-height: 1.5; color: var(--ink);
  outline: none; border-radius: 4px; padding: 1px 3px; word-break: break-word;
}
.text[contenteditable="true"]:focus { background: var(--brand-soft); }
.by { font-size: 11.5px; color: var(--ink-faint); flex: none; }

.del { border: none; background: transparent; cursor: pointer; color: var(--ink-faint); padding: 5px; border-radius: 8px; display: grid; place-items: center; opacity: 0; transition: opacity .15s; }
.del svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; }
.item:hover .del { opacity: 1; }
.del:hover:not(:disabled) { background: var(--surface-2); color: var(--ink); }

.empty { color: var(--ink-faint); font-size: 13px; text-align: center; padding: 36px 0 14px; margin: 0; line-height: 1.6; }
</style>
