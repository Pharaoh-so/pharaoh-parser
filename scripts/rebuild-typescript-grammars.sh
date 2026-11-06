#!/usr/bin/env bash
set -euo pipefail

check=false
case "${1:-}" in
	"") ;;
	--check) check=true ;;
	*) echo "Usage: $0 [--check]" >&2; exit 2 ;;
esac

repo_dir="$(cd "$(dirname "$0")/.." && pwd -P)"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
scratch="$(cd "$scratch" && pwd -P)"
source_dir="$scratch/tree-sitter-typescript"
source_revision=f975a621f4e7f532fe322e13c4f79495e0a7b2e7 # v0.23.2
emscripten_image=emscripten/emsdk@sha256:8847dad4171ebc8a53d9ae5cda86a2546ef5b2e68834c14dc1ba2b2962e125cc # 3.1.64

git init --quiet "$source_dir"
git -C "$source_dir" fetch --quiet --depth 1 https://github.com/tree-sitter/tree-sitter-typescript.git "$source_revision"
git -C "$source_dir" checkout --quiet --detach "$source_revision"
git -C "$source_dir" apply "$repo_dir/grammars/typescript-v0.23.2.patch"

# The generator reads the JS grammar source directly. Only the CLI needs its
# npm install script, which downloads the matching generator binary.
npm install --prefix "$scratch/tools" --ignore-scripts --no-audit --no-fund --no-package-lock \
	tree-sitter-cli@0.24.7 tree-sitter-javascript@0.23.1
cli_dir="$scratch/tools/node_modules/tree-sitter-cli"
(cd "$cli_dir" && node install.js)
ln -s "$scratch/tools/node_modules" "$source_dir/node_modules"

for dialect in typescript tsx; do
	(cd "$source_dir/$dialect" && "$cli_dir/tree-sitter" generate --abi 14)
	docker run --rm --platform linux/amd64 --network none \
		--volume "$source_dir:/src" --workdir "/src/$dialect/src" \
		"$emscripten_image" emcc -o "/src/tree-sitter-$dialect.wasm" \
		-Os -s WASM=1 -s SIDE_MODULE=2 -s TOTAL_MEMORY=33554432 -s NODEJS_CATCH_EXIT=0 \
		-s "EXPORTED_FUNCTIONS=[\"_tree_sitter_$dialect\"]" \
		-fno-exceptions -fvisibility=hidden -I . scanner.c parser.c
done

for dialect in typescript tsx; do
	wasm="tree-sitter-$dialect.wasm"
	if "$check"; then
		cmp "$source_dir/$wasm" "$repo_dir/grammars/$wasm"
	else
		install -m 0644 "$source_dir/$wasm" "$repo_dir/grammars/$wasm"
	fi
done
