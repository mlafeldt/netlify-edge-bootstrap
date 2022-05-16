DENO ?= deno
CURL ?= curl

playground:
	$(DENO) run --allow-read=. --allow-env=DENO_DEPLOYMENT_ID --allow-net=0.0.0.0 \
		--import-map=./import_map.json --no-remote -L debug ./playground/stage1.ts

# URLs derived from:
# - https://github.com/netlify/edge-bundler/blob/v1.1.0/src/formats/javascript.ts#L16
# - https://github.com/netlify/edge-bundler/blob/v1.1.0/src/import_map.ts#L6
# - https://github.com/netlify/edge-bundler/blob/v1.1.0/deno/bundle.ts#L1
bootstrap:
	$(RM) -r vendor
	$(DENO) vendor --force --reload \
		https://edge-bootstrap.netlify.app/bootstrap/index-combined.ts \
		https://edge-bootstrap.netlify.app/v1/index.ts \
		https://edge-bootstrap.netlify.app/bundler/mod.ts \
		https://edge-bootstrap.netlify.app/bundler/stage1.ts
	$(DENO) vendor --force --reload --import-map ./import_map.json \
		https://edge-bootstrap.netlify.app/bootstrap/index-stage1.ts
# HACK: https://github.com/denoland/deno/issues/14123
	$(CURL) -fsS https://deno.land/x/eszip@v0.18.0/eszip_wasm_bg.wasm > vendor/deno.land/x/eszip@v0.18.0/eszip_wasm_bg.wasm
	$(RM) vendor/import_map.json

.PHONY: bootstrap playground
