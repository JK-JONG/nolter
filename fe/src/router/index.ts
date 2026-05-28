import { createRouter, createWebHashHistory } from 'vue-router'
import GateView from '@/views/GateView.vue'

// GitHub Pages 호환을 위해 hash history 사용 (서브경로·새로고침 404 회피).
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'gate', component: GateView },
    { path: '/lobby', name: 'lobby', component: () => import('@/views/LobbyView.vue') },
    { path: '/admin', name: 'admin', component: () => import('@/views/AdminView.vue') },
    {
      // 방 코드는 URL 에 노출되지만 보안은 코드의 고엔트로피에 의존(워크아웃과 동일).
      path: '/r/:code',
      name: 'room',
      component: () => import('@/views/RoomView.vue'),
      props: true,
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

export default router
