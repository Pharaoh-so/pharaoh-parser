/**
 * Vue single-file components (.vue): what is specific to Vue. Finds the script
 * blocks with Vue's own compiler (@vue/compiler-sfc), reads a component's
 * Options API object and its script bindings from the parsed script, and reads
 * which of those the template uses from the compiler's template AST. The
 * TypeScript parser (tree-sitter.ts) parses the script and builds the result.
 */
import type { SFCDescriptor } from "@vue/compiler-sfc";
import { type ScriptSource } from "./embedded-script.js";
import type { ParsedTemplateRef } from "./types.js";
import type { SyntaxNode } from "./wasm-init.js";
/** A .vue file's blocks, read with Vue's compiler. */
export interface VueSfc {
    /** The <script> and <script setup> blocks, laid over the file. */
    script: ScriptSource;
    /** Whether the component has <script setup>, which exposes its bindings to the template. */
    hasScriptSetup: boolean;
    /** `<script src="./x.ts">`: the file holding the script, and the line naming it. */
    scriptSrc?: {
        source: string;
        line: number;
    };
    /** The compiler's parsed blocks, for reading the template. */
    descriptor: SFCDescriptor;
}
/**
 * Read a .vue file's blocks.
 * @param source - The .vue file's text
 * @param relativePath - Its path, for the compiler's messages
 */
export declare function readVueSfc(source: string, relativePath: string): VueSfc;
/**
 * The component's name from its file, as a parent imports it:
 * `user-card.vue` → `UserCard`, `[id].vue` → `Id`.
 */
export declare function componentNameFromPath(relativePath: string): string;
/**
 * Names a <script setup> component's template can use: the top-level imports
 * and declarations of both script blocks. Type-only imports and names bound
 * to compiler macros (`const { title } = defineProps()`, `const emit =
 * defineEmits()`) are left out: those are props and emits, not script code.
 */
export declare function readSetupBindings(root: SyntaxNode): Set<string>;
/** A function an Options API object holds, and how Vue reaches it. */
export interface OptionsMember {
    /** Its key, or the computed property a getter or setter belongs to. */
    name: string;
    /** The method_definition, or the pair whose value may be a function. */
    node: SyntaxNode;
    /**
     * "member": a method or computed property, which the template and `this`
     * reach by name. "runtime": what the Vue runtime calls itself: lifecycle
     * hooks, watchers, `data()`, `setup()` and any other function-valued option.
     */
    reach: "member" | "runtime";
}
/** What a component's Options API object declares. */
export interface OptionsApi {
    members: OptionsMember[];
    /** `components: { UserCard }`: registered name → script name. */
    components: Map<string, string>;
    /** `directives: { focus }`: registered name → script name. */
    directives: Map<string, string>;
    /** `watch: { x: "persist" }`: methods a watcher names, and the line naming each. */
    watcherMethods: {
        name: string;
        line: number;
    }[];
}
/**
 * Read the Options API object a component default-exports: `export default
 * { ... }`, or the object passed to `defineComponent(...)` / `Vue.extend(...)`.
 * @returns null when the script default-exports no object
 */
export declare function readOptionsApi(root: SyntaxNode): OptionsApi | null;
/** What a template's names can resolve to. */
export interface TemplateScope {
    /** <script setup> bindings (see readSetupBindings); empty without <script setup>. */
    setupBindings: ReadonlySet<string>;
    /** Methods and computed properties of the component class (Options API or class component). */
    members: ReadonlySet<string>;
    /** The component class: members belong to it, and its file name refers to it. */
    componentName: string;
    /** Options API `components` registry. */
    components: ReadonlyMap<string, string>;
    /** Options API `directives` registry. */
    directives: ReadonlyMap<string, string>;
}
/**
 * Read which script names a component's template uses, in document order.
 * A name counts only when it resolves to the script: template locals (`v-for`
 * aliases, slot props, handler parameters), props, `data()` keys and globals
 * like `$event` do not. Nothing of the template's text is kept but names.
 */
export declare function readTemplateRefs(descriptor: SFCDescriptor, scope: TemplateScope): ParsedTemplateRef[];
//# sourceMappingURL=vue-sfc.d.ts.map