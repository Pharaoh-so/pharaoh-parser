<template>
  <button @click="/* ; */">A</button>
  <span :title="label // note">{{ count }}</span>
</template>

<script setup lang="ts">
const count = 1;
function label() {}
</script>
