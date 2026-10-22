<template>
  <div @click="toggle">{{ label(open) }}</div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
	name: "Toggle",
	data() {
		return { open: false };
	},
	methods: {
		toggle(): void {
			this.open = !this.open;
		},
		label(open: boolean): string {
			return open ? "Close" : "Open";
		},
	},
});
</script>
