DENO    ?= deno
CURL    ?= curl
ESZIP   ?= $(DENO) run --allow-read=. --allow-write=. --allow-net=deno.land --no-check https://deno.land/x/eszip@v0.19.0/eszip.ts
APP_URL ?= https://edge-bootstrap.netlify.app

playground:
	./playground/stage1.ts

bundle:
	./playground/bundle.ts dist
	$(ESZIP) ls dist/stage1.eszip
	$(ESZIP) ls dist/stage2.eszip

# URLs derived from:
# - https://github.com/netlify/edge-bundler/blob/v1.1.0/src/formats/javascript.ts#L16
# - https://github.com/netlify/edge-bundler/blob/v1.1.0/src/import_map.ts#L6
# - https://github.com/netlify/edge-bundler/blob/v1.1.0/deno/bundle.ts#L1
bootstrap:
	$(RM) -r src vendor
	$(DENO) vendor --force --reload --no-config \
		$(APP_URL)/bootstrap/index-combined.ts \
		$(APP_URL)/v1/index.ts \
		$(APP_URL)/bundler/mod.ts \
		$(APP_URL)/bundler/stage1.ts \
		$(APP_URL)/bootstrap/index-stage1.ts
	mv -v vendor/edge-bootstrap.netlify.app src
	$(RM) -r vendor

.PHONY: bootstrap bundle playground
