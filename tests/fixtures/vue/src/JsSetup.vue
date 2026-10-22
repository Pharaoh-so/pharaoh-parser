<script setup>
import { ref } from "vue";
import Child from "./components/Child.vue";

const count = ref(0);

function increment() {
	count.value++;
}

const double = () => count.value * 2;
</script>

<template>
  <Child :value="double()" @tick="increment" />
  <Child.Item />
  <component :is="Child" />
</template>
