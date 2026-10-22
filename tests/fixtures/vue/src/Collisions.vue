<template>
  <input v-model="total" @keyup.enter="refresh()" />
  <p>{{ total }} {{ label }}</p>
  <button @click="total = 0; count++">Reset</button>
  <button @click="total += 1">Add</button>
</template>

<script>
export default {
	data() {
		return { count: 0 };
	},
	computed: {
		total: {
			get() {
				return this.count;
			},
			set(value) {
				this.count = value;
			},
		},
		label() {
			return `${this.count}`;
		},
	},
	watch: {
		total(value) {
			this.refresh(value);
		},
		refresh() {},
		count: [() => {}, "refresh", { handler() {} }],
	},
	methods: {
		refresh() {},
		label() {
			return "method";
		},
		mounted() {},
	},
	mounted() {},
};
</script>
