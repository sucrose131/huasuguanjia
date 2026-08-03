import axios from 'axios';
import { ElMessage } from 'element-plus';
export const api = axios.create({ baseURL: '/api', timeout: 15000 });
api.interceptors.request.use((config) => {
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
