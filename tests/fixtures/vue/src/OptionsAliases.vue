<template>
  <span @click="save">{{ formatDate(when) }}</span>
</template>

<script>
import { formatDate } from "./format";

function saveDraft() {}

export default {
	data() {
		return { when: new Date() };
	},
	methods: { formatDate, save: saveDraft },
};
</script>
