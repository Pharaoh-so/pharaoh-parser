<template>
  <section>
    <SearchBox v-model="query" @update:model-value="onSearch" />
    <ul v-if="hasUsers(users)">
      <li v-for="row in visibleRows(users)" :key="row.id">
        <user-card :title="row.name" :user="row" @select="(id) => remove(id, $event)" />
        <span>{{ formatDate(row.createdAt) }}</span>
      </li>
    </ul>
    <p v-else>{{ emptyMessage }}</p>
    <button v-on:click="reset()">Reset</button>
  </section>
</template>

<script lang="ts">
export interface Row {
	id: string;
	name: string;
	createdAt: Date;
}

export const PAGE_SIZE = 20;
</script>

<script setup lang="ts">
import { computed, ref } from "vue";
import SearchBox from "./components/SearchBox.vue";
import UserCard from "./components/UserCard.vue";
import { formatDate } from "./format";

const { users, emptyMessage } = defineProps<{
	users: Row[];
	emptyMessage: string;
}>();

const query = ref("");

/** Script function that a template loop variable shadows: `row` in v-for. */
function row(): never {
	throw new Error("never called from the template");
}

function hasUsers(list: Row[]): boolean {
	return list.length > 0;
}

function visibleRows(list: Row[]): Row[] {
	return list.filter((r) => r.name.includes(query.value)).slice(0, PAGE_SIZE);
}

function onSearch(value: string) {
	query.value = value;
}

const remove = (id: string, _event: unknown) => {
	console.log("remove", id);
};

function reset() {
	query.value = "";
}

function unusedHelper() {
	return computed(() => 1);
}
</script>

<style scoped>
section {
	padding: 1rem;
}
</style>
