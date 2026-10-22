<template>
  <button @click="handler.bind(null)">A</button>
  <button @click="handler.call(null, 1)">B</button>
  <button @click="handler.apply(null, [])">C</button>
  <button @click="api.call(1)">D</button>
  <button v-for="handler in others" :key="handler" @click="handler.bind(null)">E</button>
  <button @click="unknown.bind(null)">F</button>
  <button @click="save.bind(null)">G</button>
</template>

<script setup lang="ts">
import * as api from "./api";
const others: string[] = [];
function handler() {}
</script>
