# angular-cop / TypeScript strictness

Project runs TS strict. New code in the diff must obey.

## 🔴 Blockers

### `any` introduced in the diff
```ts
// BAD
function parse(input: any) { ... }
const data: any = JSON.parse(s);
```
Exceptions (still flag, but at risk level): types coming from untyped 3rd-party. Use `unknown` + a type guard instead.

### Non-null assertion `!` on uncertain values
```ts
// BAD
const user = users.find(u => u.id === id)!;

// GOOD
const user = users.find(u => u.id === id);
if (!user) throw new Error(`User ${id} not found`);
```

### `as` cast bypassing narrowing
```ts
// BAD
const cfg = raw as Config;

// GOOD - validate then cast
if (!isConfig(raw)) throw new Error('invalid config');
const cfg: Config = raw;
```

### Mutating function parameters
```ts
// BAD
function normalize(user: User) {
  user.email = user.email.toLowerCase();
  return user;
}

// GOOD
function normalize(user: User): User {
  return { ...user, email: user.email.toLowerCase() };
}
```

## 🟡 Risks

### Missing `readonly` on public data
DTOs, value objects, signal payloads should be `readonly`:
```ts
// PREFER
interface Customer {
  readonly id: string;
  readonly orders: ReadonlyArray<Order>;
}
```

### Function return type omitted on public API
Inferred return types are fine for locals. Exported / public class methods should have explicit return types.

### `Object.keys(x)` typed as `string[]` consumed as `keyof X`
```ts
// BAD
(Object.keys(map) as Array<keyof typeof map>).forEach(k => ...);

// GOOD - if you control the map, type it tighter; otherwise validate
```

### Discriminated union not exhausted in `switch`
Missing `default: const _: never = x;` -> future variants compile silently.

## 🔵 Nits

- Prefer `type` over `interface` when the shape is closed and may be unioned.
- `const` assertions on literal arrays / records: `as const`.
- No `Function` / `Object` / `{}` types — use specific signatures.
- `unknown` > `any` for boundary inputs.
- Import sorting / dedupe: respect TS S3863 (merge duplicate imports).

## Tooling cross-check

After static review, run:
```bash
npx tsc --noEmit --pretty false
```
Map each error code to severity:
- `TS2322`, `TS2345`, `TS2532`, `TS2531`, `TS2540` -> 🔴 bug
- `TS6133` (unused), `TS6196` -> 🔵 nit
- Others -> 🟡 risk by default

Then:
```bash
npm run lint -- --quiet || npx eslint --quiet <changed files>
```
Report counts + first 20 offenders. Do not auto-fix.

## Reporting

Always cite the symbol with backticks: `` `userId` is `any` ``. Include the offending TS error code in parens when it comes from tsc.
