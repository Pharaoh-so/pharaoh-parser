<template>
  <child-panel :value="total" @change="onChange" />
</template>

<script lang="ts">
import { Component, Vue, Watch } from "vue-property-decorator";
import ChildPanel from "./ChildPanel.vue";

@Component({ components: { ChildPanel } })
export default class Counter extends Vue {
	count = 0;

	get total(): number {
		return this.count * 2;
	}

	mounted(): void {
		this.count = 1;
	}

	@Watch("count")
	onCount(): void {}

	onChange(): void {}

	neverUsed(): void {}
}
</script>
