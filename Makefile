DENO ?= deno

playground:
	./playground/index.ts --port 9000

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

.PHONY: bootstrap playground
