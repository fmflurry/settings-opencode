# Cross-Module Communication

**Hard rule — modules never import modules.** A file under `src/app/modules/<A>/**` must NEVER import from `src/app/modules/<B>/**` — not even B's `public-api.ts` or `integration-api.ts`. Zero exceptions. Only the composition root (`src/app/core/**`, `app.config.ts`, `app.routes.ts`, layout shell) may import module contracts.

| Module A needs… | Mechanism |
|-----------------|-----------|
| Something module B **does** (capability) | Port contract in a neutral location, B's adapter implements it, registry binds — see §1 |
| Module B's **types or computations** | FORBIDDEN — A owns local ACL copies in its own `core/models/` + `core/rules/` — see §2 |

## 1. Capability — Port + Adapter + Registry Binding

The contract (port) lives in a neutral app-level location — `src/app/core/context/contracts/` — or consumer-side in A's `core/ports/`. The PROVIDER module's adapter implements it. The binding (`{ provide: <Port>, useExisting: <Adapter> }`) is declared at the composition root via the context registry (`core/context/`, `contextProvidersFor([...])`). The consumer module imports only from `core/` (allowed direction); the provider module imports only from `core/`; consumer and provider never see each other.

### Worked example: chat needs auth's access token

**1. Contract — neutral location** (both modules may import from `core/`):

```typescript
// src/app/core/context/contracts/get-access-token.port.ts

export abstract class GetAccessTokenPort {
  abstract getAccessToken(): string | null;
}
```

**2. Provider adapter implements the contract** (auth imports from `core/`, never from chat):

```typescript
// src/app/modules/auth/infrastructure/adapters/get-access-token.adapter.ts
import { GetAccessTokenPort } from '@/core/context/contracts/get-access-token.port';

@Injectable()
export class GetAccessTokenAdapter implements GetAccessTokenPort {
  getAccessToken(): string | null { /* read the persisted token */ }
}
```

**3. Binding — composition root** (app-level may import module contracts):

```typescript
// src/app/core/context/auth-context.providers.ts
import { Provider } from '@angular/core';
import { GetAccessTokenAdapter } from '@/modules/auth/public-api';
import { GetAccessTokenPort } from './contracts/get-access-token.port';

export const AUTH_CONTEXT_PROVIDERS: Provider[] = [
  GetAccessTokenAdapter,
  // useExisting aliases the port to the single adapter instance — never instantiated twice
  { provide: GetAccessTokenPort, useExisting: GetAccessTokenAdapter },
];
```

```typescript
// src/app/core/context/context.registry.ts

export enum AppContext {
  AUTH = 'auth',
}

export const CONTEXT_REGISTRY: Record<AppContext, Provider[]> = {
  auth: AUTH_CONTEXT_PROVIDERS,
};

export function contextProvidersFor(contexts: AppContext[]): Provider[] {
  return contexts.flatMap((ctx) => CONTEXT_REGISTRY[ctx] ?? []);
}
```

**4. Consumer injects the port** (chat imports from `core/`, never from auth):

```typescript
// src/app/modules/chat/infrastructure/adapters/signalr-chat-stream.adapter.ts
import { GetAccessTokenPort } from '@/core/context/contracts/get-access-token.port';

private readonly accessTokenPort = inject(GetAccessTokenPort);
```

```typescript
// src/app/modules/chat/chat-service.providers.ts — pull the binding:
import { AppContext, contextProvidersFor } from '@/core/context/context.registry';

...contextProvidersFor([AppContext.AUTH]),
```

### Adding Cross-Module Capability for a New Feature

1. Create the port in `src/app/core/context/contracts/<verb-noun>.port.ts` (or consumer-side in A's `core/ports/`)
2. Provider module implements it with an adapter; export the adapter from the provider's `public-api.ts`
3. Declare the binding (`provide: <Port>, useExisting: <Adapter>`) in `src/app/core/context/<module>-context.providers.ts`
4. Add the entry to `AppContext` enum + `CONTEXT_REGISTRY`
5. Consumer modules pull via `contextProvidersFor([AppContext.<MODULE>])`

## 2. Types & Computations — Local ACL Copies (Never Shared)

Cross-module type sharing is FORBIDDEN — even via `public-api.ts`. Each bounded context owns local ACL (anti-corruption-layer) read models in its own `core/models/` and local pure computations in `core/rules/`, even if that duplicates another module's types/logic. Duplication across contexts is preferred over sharing (established convention: invoices already owns local customer/catalog-item copies rather than importing them).

```typescript
// src/app/modules/payments/core/models/receivable.model.ts

// WRONG — module importing another module's types
import { Invoice } from '@/modules/invoices/public-api';

// RIGHT — payments owns a local ACL read model shaped to its own needs
export type ReceivableInvoice = {
  id: string;
  number: string;
  dueDate: string;
  amountDue: number;
};
```

Same for computations: never import another module's rule functions (e.g. `computeInvoiceTotals` from invoices) — re-implement the pure function locally in `payments/core/rules/`. The consumer's adapter maps the provider's payload into the local read model; that mapping IS the anti-corruption layer.

## Rules

- **Zero module→module imports** — not even `public-api.ts`/`integration-api.ts`. Only the composition root imports module contracts.
- **Capabilities**: always via port + context-registry binding. Never inject a concrete adapter cross-module.
- **Types/computations**: always local ACL copies. Never import another module's models or rules.
- **Reactive needs are capabilities too**: expose a port returning `Observable<T>` and bind it via the registry. Never import another module's store or mirror it cross-module.
- **No god-stores**: each module owns its own store.
- **Caching is transparent**: `@SkipIfCached` in the provider module's adapter/facade handles dedup. Consumers just call the port.
- **Enforcement**: isolation audit — resolve every import specifier in `modules/**`; any resolution landing in another module's directory is a violation.
