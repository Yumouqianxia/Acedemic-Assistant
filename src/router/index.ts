import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    // Rendered by App.vue's appStage logic; no component needed at root
    component: { template: '<div />' },
  },
  {
    path: '/course/:courseId',
    name: 'course-detail',
    // Actual rendering is handled by App.vue via appStage='courseDetail';
    // this route registration makes the URL meaningful and supports browser history.
    component: { template: '<div />' },
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
