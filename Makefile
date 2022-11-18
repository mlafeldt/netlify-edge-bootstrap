DENO    ?= deno
CURL    ?= curl
ESZIP   ?= $(DENO) run --allow-read=. --allow-write=. --allow-net=deno.land --no-check https://deno.land/x/eszip@v0.30.0/eszip.ts
APP_URL ?= https://edge.netlify.com

playground:
	./playground/stage1.ts

bundle:
	./playground/bundle.ts dist
	$(ESZIP) ls dist/stage1.eszip
	$(ESZIP) ls dist/stage2.eszip

# URLs derived from https://github.com/netlify/edge-bundler
bootstrap:
	$(RM) -r src vendor
	$(DENO) vendor --force --reload --no-config \
		$(APP_URL)/index.ts \
		$(APP_URL)/bootstrap/index-combined.ts \
		$(APP_URL)/bootstrap/index-stage1.ts \
		$(APP_URL)/bundler/stage1.ts
	mv -v vendor/edge.netlify.com src
	$(RM) -r vendor

.PHONY: bootstrap bundle playground
