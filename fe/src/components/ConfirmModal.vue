<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, nextTick } from 'vue'

const props = withDefaults(defineProps<{
  open: boolean
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
}>(), {
  title: '확인',
  confirmLabel: '확인',
  cancelLabel: '취소',
  tone: 'default',
})

const emit = defineEmits<{ confirm: []; cancel: [] }>()

const dialogRef = ref<HTMLDivElement | null>(null)
const confirmRef = ref<HTMLButtonElement | null>(null)

function onKey(e: KeyboardEvent) {
  if (!props.open) return
  if (e.key === 'Escape') { e.preventDefault(); emit('cancel') }
  if (e.key === 'Enter')  { e.preventDefault(); emit('confirm') }
}
onMounted(() => { window.addEventListener('keydown', onKey) })
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey) })

// 다이얼로그가 열릴 때 확인 버튼에 포커스 — 키보드 접근성.
function focusConfirm() { nextTick(() => confirmRef.value?.focus()) }
</script>

<template>
  <Transition name="fade">
    <div v-if="open" class="overlay" role="dialog" aria-modal="true" @click.self="emit('cancel')" @vue:mounted="focusConfirm">
      <div ref="dialogRef" class="dialog" :class="{ danger: tone === 'danger' }">
        <h3 class="t">{{ title }}</h3>
        <p class="m">{{ message }}</p>
        <div class="row">
          <button type="button" class="btn ghost" @click="emit('cancel')">{{ cancelLabel }}</button>
          <button ref="confirmRef" type="button" class="btn primary" :class="{ danger: tone === 'danger' }" @click="emit('confirm')">{{ confirmLabel }}</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(20, 18, 28, .42);
  backdrop-filter: blur(3px);
  display: grid; place-items: center;
  padding: 20px;
}
.dialog {
  width: 100%; max-width: 380px;
  background: var(--surface); border-radius: var(--r-lg);
  padding: 22px 22px 16px;
  box-shadow: var(--sh-lg);
  border: 1px solid var(--line-soft);
  animation: pop .18s var(--ease, ease-out);
}
.t { font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 17px; margin: 0 0 8px; color: var(--ink); }
.m { font-size: 14px; line-height: 1.55; color: var(--ink-soft); margin: 0 0 18px; white-space: pre-wrap; }
.row { display: flex; justify-content: flex-end; gap: 8px; }
.btn {
  border: none; cursor: pointer; padding: 9px 16px; border-radius: var(--r-pill);
  font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 13px;
  transition: all .15s var(--ease, ease-out);
}
.btn.ghost { background: var(--surface-2); color: var(--ink-soft); }
.btn.ghost:hover { background: #ECE7E0; color: var(--ink); }
.btn.primary { background: var(--ink); color: #fff; }
.btn.primary:hover { transform: translateY(-1px); box-shadow: var(--sh-sm); }
.btn.primary.danger { background: #C2386F; }
.btn.primary.danger:hover { background: #A22A5B; }

.dialog.danger .t { color: #C2386F; }

.fade-enter-active, .fade-leave-active { transition: opacity .18s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
@keyframes pop { from { transform: scale(.96); opacity: 0; } to { transform: scale(1); opacity: 1; } }
</style>
