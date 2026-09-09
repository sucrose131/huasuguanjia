import axios from 'axios';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
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
const detailHandoff = createDetailHandoff(() => localStorage.getItem('hspsi_token') ?? '');

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
  (response) => (response.config.responseType === 'blob' ? response : response.data.data),
  async (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('hspsi_token');
      if (location.pathname !== '/login') location.href = '/login';
    }
    let message = error.response?.data?.message;
    if (error.response?.data instanceof Blob) {
      try {
        const payload = JSON.parse(await error.response.data.text()) as { message?: string };
        message = payload.message;
      } catch {
        // 非 JSON 下载错误沿用通用提示。
      }
    }
    ElMessage.error(message ?? '请求失败');
    return Promise.reject(error);
  },
);

function downloadFileName(contentDisposition: unknown, fallback: string) {
  const value = String(contentDisposition ?? '');
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return fallback;
    }
  }
  return value.match(/filename="?([^";]+)"?/i)?.[1] ?? fallback;
}

/** 下载服务端生成的二进制文件；不经过业务 JSON 数据解包和只读参考数据缓存。 */
export async function downloadFile(
  url: string,
  config: AxiosRequestConfig = {},
  fallbackName = 'download.xlsx',
) {
  const response = (await rawGet(url, {
    ...config,
    responseType: 'blob',
    timeout: config.timeout ?? 60_000,
  })) as unknown as AxiosResponse<Blob>;
  const fileName = downloadFileName(response.headers['content-disposition'], fallbackName);
  const objectUrl = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
  return fileName;
}
