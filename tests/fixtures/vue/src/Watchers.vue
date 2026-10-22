<template>
  <p>{{ q }}</p>
</template>

<script>
import { logChange } from "./log";

export default {
	data() {
		return { q: "", r: "" };
	},
	watch: {
		q: { handler: "persist", immediate: true },
		r: ["persist", "log", logChange],
	},
	methods: {
		persist() {},
		log() {},
	},
};
</script>
