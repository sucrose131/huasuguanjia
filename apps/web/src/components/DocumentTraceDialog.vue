<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api } from '@/api';

type NodeItem = {
  key: string;
  type: string;
  id: string | number;
  no: string;
  label: string;
  depth: number;
};
type EdgeItem = { id: string | number; from: string; to: string; relationKind: string };

const props = defineProps<{
  modelValue: boolean;
  documentType: string;
  documentId: string | number | bigint;
  documentNo?: string;
}>();
const emit = defineEmits<{ (event: 'update:modelValue', value: boolean): void }>();

const loading = ref(false);
const error = ref('');
const root = ref('');
const nodes = ref<NodeItem[]>([]);
const edges = ref<EdgeItem[]>([]);
const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});
const nodeMap = computed(() => new Map(nodes.value.map((item) => [item.key, item])));

function walk(start: string, direction: 'upstream' | 'downstream') {
  const result = new Set<string>();
  let frontier = [start];
  while (frontier.length) {
    const next: string[] = [];
    for (const key of frontier) {
      for (const edge of edges.value) {
        const matched = direction === 'upstream' ? edge.to === key : edge.from === key;
        if (!matched) continue;
        const target = direction === 'upstream' ? edge.from : edge.to;
        if (target !== start && !result.has(target)) {
          result.add(target);
          next.push(target);
        }
      }
    }
    frontier = next;
  }
  return [...result].map((key) => nodeMap.value.get(key)).filter(Boolean) as NodeItem[];
}

const upstream = computed(() => walk(root.value, 'upstream'));
const downstream = computed(() => walk(root.value, 'downstream'));
const related = computed(() => {
  const directional = new Set([...upstream.value, ...downstream.value].map((item) => item.key));
  return nodes.value.filter((item) => item.key !== root.value && !directional.has(item.key));
});
const current = computed(() => nodeMap.value.get(root.value));
const orphan = computed(() => nodes.value.length <= 1);

async function load() {
  if (!props.documentType || !props.documentId) return;
  loading.value = true;
  error.value = '';
  try {
    const result = (await api.get(
      `/document-trace/${props.documentType}/${String(props.documentId)}`,
      {
        params: { maxDepth: 20 },
      },
    )) as any;
    root.value = result.root;
    nodes.value = result.nodes ?? [];
    edges.value = result.edges ?? [];
  } catch (cause: any) {
    error.value = cause?.response?.data?.message ?? '业务链路加载失败';
    nodes.value = [];
    edges.value = [];
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.modelValue, props.documentType, String(props.documentId)],
  ([opened]) => {
    if (opened) load();
  },
);
</script>

<template>
  <el-dialog v-model="visible" title="全链路追溯" width="960px" :close-on-click-modal="false">
    <div v-loading="loading" class="trace-body">
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
      <template v-else-if="!loading">
        <div class="trace-summary">
          <span>当前单据</span>
          <strong>{{ current?.label || documentType }}</strong>
          <code>{{ current?.no || documentNo || documentId }}</code>
          <small>共 {{ nodes.length }} 张关联单据，{{ edges.length }} 条关系</small>
        </div>

        <el-empty v-if="orphan" description="当前单据尚未建立上下游关系" :image-size="72" />
        <div v-else class="trace-columns">
          <section>
            <h4>上游单据</h4>
            <div v-if="!upstream.length" class="trace-empty">无上游单据</div>
            <article v-for="item in upstream" :key="item.key" class="trace-card upstream">
              <span>{{ item.label }}</span>
              <strong>{{ item.no || `ID ${item.id}` }}</strong>
            </article>
          </section>
          <section class="trace-current-column">
            <h4>当前单据</h4>
            <article class="trace-card current">
              <span>{{ current?.label || documentType }}</span>
              <strong>{{ current?.no || documentNo || `ID ${documentId}` }}</strong>
            </article>
          </section>
          <section>
            <h4>下游单据</h4>
            <div v-if="!downstream.length" class="trace-empty">无下游单据</div>
            <article v-for="item in downstream" :key="item.key" class="trace-card downstream">
              <span>{{ item.label }}</span>
              <strong>{{ item.no || `ID ${item.id}` }}</strong>
            </article>
          </section>
        </div>

        <div v-if="edges.length" class="trace-relations">
          <h4>关系明细</h4>
          <div v-for="edge in edges" :key="String(edge.id)" class="trace-relation-row">
            <span
              >{{ nodeMap.get(edge.from)?.label }} ·
              {{ nodeMap.get(edge.from)?.no || nodeMap.get(edge.from)?.id }}</span
            >
            <b
              >→<small>{{ edge.relationKind }}</small></b
            >
            <span
              >{{ nodeMap.get(edge.to)?.label }} ·
              {{ nodeMap.get(edge.to)?.no || nodeMap.get(edge.to)?.id }}</span
            >
          </div>
        </div>
        <div v-if="related.length" class="trace-related">
          <h4>同链路关联分支</h4>
          <p>以下单据通过共同上下游与当前单据相连：</p>
          <div class="trace-related-grid">
            <article v-for="item in related" :key="item.key" class="trace-card related">
              <span>{{ item.label }}</span>
              <strong>{{ item.no || `ID ${item.id}` }}</strong>
            </article>
          </div>
        </div>
      </template>
    </div>
    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
      <el-button type="primary" :loading="loading" @click="load">刷新链路</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.trace-body {
  min-height: 220px;
}
.trace-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid #dfe7f2;
  background: #f7f9fc;
  margin-bottom: 16px;
}
.trace-summary span,
.trace-summary small {
  color: #7b8798;
}
.trace-summary code {
  color: #35549a;
}
.trace-summary small {
  margin-left: auto;
}
.trace-columns {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 14px;
}
.trace-columns h4,
.trace-relations h4,
.trace-related h4 {
  margin: 0 0 10px;
  color: #344054;
}
.trace-current-column {
  border-left: 1px solid #e5e9f0;
  border-right: 1px solid #e5e9f0;
  padding: 0 14px;
}
.trace-card {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 10px 12px;
  margin-bottom: 8px;
  border: 1px solid #e5e9f0;
  background: white;
}
.trace-card span {
  font-size: 12px;
  color: #667085;
}
.trace-card strong {
  color: #1f2a44;
}
.trace-card.upstream {
  border-left: 3px solid #7c8db5;
}
.trace-card.current {
  border-left: 3px solid #315bcc;
  background: #f7f9ff;
}
.trace-card.downstream {
  border-left: 3px solid #35a36f;
}
.trace-card.related {
  border-left: 3px solid #d99a36;
}
.trace-empty {
  color: #98a2b3;
  padding: 18px 8px;
}
.trace-relations,
.trace-related {
  margin-top: 20px;
  border-top: 1px solid #e5e9f0;
  padding-top: 14px;
}
.trace-relation-row {
  display: grid;
  grid-template-columns: 1fr 80px 1fr;
  align-items: center;
  padding: 7px 10px;
  background: #fafbfc;
  margin-bottom: 4px;
  font-size: 13px;
}
.trace-relation-row b {
  display: flex;
  flex-direction: column;
  text-align: center;
  color: #315bcc;
}
.trace-relation-row b small {
  font-size: 10px;
  font-weight: 400;
  color: #98a2b3;
}
.trace-related p {
  margin: 0 0 10px;
  color: #7b8798;
  font-size: 12px;
}
.trace-related-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
@media (max-width: 800px) {
  .trace-columns,
  .trace-related-grid {
    grid-template-columns: 1fr;
  }
  .trace-current-column {
    border: 0;
    padding: 0;
  }
}
</style>
