<template>
  <Child :handler :on-save />
</template>

<script setup lang="ts">
import Child from "./Child.vue";
function handler() {}
function onSave() {}
</script>
