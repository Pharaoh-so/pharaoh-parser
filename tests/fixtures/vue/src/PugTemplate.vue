<template lang="pug">
button(@click="save") {{ label }}
</template>

<script setup lang="ts">
import Child from "./Child.vue";
const label = "Save";
function save() {}
</script>
