<template>
  <li>
    <TreeNode v-for="{ id, label } in children" :key="id" :title="label" />
    <DataTable :rows="rows">
      <template #cell="{ value }">
        <input v-focus="value" @input="api.save(value)" />
      </template>
    </DataTable>
    <span>{{ label() }}</span>
  </li>
</template>

<script setup lang="ts">
import DataTable from "./DataTable.vue";
import * as api from "./api";

const vFocus = { mounted: (el: HTMLElement) => el.focus() };
const rows: string[] = [];
const children: { id: string; label: string }[] = [];

function label(): string {
	return "tree";
}
</script>
