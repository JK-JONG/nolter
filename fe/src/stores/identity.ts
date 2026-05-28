import { defineStore } from 'pinia'
import { useLocalStorage } from '@vueuse/core'
import { newUserId } from '@/lib/id'

// 디바이스 영구 신원. 재접속해도 같은 사람으로 인식되어 어트리뷰션이 일관됨.
// 프로필(닉네임·색)은 개인 공간(useSpace)에 속한다 — 동기화 코드별로 달라질 수 있으므로 분리.
export const useIdentity = defineStore('identity', () => {
  const userId = useLocalStorage<string>('nolter.userId', '')
  if (!userId.value) userId.value = newUserId()
  return { userId }
})
