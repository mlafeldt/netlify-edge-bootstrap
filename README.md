# netlify-edge-bootstrap

This repo contains the "closed-source" [bootstrap code](vendor/edge-bootstrap.netlify.app/bootstrap) used to initialize the environment of Netlify Edge Functions as well as the [bundler code](vendor/edge-bootstrap.netlify.app/bundler) used for deploying them to Deno Deploy.

While the [Edge Functions API](https://docs.netlify.com/netlify-labs/experimental-features/edge-functions/api/) is decently documented, I was still curious how Netlify actually integrates [Deno](https://deno.land/) as a JavaScript/TypeScript runtime behind the scenes. To that end, I extracted the code and created a [playground](playground) that can run functions locally (similar to `netlify dev`).

I gathered all information contained here by reading the source code of Netlify's [CLI](https://github.com/netlify/cli/tree/main/src/lib/edge-functions) & [Edge Bundler](https://github.com/netlify/edge-bundler) and tinkering with `deno vendor`.

## Usage

(Make sure to [install Deno](https://deno.land/manual/getting_started/installation) version 1.22 or higher first.)

Download current bootstrap code to vendor folder:

```console
make bootstrap
```

Start playground webserver:

```console
make playground
```

Send requests to playground:

```console
❯ curl -H 'x-deno-functions: hello' -H 'x-deno-pass: passthrough' -H 'x-nf-request-id: 1234' http://localhost:8000
Hello world

❯ curl -H 'x-deno-functions: up,hello' -H 'x-deno-pass: passthrough' -H 'x-nf-request-id: 1234' http://localhost:8000
HELLO WORLD

❯ curl -H 'x-deno-functions: up,skip,hello' -H 'x-deno-pass: passthrough' -H 'x-nf-request-id: 1234' http://localhost:8000
HELLO WORLD
```

`x-deno-functions` must contain a list of functions to be run in the given order. Function handlers are defined [here](playground/netlify/edge-functions).


Bundle functions like Netlify does before deploying to Deno Deploy:

```console
make bundle
```
