<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    disabled?: boolean;
    hasStoredSignature?: boolean;
  }>(),
  {
    modelValue: '',
    disabled: false,
    hasStoredSignature: false,
  },
);
const emit = defineEmits<{ (event: 'update:modelValue', value: string): void }>();

const canvas = ref<HTMLCanvasElement>();
const wrapper = ref<HTMLElement>();
let drawing = false;
let context: CanvasRenderingContext2D | null = null;
let resizeObserver: ResizeObserver | null = null;

function configureCanvas() {
  if (!canvas.value || !wrapper.value) return;
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(320, wrapper.value.clientWidth);
  const height = 150;
  canvas.value.width = Math.floor(width * ratio);
  canvas.value.height = Math.floor(height * ratio);
  canvas.value.style.width = `${width}px`;
  canvas.value.style.height = `${height}px`;
  context = canvas.value.getContext('2d');
  if (!context) return;
  context.scale(ratio, ratio);
  context.lineWidth = 2;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = '#1f2a44';
  renderValue();
}

function renderValue() {
  if (!context || !canvas.value) return;
  const ratio = window.devicePixelRatio || 1;
  context.clearRect(0, 0, canvas.value.width / ratio, canvas.value.height / ratio);
  if (!props.modelValue) return;
  const image = new Image();
  image.onload = () => {
    if (!context || !canvas.value) return;
    context.drawImage(image, 0, 0, canvas.value.width / ratio, canvas.value.height / ratio);
  };
  image.src = props.modelValue;
}

function point(event: PointerEvent) {
  const rect = canvas.value!.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function start(event: PointerEvent) {
  if (props.disabled || !context || !canvas.value) return;
  drawing = true;
  canvas.value.setPointerCapture(event.pointerId);
  const current = point(event);
  context.beginPath();
  context.moveTo(current.x, current.y);
}

function move(event: PointerEvent) {
  if (!drawing || props.disabled || !context) return;
  const current = point(event);
  context.lineTo(current.x, current.y);
  context.stroke();
}

function finish(event: PointerEvent) {
  if (!drawing || !canvas.value) return;
  drawing = false;
  if (canvas.value.hasPointerCapture(event.pointerId))
    canvas.value.releasePointerCapture(event.pointerId);
  emit('update:modelValue', canvas.value.toDataURL('image/png'));
}

function clear() {
  if (props.disabled) return;
  emit('update:modelValue', '');
  nextTick(renderValue);
}

watch(() => props.modelValue, renderValue);
watch(canvas, (value) => {
  if (!value) return;
  nextTick(() => {
    configureCanvas();
    if (wrapper.value) {
      resizeObserver = new ResizeObserver(configureCanvas);
      resizeObserver.observe(wrapper.value);
    }
  });
});
onBeforeUnmount(() => resizeObserver?.disconnect());
</script>

<template>
  <div ref="wrapper" class="signature-pad" :class="{ disabled }">
    <canvas
      ref="canvas"
      aria-label="领用人签字区"
      @pointerdown.prevent="start"
      @pointermove.prevent="move"
      @pointerup.prevent="finish"
      @pointercancel.prevent="finish"
    />
    <div class="signature-actions">
      <span>{{
        modelValue
          ? '已签字'
          : hasStoredSignature
            ? '签名已保存至OSS，可在附件区预览'
            : '请领用人在框内签字确认'
      }}</span>
      <el-button v-if="!disabled" link type="danger" @click="clear">清除重签</el-button>
    </div>
  </div>
</template>

<style scoped>
.signature-pad {
  width: 100%;
  border: 1px solid #dcdfe6;
  background: #fff;
}
.signature-pad canvas {
  display: block;
  touch-action: none;
  cursor: crosshair;
  background: linear-gradient(#fff, #fcfcfd);
}
.signature-pad.disabled canvas {
  cursor: default;
  background: #f5f7fa;
}
.signature-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  border-top: 1px dashed #e4e7ed;
  color: #909399;
  font-size: 12px;
}
</style>
