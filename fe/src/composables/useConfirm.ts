import { ref } from 'vue'

// 시스템 confirm/alert 대체. Promise<boolean> 반환.
// 사용:
//   const { state, ask, resolve } = useConfirm()
//   if (await ask({ message: '정말?', tone: 'danger' })) { ... }
//
// 단일 컨테이너에서 한 번에 하나만 떠도 충분 — 동일 prompt 가 겹쳐 뜨는 경우는 없음.

export interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
}

export interface ConfirmState extends ConfirmOptions {
  open: boolean
}

export function useConfirm() {
  const state = ref<ConfirmState>({ open: false, message: '' })
  let pending: ((v: boolean) => void) | null = null

  function ask(opts: ConfirmOptions): Promise<boolean> {
    // 이전 promise 가 떠 있으면 cancel 로 마감.
    if (pending) { pending(false); pending = null }
    state.value = { open: true, ...opts }
    return new Promise<boolean>((res) => { pending = res })
  }

  function resolve(v: boolean) {
    state.value = { ...state.value, open: false }
    const p = pending; pending = null
    p?.(v)
  }

  return { state, ask, resolve }
}
