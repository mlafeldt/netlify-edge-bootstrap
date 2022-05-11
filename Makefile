DENO ?= deno

playground:
	./playground/index.ts --port 9000

# URLs derived from:
# - https://github.com/netlify/edge-bundler/blob/v1.1.0/src/formats/javascript.ts#L16
# - https://github.com/netlify/edge-bundler/blob/v1.1.0/src/import_map.ts#L6
vendor:
	$(RM) -r vendor
	$(DENO) vendor --force --reload https://edge-bootstrap.netlify.app/bootstrap/index-combined.ts
	$(DENO) vendor --force --reload https://edge-bootstrap.netlify.app/v1/index.ts

.PHONY: playground vendor
