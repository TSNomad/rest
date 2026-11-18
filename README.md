# @tsnomad/rest

The REST contracts: `Controller`, `Middleware`, `Interceptor`,
`Validation`, `ValidationSet`, `RestStrategy`, `RestException` and
`ValidationException`, and `RestLifecycle`, which runs one request
through a controller's stages for any `RestStrategy`.

This is the TypeScript counterpart to PHPNomad's
[rest](https://github.com/phpnomad/rest) package.

## Install

```bash
npm install @tsnomad/rest
```

The package ships compiled JavaScript with its type declarations, so
it needs no build step of its own. It needs Node 20.19 or later.
npm installs the TS Nomad packages it depends on with it.

`scripts/consumer-check.sh [<commit>]` installs the package from git at
one commit into a scratch project and imports every export, from Node
and from TypeScript.

## Where it fits

The REST contracts build on `@tsnomad/http` and `@tsnomad/logger`. The
loader registers controllers through `RestStrategy`, and a platform
integration implements it, as `@tsnomad/medusa-integration` does for
Medusa's API routes.

## Use

```ts
import { Method, type Request } from '@tsnomad/http';
import { RestLifecycle, ValidationMiddleware, ValidationSet, type Controller, type HasMiddleware, type HasValidations } from '@tsnomad/rest';

class GetOrder implements Controller, HasMiddleware, HasValidations {
  getEndpoint() { return '/orders/{id}'; }
  getMethod() { return Method.Get; }
  getMiddleware() { return [new ValidationMiddleware(this)]; }
  getValidations() { return { id: new ValidationSet().setRequired().addValidation(() => new IsWholeNumber()) }; }
  async getResponse(request: Request) { /* ... */ }
}

const lifecycle = await container.get(RestLifecycle);
const response = await lifecycle.handle(await container.get(GetOrder), request);
```

`RestLifecycle.handle(controller, request)`:

1. Runs the middleware in order, awaiting each.
2. Runs the controller.
3. Runs the interceptors in order, awaiting each, and answers the
   controller's response.

A controller validates by placing `ValidationMiddleware` in its
middleware. A controller with `getValidations` and no
`ValidationMiddleware` runs no checks, as in PHPNomad. Place it after
any middleware that checks who is calling. It runs every validation
set and collects every failure. Any failure answers 400 with
`{ error: { message, context } }`, the context
`{ type: 'VALIDATION_FAILED', failedValidations }`, and nothing after it
runs.

A `RestException` from any stage answers its code with
`{ error: { message, context } }`. One with a 4xx code is not logged,
and one with a 5xx code is logged once. Any other error is
logged once through `LoggerStrategy.logException` and answered 500 with
`An unexpected error occurred. Sorry, that is all I know.`, never the
error's own message.

The `RestStrategy` token carries the name the loader resolves for
controllers, so `HasControllers` initializers load through
`@tsnomad/loader`.

## Where this differs from PHPNomad

- `getResponse`, middleware, interceptors and validations may return
  promises, and the lifecycle awaits each.
- `RestLifecycle` is new. PHPNomad's WordPress strategy runs the same
  stages inline and marks them for extraction. It logs an unexpected
  error with a message and the endpoint, where PHP logs the bare
  exception, and it logs a `RestException` with a 5xx code, which PHP
  does not. When the logger throws, it writes both errors to
  `console.error` and still answers 500. PHP checks a controller for
  middleware and interceptors with `instanceof`, which JavaScript cannot
  do for an interface, so the lifecycle reads the methods by name, and a
  controller that has something under one of those names that is not a
  function is answered as an unexpected error before any stage runs. A
  method that returns anything but an array, such as `undefined` from a
  forgotten return, is answered the same way when its stage comes.
- Related interfaces share a file, such as `Middleware` and `Interceptor`
  in `Middleware.ts`, where PHPNomad has one file per interface. The
  package's exports are the same either way.
- `RestException` refuses a code that is not a whole number from 400 to
  599.
- Not ported yet: the stock middleware, interceptors and validations
  (`IsEmail`, `IsNumeric` and the rest) other than `ValidationMiddleware`,
  the endpoint traits, the `WithProvidedErrorMessage` trait, the
  `BasicTypes` enum, `Handler`, `WebController`, `HasRestNamespace`,
  `CanConvertToRequest`, `RestActionEvent`, and
  `AuthenticationException` and `AuthorizationException`. The last two
  wait for an auth package.

## Extracted 2026-11-17

This package moved into its own repository on 2026-11-17, at version
0.1.0, with its tests.

## License

Copyright (C) 2026 TSNomad.

This package is free software, released under the GNU General Public
License, version 3 or any later version (GPL-3.0-or-later). It comes
with no warranty. The full text is in [LICENSE](LICENSE).
