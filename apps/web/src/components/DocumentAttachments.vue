<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '@/api';
import { dateText } from '@/utils/format';

type Attachment = {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
};
const props = defineProps<{ documentType: string; documentId: string | number }>();
const items = ref<Attachment[]>([]);
const loading = ref(false);
const uploading = ref(false);
const canUpload = ref(false);
const canDelete = ref(false);
const limits = ref({ maxSize: 0, maxCount: 0, contentTypes: [] as string[] });

function sizeText(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
async function load() {
  if (!props.documentType || !props.documentId) return;
  loading.value = true;
  try {
    const result = (await api.get(
      `/attachments/${props.documentType}/${props.documentId}`,
    )) as any;
    items.value = result.items ?? [];
    canUpload.value = Boolean(result.canUpload);
    canDelete.value = Boolean(result.canDelete);
    limits.value = result.limits ?? limits.value;
  } finally {
    loading.value = false;
  }
}
async function choose(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (!limits.value.contentTypes.includes(file.type)) {
    ElMessage.warning('该文件格式不允许上传');
    return;
  }
  if (file.size > limits.value.maxSize) {
    ElMessage.warning(`附件不能超过 ${Math.round(limits.value.maxSize / 1024 / 1024)} MB`);
    return;
  }
  uploading.value = true;
  try {
    const signed = (await api.post(
      `/attachments/${props.documentType}/${props.documentId}/upload-url`,
      { fileName: file.name, contentType: file.type, size: file.size },
    )) as any;
    const response = await fetch(signed.uploadUrl, {
      method: 'PUT',
      headers: signed.headers,
      body: file,
    });
    if (!response.ok) throw new Error(`OSS upload failed: ${response.status}`);
    await api.post(`/attachments/${props.documentType}/${props.documentId}/complete`, {
      attachmentId: signed.attachmentId,
      objectKey: signed.objectKey,
      fileName: file.name,
      contentType: file.type,
      size: file.size,
    });
    ElMessage.success('附件上传成功');
    await load();
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message ?? error?.message ?? '附件上传失败');
  } finally {
    uploading.value = false;
  }
}
async function download(item: Attachment) {
  const result = (await api.get(
    `/attachments/${props.documentType}/${props.documentId}/${item.id}/download-url`,
  )) as any;
  window.open(result.url, '_blank', 'noopener,noreferrer');
}
async function preview(item: Attachment) {
  const result = (await api.get(
    `/attachments/${props.documentType}/${props.documentId}/${item.id}/preview-url`,
  )) as any;
  window.open(result.url, '_blank', 'noopener,noreferrer');
}
async function remove(item: Attachment) {
  await ElMessageBox.confirm(`确认删除附件“${item.fileName}”？`, '删除附件', {
    type: 'warning',
  });
  await api.delete(
    `/attachments/${props.documentType}/${props.documentId}/${item.id}`,
  );
  ElMessage.success('附件已删除');
  await load();
}
watch(() => [props.documentType, props.documentId], load);
onMounted(load);
</script>

<template>
  <div class="document-attachments" v-loading="loading">
    <div class="attachment-head">
      <div>
        <strong>单据附件</strong>
        <span class="muted"> {{ items.length }} / {{ limits.maxCount || '—' }}</span>
      </div>
      <label v-if="canUpload" class="attachment-upload">
        <input
          type="file"
          :accept="limits.contentTypes.join(',')"
          :disabled="uploading || items.length >= limits.maxCount"
          @change="choose"
        />
        <el-button
          type="primary"
          plain
          size="small"
          :loading="uploading"
          :disabled="items.length >= limits.maxCount"
        >
          上传附件
        </el-button>
      </label>
    </div>
    <el-empty v-if="!items.length" description="暂无附件" :image-size="52" />
    <div v-else class="attachment-list">
      <div v-for="item in items" :key="item.id" class="attachment-row">
        <div class="attachment-info">
          <span class="attachment-name">{{ item.fileName }}</span>
          <span class="muted">
            {{ sizeText(item.size) }} · {{ dateText(item.uploadedAt, true) }}
          </span>
        </div>
        <div>
          <el-button link type="primary" @click="preview(item)">预览</el-button>
          <el-button link type="primary" @click="download(item)">下载</el-button>
          <el-button v-if="canDelete" link type="danger" @click="remove(item)">删除</el-button>
        </div>
      </div>
    </div>
    <div v-if="!canUpload" class="muted attachment-tip">
      当前单据状态不允许上传附件。
    </div>
  </div>
</template>

<style scoped>
.document-attachments {
  margin-top: 18px;
  padding: 14px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
}
.attachment-head,
.attachment-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.attachment-upload {
  position: relative;
}
.attachment-upload input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}
.attachment-list {
  margin-top: 10px;
}
.attachment-row {
  padding: 9px 0;
  border-top: 1px solid #ebeef5;
}
.attachment-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.attachment-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.muted {
  color: #909399;
  font-size: 12px;
}
.attachment-tip {
  margin-top: 8px;
}
</style>
