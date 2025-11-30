# netlify-edge-bootstrap

This repo contains the "closed-source" [bootstrap code](src/bootstrap) used to initialize the environment of Netlify Edge Functions as well as the [bundler code](src/bundler) used for deploying them to Deno Deploy.

While the [Edge Functions API](https://docs.netlify.com/build/edge-functions/api/) is decently documented, I was still curious how Netlify actually integrates [Deno](https://deno.com/) as a JavaScript/TypeScript runtime behind the scenes. To that end, I extracted the code and created a [playground](playground) that can run functions locally (similar to `netlify dev`).

I gathered all information contained here by reading the source code of Netlify's [CLI](https://github.com/netlify/cli/tree/main/src/lib/edge-functions) & [edge-bundler](https://github.com/netlify/build/tree/main/packages/edge-bundler) and tinkering with `deno vendor`.

## Usage

**Deno version requirement: >= 1.22, < 2.0**

This project uses `deno vendor` which was deprecated in 1.45 and removed in Deno 2.0.

(See [Deno installation](https://docs.deno.com/runtime/getting_started/installation/) and [version archive](https://github.com/denoland/deno/releases).)

### Commands

Download bootstrap code to `src`:

```console
make bootstrap
```

> **Note:** This fetches from `edge.netlify.com` and overwrites `src/`. Don't hand-edit `src/bootstrap/` if you want to keep changes.

Start playground webserver:

```console
make playground
```

Send requests to playground:

```console
❯ curl -H 'x-nf-edge-functions: hello' -H 'x-nf-request-id: 1234' http://localhost:8000
Hello world

❯ curl -H 'x-nf-edge-functions: up,hello' -H 'x-nf-request-id: 1234' http://localhost:8000
HELLO WORLD

❯ curl -H 'x-nf-edge-functions: up,skip,hello' -H 'x-nf-request-id: 1234' http://localhost:8000
HELLO WORLD
```

`x-nf-edge-functions` must contain a list of functions to be run in the given order. Function handlers are defined [here](playground/netlify/edge-functions).

Bundle functions like Netlify does before deploying to Deno Deploy:

```console
make bundle
```

## Architecture

Netlify deploys edge functions to [Deno Subhosting](https://deno.com/subhosting) as two-layer [eszip](https://github.com/denoland/eszip) bundles:

```
+---------------------------------------+
|           stage1.eszip                |  <- Bootstrap runtime
|  - Request handling & routing         |
|  - Context/geo/cookies/blobs APIs     |
|  - Function chaining logic            |
|  - Loads stage2 at runtime            |
+---------------------------------------+
|           stage2.eszip                |  <- User functions
|  - Your edge function code            |
|  - Function metadata (paths, names)   |
+---------------------------------------+
```

**Stage 1** contains Netlify's bootstrap code (extracted to [`src/bootstrap`](src/bootstrap)). It initializes the runtime environment, sets up globals (`Netlify.env`, `Netlify.context`), and handles incoming requests by chaining through user functions.

**Stage 2** contains your edge functions bundled with metadata. The bootstrap loads this dynamically via the `netlify:bootstrap-stage2` specifier. (The playground loader skips metadata; only `make bundle` generates it.)

This two-stage design allows Netlify to:

- Update bootstrap code independently of user functions
- Share bootstrap across all deployments
- Keep user function bundles small

See [`src/bundler`](src/bundler) and Netlify's [edge-bundler](https://github.com/netlify/build/tree/main/packages/edge-bundler) for the bundling logic.
