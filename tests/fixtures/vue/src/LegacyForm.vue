<template>
  <form @submit.prevent="onSubmit">
    <h2>{{ title }}</h2>
    <UserCard v-for="item in filtered" :key="item.id" :title="item.name" :user="item" />
    <input v-model="draft" @keyup.enter="addItem(draft)" />
    <p v-show="isDirty">{{ summary(items.length) }}</p>
  </form>
</template>

<script>
import UserCard from "./components/UserCard.vue";
import { validate } from "./validate";

export default {
	name: "LegacyForm",
	components: { UserCard },
	props: ["title"],
	data() {
		return { draft: "", items: [] };
	},
	computed: {
		filtered() {
			return this.items.filter((i) => i.name);
		},
		isDirty: {
			get() {
				return this.draft !== "";
			},
			set(value) {
				this.draft = value ? this.draft : "";
			},
		},
	},
	watch: {
		draft(value) {
			this.persist(value);
		},
	},
	mounted() {
		this.persist(this.draft);
	},
	methods: {
		onSubmit() {
			if (validate(this.items)) this.persist(this.items);
		},
		addItem: function (name) {
			this.items.push({ id: String(this.items.length), name });
		},
		summary: (count) => `${count} items`,
		persist(value) {
			localStorage.setItem("draft", JSON.stringify(value));
		},
		neverUsed() {
			return 1;
		},
	},
};
</script>
