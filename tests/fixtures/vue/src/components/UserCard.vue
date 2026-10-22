<template>
  <article class="user-card">
    <h3>{{ title }}</h3>
    <button @click="select">Select</button>
  </article>
</template>

<script setup lang="ts">
const props = defineProps<{ title: string; user: { id: string } }>();
const emit = defineEmits<{ select: [id: string] }>();
defineExpose({ select });

function select() {
	emit("select", props.user.id);
}
</script>
