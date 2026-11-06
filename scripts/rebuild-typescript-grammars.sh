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
cli_version=0.24.7
javascript_version=0.23.1
javascript_sha256=90e80b25a67517a4daf6ad751557bee21efbda7b7a5a554897933245d1734398
emscripten_image=emscripten/emsdk@sha256:8847dad4171ebc8a53d9ae5cda86a2546ef5b2e68834c14dc1ba2b2962e125cc # 3.1.64

git init --quiet "$source_dir"
git -C "$source_dir" fetch --quiet --depth 1 https://github.com/tree-sitter/tree-sitter-typescript.git "$source_revision"
git -C "$source_dir" checkout --quiet --detach "$source_revision"
git -C "$source_dir" apply "$repo_dir/grammars/typescript-v0.23.2.patch"

# Pin the compressed CLI artifact for each upstream build host before
# decompressing or executing it.
host="$(node -p 'process.platform + "-" + process.arch')"
case "$host" in
	darwin-arm64) cli_platform=macos-arm64; cli_sha256=5ef21da1bb7c9dccbce685ebe264881efc5187688a8fcd2385cb6269dec63905 ;;
	darwin-x64) cli_platform=macos-x64; cli_sha256=42881d42b9d13b5a778f72730e51df1785a75763fbb0e420bbcda7be5e561125 ;;
	linux-arm64) cli_platform=linux-arm64; cli_sha256=bad9cd53adcbd18df33084bb811b8cf7868fffd79437acfc83ac1025e7574c78 ;;
	linux-x64) cli_platform=linux-x64; cli_sha256=628fa0e1c4d78b5d4f7de64b6ab42fc050e3bee14cb92a076beb82d762d76d69 ;;
	linux-ppc64) cli_platform=linux-powerpc64; cli_sha256=09e828cae6a6a12a411d4407d1a9802e0144998a743540445a09542bba1b7d6a ;;
	linux-ia32|linux-x86) cli_platform=linux-x86; cli_sha256=25f04435f4f58a2d970f2904067657b67beaf946ebe791e1f6b651535e7c58d1 ;;
	win32-arm64) cli_platform=windows-arm64; cli_sha256=e33e8159fa17f84122a465f9c623d5e3750bc5023e141d2f6199338d99a29844 ;;
	win32-x64) cli_platform=windows-x64; cli_sha256=fead34f8d8938489dc8356928dd652e40742d81fa697deacee76f7fce69b69ad ;;
	win32-ia32|win32-x86) cli_platform=windows-x86; cli_sha256=abb0d0502081f323da93845ffa847ccfa30e70b4ac21822ee1250d0ba0e83be8 ;;
	*) echo "No pinned Tree-sitter CLI for $host" >&2; exit 1 ;;
esac

fetch_checked() {
	local url="$1" sha256="$2" filename="$3"
	curl --fail --silent --show-error --location --retry 3 \
		--proto '=https' --proto-redir '=https' --output "$filename" "$url"
	if command -v sha256sum >/dev/null; then
		printf '%s  %s\n' "$sha256" "$filename" | sha256sum --check -
	else
		printf '%s  %s\n' "$sha256" "$filename" | shasum -a 256 --check -
	fi
}

cli="$scratch/tree-sitter"
if [[ "$host" == win32-* ]]; then cli="$cli.exe"; fi
fetch_checked "https://github.com/tree-sitter/tree-sitter/releases/download/v$cli_version/tree-sitter-$cli_platform.gz" \
	"$cli_sha256" "$scratch/tree-sitter.gz"
gzip -dc "$scratch/tree-sitter.gz" > "$cli"
chmod +x "$cli"

# Generation only imports the JavaScript grammar source from this package.
fetch_checked "https://registry.npmjs.org/tree-sitter-javascript/-/tree-sitter-javascript-$javascript_version.tgz" \
	"$javascript_sha256" "$scratch/tree-sitter-javascript.tgz"
javascript_dir="$source_dir/node_modules/tree-sitter-javascript"
mkdir -p "$javascript_dir"
tar -xOzf "$scratch/tree-sitter-javascript.tgz" package/grammar.js > "$javascript_dir/grammar.js"

for dialect in typescript tsx; do
	(cd "$source_dir/$dialect" && "$cli" generate --abi 14)
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
