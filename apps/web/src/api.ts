import axios from 'axios';
import { ElMessage } from 'element-plus';
import { createDetailHandoff, createReferenceGetCache } from '@/utils/reference-get-cache';
export const api = axios.create({ baseURL: '/api', timeout: 15000 });

// 仅缓存弹框与列表共同依赖的只读参考数据。业务列表、详情、库存和金额接口不缓存。
// 任意写请求都会清空缓存，确保基础资料维护后下一次打开弹框即可取得新数据。
const rawGet = api.get.bind(api);
const referenceGets = createReferenceGetCache(
  (url, config) => rawGet(url, config),
  () => localStorage.getItem('hspsi_token') ?? '',
);
const detailHandoff = createDetailHandoff(
  () => localStorage.getItem('hspsi_token') ?? '',
);

/** 已加载详情交给紧接着挂载的表单消费一次；不形成通用业务数据缓存。 */
export function primeDetailHandoff(url: string, detail: unknown) {
  detailHandoff.prime(url, detail);
}

api.get = ((url: string, config?: Record<string, any>) => {
  const handedOff = detailHandoff.take(url);
  if (handedOff.found) return Promise.resolve(handedOff.detail);
  return referenceGets.get(url, config);
}) as typeof api.get;

api.interceptors.request.use((config) => {
  if (String(config.method ?? 'get').toLowerCase() !== 'get') {
    referenceGets.clear();
    detailHandoff.clear();
  }
  const token = localStorage.getItem('hspsi_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
api.interceptors.response.use(
  (response) => response.data.data,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('hspsi_token');
      if (location.pathname !== '/login') location.href = '/login';
    }
    ElMessage.error(error.response?.data?.message ?? '请求失败');
    return Promise.reject(error);
  },
);
