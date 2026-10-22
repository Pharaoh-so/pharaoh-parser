/**
 * Vue single-file components (.vue): what is specific to Vue. Finds the script
 * blocks with Vue's own compiler (@vue/compiler-sfc), reads a component's
 * Options API object and its script bindings from the parsed script, and reads
 * which of those the template uses from the compiler's template AST. The
 * TypeScript parser (tree-sitter.ts) parses the script and builds the result.
 */
import type { SFCDescriptor } from "@vue/compiler-sfc";
import { type ScriptSource } from "./embedded-script.js";
import type { ParsedTemplateRef, ParsedUnverifiedTemplateRefs } from "./types.js";
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
/** What a <script setup> component's template can reach in its script. */
export interface SetupBindings {
    /** Every name (see readSetupBindings). */
    names: Set<string>;
    /** Namespace imports (`import * as api`), whose members are real names (`api.call`). */
    namespaces: Set<string>;
}
/**
 * Names a <script setup> component's template can use: the top-level imports
 * and declarations of both script blocks. Type-only imports and names bound
 * to compiler macros (`const { title } = defineProps()`, `const emit =
 * defineEmits()`) are left out: those are props and emits, not script code.
 */
export declare function readSetupBindings(root: SyntaxNode): SetupBindings;
/** A function an Options API object holds, and how Vue reaches it. */
export interface OptionsMember {
    /**
     * The function's name: its key for a method or option (`save`, `mounted`);
     * for a computed accessor or watcher, its role and key (`get total`,
     * `set total`, `watch draft`, `watch draft[1]` in an array), the way
     * JavaScript names accessors. A method, a computed property and a watcher
     * may share a key; their names never collide.
     */
    name: string;
    /** The key it is declared under: what the template and `this` call it (`total`). */
    key: string;
    /** "get"/"set" for a computed accessor, "watch" for a watcher: its signature's keyword. */
    role?: "get" | "set" | "watch";
    /** The method_definition, the pair, or the array element whose value may be a function. */
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
    /** `methods: { formatDate, save: saveDraft }`: member name → the script function it is. */
    aliases: Map<string, string>;
    /** `components: { UserCard }`: registered name → script name. */
    components: Map<string, string>;
    /** `directives: { focus }`: registered name → script name. */
    directives: Map<string, string>;
    /**
     * What a watcher names instead of holding a function: a method
     * (`"persist"`, `isMethod`) or a script function (`logChange`).
     */
    watcherTargets: {
        name: string;
        line: number;
        isMethod: boolean;
    }[];
}
/**
 * Read the Options API object a component default-exports: `export default
 * { ... }`, the object passed to `defineComponent(...)` / `Vue.extend(...)`,
 * or a class component's `@Component({ ... })` options.
 * @returns null when the script default-exports no such object
 */
export declare function readOptionsApi(root: SyntaxNode): OptionsApi | null;
/**
 * Whether Vue calls a class component's method itself: a lifecycle hook, or
 * a `@Watch(...)` handler (vue-property-decorator).
 */
export declare function isClassComponentHook(name: string, decorators?: readonly string[]): boolean;
/**
 * The component-class functions a template name reaches: its getter for a
 * read, its setter for a write. A method is one function for both.
 */
export interface MemberTargets {
    read?: string;
    write?: string;
}
/** What a template's names can resolve to. */
export interface TemplateScope {
    /** <script setup> bindings; empty without <script setup>. */
    setup: SetupBindings;
    /** Methods and computed properties of the component class, by the name the template uses. */
    members: ReadonlyMap<string, MemberTargets>;
    /** Options API members that stand for a script function (see OptionsApi.aliases). */
    aliases: ReadonlyMap<string, string>;
    /** The component class: members belong to it, and its file name refers to it. */
    componentName: string;
    /** Options API `components` registry. */
    components: ReadonlyMap<string, string>;
    /** Options API `directives` registry. */
    directives: ReadonlyMap<string, string>;
}
/** What a template uses: references read from its AST, and what it may use but couldn't be read. */
export interface TemplateUses {
    refs: ParsedTemplateRef[];
    unverified: ParsedUnverifiedTemplateRefs[];
}
/**
 * Read which script names a component's template uses, in document order.
 * A name counts only when it resolves to the script: template locals (`v-for`
 * aliases, slot props, handler parameters), props, `data()` keys and globals
 * like `$event` do not. A computed property is read through its getter and
 * written through its setter. Nothing of the template's text is kept but names.
 *
 * What can't be read is reported as unverified, never as references: a
 * template in another language or file (`lang="pug"`, `src`) with every name
 * it could use, and an expression that can't be parsed with the names its
 * text contains.
 */
export declare function readTemplateRefs(descriptor: SFCDescriptor, scope: TemplateScope): TemplateUses;
//# sourceMappingURL=vue-sfc.d.ts.map