<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Key, Lock, User } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth';
import huasuLogo from '@/assets/huasu-logo.png';

const remembered = localStorage.getItem('hspsi_remember') === '1';
const form = reactive({ username: remembered ? 'admin' : '', password: '', remember: remembered });
const loading = ref(false);
const error = ref('');
const auth = useAuthStore();
const router = useRouter();
function fillDemo() {
  form.username = 'admin';
  form.password = 'admin123';
}
async function submit() {
  error.value = '';
  if (!form.username.trim() || !form.password) {
    error.value = '请输入账号和密码';
    return;
  }
  loading.value = true;
  try {
    await auth.login(form.username, form.password, form.remember);
    const available = auth.menus.filter((m) => m.parent_id !== 0 && m.route);
    const first =
      available.find((m) => m.route === '/dashboard/overview')?.route ??
      available.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))[0]?.route;
    await router.push(first || '/base/vendors');
  } catch (e: any) {
    error.value = e?.response?.data?.message ?? '登录失败，请检查账号和密码';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="login-page">
    <section class="brand-side" aria-label="华溯管家业务管理平台">
      <div class="login-brand">
        <span><img :src="huasuLogo" alt="华溯管家 Logo" /></span>
        <div><strong>华溯管家</strong><small>INVENTORY ERP</small></div>
      </div>
      <div class="brand-visual">
        <div class="visual-grid"><i v-for="n in 12" :key="n" /></div>
      </div>
      <div class="brand-content">
        <p class="platform-note">◇　企业级进销存管理平台</p>
        <h1>让每一笔业务<br />都有清晰去向</h1>
        <p class="brand-desc">采购、销售、生产与库存统一协同，关键经营数据随时可见。</p>
        <div class="feature-pills">
          <span>采购协同</span><span>库存追踪</span><span>经营分析</span>
        </div>
      </div>
      <p class="copyright">© 2026 华溯管家 · 华溯云版权所有</p>
    </section>
    <section class="form-side">
      <div class="login-box">
        <div class="mobile-brand">
          <span><img :src="huasuLogo" alt="华溯管家 Logo" /></span><b>华溯管家</b>
        </div>
        <span class="welcome">欢迎回来</span>
        <h2>登录业务工作台</h2>
        <p class="subtitle">请输入您的企业账号信息</p>
        <el-alert
          v-if="error"
          :title="error"
          type="error"
          :closable="false"
          show-icon
          class="login-error"
        />
        <el-form :model="form" label-position="top" @keyup.enter="submit">
          <el-form-item label="账号"
            ><el-input
              v-model="form.username"
              :prefix-icon="User"
              autocomplete="username"
              placeholder="请输入账号"
          /></el-form-item>
          <el-form-item label="密码"
            ><el-input
              v-model="form.password"
              :prefix-icon="Lock"
              type="password"
              show-password
              autocomplete="current-password"
              placeholder="请输入密码"
          /></el-form-item>
          <div class="login-options">
            <el-checkbox v-model="form.remember">保持登录</el-checkbox><span>忘记密码？</span>
          </div>
          <el-button
            type="primary"
            :icon="Key"
            :loading="loading"
            :disabled="loading"
            class="login-submit"
            @click="submit"
            >登录</el-button
          >
        </el-form>
        <div class="demo-account">
          <div><strong>演示账号</strong><code>admin / admin123</code></div>
          <button @click="fillDemo">填入账号</button>
        </div>
      </div>
      <p class="secure">♢　企业数据安全连接</p>
    </section>
  </main>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(620px, 1.55fr) minmax(420px, 0.75fr);
  background: #fff;
}
.brand-side {
  position: relative;
  overflow: hidden;
  min-height: 100vh;
  padding: 44px 6vw;
  background: #091632;
  color: #fff;
}
.brand-side::before {
  content: '';
  position: absolute;
  z-index: 0;
  inset: 0;
  background: url('@/assets/login-business-bg.png') left center/cover no-repeat;
  filter: saturate(0.92) contrast(1.04) brightness(0.96);
  transform: translateX(28%);
}
.brand-side::after {
  content: '';
  position: absolute;
  z-index: 1;
  inset: 0;
  background:
    radial-gradient(
      circle at 78% 18%,
      rgba(49, 87, 213, 0.18) 0%,
      rgba(49, 87, 213, 0.06) 30%,
      transparent 52%
    ),
    linear-gradient(
      90deg,
      rgba(6, 17, 42, 0.78) 0%,
      rgba(8, 24, 58, 0.55) 38%,
      rgba(16, 41, 91, 0.22) 68%,
      rgba(28, 57, 116, 0.05) 100%
    );
  pointer-events: none;
}
.login-brand {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 12px;
}
.login-brand > span,
.mobile-brand > span {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  padding: 0;
  border-radius: 6px;
  background: #fff;
  box-shadow: 0 8px 24px #00000038;
}
.login-brand img {
  display: block;
  width: 32px;
  height: 32px;
  object-fit: contain;
}
.mobile-brand img {
  display: block;
  width: 28px;
  height: 28px;
  object-fit: contain;
}
.login-brand div {
  display: flex;
  flex-direction: column;
}
.login-brand strong {
  font-size: 21px;
  line-height: 25px;
}
.login-brand small {
  color: #8d9ab0;
  font-size: 8px;
  letter-spacing: 2px;
}
.brand-visual {
  display: none;
}
.visual-grid {
  width: 80%;
  height: 82%;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 28px;
  margin: 40px auto;
  padding: 34px;
}
.visual-grid i {
  border: 1px solid #4e6281;
  background: linear-gradient(145deg, #25364f22, #7184a80d);
}
.brand-content {
  position: relative;
  z-index: 2;
  max-width: 610px;
  margin-top: 16vh;
}
.platform-note {
  color: #aab6c9;
  font-size: 13px;
}
.brand-content h1 {
  margin: 25px 0 22px;
  color: #fff;
  font-size: 52px;
  line-height: 1.25;
  font-weight: 430;
  letter-spacing: 1px;
}
.brand-desc {
  max-width: 560px;
  color: #bec8d7;
  font-size: 16px;
  line-height: 28px;
}
.feature-pills {
  display: flex;
  gap: 12px;
  margin-top: 34px;
}
.feature-pills span {
  min-width: 94px;
  padding: 11px 18px;
  border: 1px solid #3a4658;
  border-radius: 5px;
  background: #1822318a;
  color: #e2e7ef;
  font-size: 12px;
  text-align: center;
}
.copyright {
  position: absolute;
  z-index: 2;
  left: 6vw;
  bottom: 30px;
  color: #768398;
  font-size: 11px;
}
.form-side {
  position: relative;
  display: grid;
  place-items: center;
  padding: 44px;
}
.login-box {
  width: 100%;
  max-width: 365px;
}
.welcome {
  display: block;
  margin-bottom: 13px;
  color: #3157d5;
  font-size: 13px;
  font-weight: 650;
}
.login-box h2 {
  margin: 0 0 8px;
  color: #172033;
  font-size: 30px;
  line-height: 40px;
  font-weight: 430;
}
.subtitle {
  margin: 0 0 32px;
  color: #7c8798;
  font-size: 13px;
}
.login-error {
  margin-bottom: 15px;
}
.login-options {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: -4px 0 16px;
  color: #3157d5;
  font-size: 11px;
}
.login-submit {
  width: 100%;
  height: 50px;
  border: 0;
  border-radius: 6px;
  box-shadow: 0 8px 20px #3157d538;
  font-weight: 650;
}
.demo-account {
  min-height: 58px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 22px;
  padding: 10px 12px;
  border: 1px solid #e1e5eb;
  background: #f8f9fb;
}
.demo-account div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.demo-account strong {
  font-size: 10px;
}
.demo-account code {
  color: #687487;
  font-size: 10px;
  letter-spacing: 1px;
}
.demo-account button {
  height: 30px;
  padding: 0 12px;
  border: 1px solid #d9dee7;
  background: #fff;
  color: #3157d5;
  font-size: 10px;
  cursor: pointer;
}
.secure {
  position: absolute;
  bottom: 20px;
  color: #9aa3b0;
  font-size: 10px;
}
.mobile-brand {
  display: none;
  align-items: center;
  gap: 10px;
  margin-bottom: 28px;
}
.mobile-brand > span {
  width: 36px;
  height: 36px;
}
.login-box :deep(.el-form-item) {
  margin-bottom: 20px;
}
.login-box :deep(.el-form-item__label) {
  padding-bottom: 7px;
  color: #3f4958;
  font-size: 12px;
  font-weight: 650;
}
.login-box :deep(.el-input__wrapper) {
  height: 50px;
  border-radius: 6px;
  box-shadow: 0 0 0 1px #dfe3e9 inset;
}
.login-box :deep(.el-input__wrapper.is-focus) {
  box-shadow:
    0 0 0 1px #3157d5 inset,
    0 0 0 3px #3157d514;
}
@media (max-width: 900px) {
  .login-page {
    grid-template-columns: 1fr;
  }
  .brand-side {
    display: none;
  }
  .form-side {
    min-height: 100vh;
    padding: 30px 22px;
  }
  .mobile-brand {
    display: flex;
  }
  .secure {
    position: static;
    margin-top: 38px;
  }
}
</style>
