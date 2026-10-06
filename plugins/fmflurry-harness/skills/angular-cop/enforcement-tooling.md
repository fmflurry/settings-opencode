# angular-cop / enforcement tooling

> **Paste into your Angular app repo — not active in this config repo.**
>
> These templates make the deterministic subset of BLOCK rules fail the build/CI automatically. Rules that require semantic understanding of the architecture (cross-domain leakage, UseCase-inside-component at a structural level) are covered by `angular-cop` static review after the ESLint gate runs.

---

## 1. ESLint flat config block (`eslint.config.js`)

Install the required plugins first:

```bash
# TypeScript + Angular lint
npm install -D typescript-eslint @typescript-eslint/eslint-plugin @angular-eslint/eslint-plugin

# Immutability
npm install -D eslint-plugin-functional

# RxJS subscription leak detection
# Choose one (rxjs-x is the actively maintained successor to @smarttools/eslint-plugin-rxjs)
npm install -D rxjs-x
# or: npm install -D @smarttools/eslint-plugin-rxjs
```

```js
// eslint.config.js  (ESLint v9+ flat config)
import tsEslint from 'typescript-eslint';
import angularEslint from '@angular-eslint/eslint-plugin';
import functionalPlugin from 'eslint-plugin-functional';
import rxjsPlugin from 'rxjs-x';          // swap for @smarttools/eslint-plugin-rxjs if needed

export default tsEslint.config(
  // ── TypeScript files ──────────────────────────────────────────────────
  {
    files: ['**/*.ts'],
    plugins: {
      '@typescript-eslint': tsEslint.plugin,
      '@angular-eslint': angularEslint,
      functional: functionalPlugin,
      rxjs: rxjsPlugin,
    },
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ── BLOCK: any type ───────────────────────────────────────────────
      '@typescript-eslint/no-explicit-any': 'error',

      // ── BLOCK: non-null assertion abuse ──────────────────────────────
      '@typescript-eslint/no-non-null-assertion': 'error',

      // ── BLOCK: UseCase injected directly in a component ──────────────
      // Matches any identifier ending in "UseCase" inside *.component.ts.
      // The selector targets inject() calls and constructor param types.
      // Note: this is a heuristic; angular-cop's review pass is the
      // authoritative check for indirect/aliased injection.
      'no-restricted-syntax': [
        'error',
        {
          // inject(FooUseCase) call expression
          selector:
            "CallExpression[callee.name='inject'] > Identifier[name=/UseCase$/]",
          message:
            'Components must not inject UseCases directly. Inject the Facade instead.',
        },
        {
          // constructor(private foo: FooUseCase) parameter
          selector:
            "TSParameterProperty > TSTypeAnnotation > TSTypeReference > Identifier[name=/UseCase$/]",
          message:
            'Components must not inject UseCases via constructor. Inject the Facade instead.',
        },
      ],

      // ── BLOCK: RxJS subscription leaks ───────────────────────────────
      // rxjs-x plugin (https://github.com/JasonWeinzierl/eslint-plugin-rxjs-x)
      'rxjs/no-ignored-subscription': 'error',       // subscribe() result discarded
      'rxjs/prefer-takeuntil-destroy': 'error',       // subscribe without takeUntilDestroyed

      // ── BLOCK (partial): immutability ────────────────────────────────
      // functional/no-let catches mutable local bindings. Combine with
      // @typescript-eslint/prefer-readonly for class properties.
      // Note: these rules flag mutations; they do NOT catch all in-place
      // mutations (e.g. array.push on a param). angular-cop review catches
      // the remainder (see enforcement.md — state mutation row).
      'functional/no-let': 'error',
      '@typescript-eslint/prefer-readonly': 'error',

      // ── WARN: advisory style rules ────────────────────────────────────
      '@typescript-eslint/explicit-function-return-type': [
        'warn',
        { allowExpressions: true, allowHigherOrderFunctions: true },
      ],
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@angular-eslint/component-class-suffix': 'warn',
      '@angular-eslint/prefer-on-push-component-change-detection': 'warn',
      'no-console': 'warn',
    },
  },

  // ── Component files: restrict UseCase imports ─────────────────────────
  // Redundant with no-restricted-syntax above but adds an import-level gate.
  {
    files: ['**/*.component.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/use-cases/**', '**/*.usecase', '**/*.use-case'],
              message:
                'Component files must not import UseCases. Import the Facade instead.',
            },
          ],
        },
      ],
    },
  },

  // ── HTML templates ────────────────────────────────────────────────────
  {
    files: ['**/*.html'],
    plugins: { '@angular-eslint': angularEslint },
    rules: {
      // Warn on method calls in templates (method-call-in-template)
      // Angular ESLint does not ship a dedicated rule for this; the check
      // is performed by angular-cop's static review pass. Track the
      // upstream issue: https://github.com/angular-eslint/angular-eslint
    },
  },
);
```

### `no-restricted-syntax` selector notes

The selector `CallExpression[callee.name='inject'] > Identifier[name=/UseCase$/]` is an ESTree AST selector. It is deterministic for the common pattern `inject(FooUseCase)`. It does **not** catch:

- Re-exported or aliased UseCase tokens (`const TOKEN = FooUseCase`)
- `InjectionToken` wrapping a UseCase

These cases are caught by `angular-cop`'s review-only pass.

---

## 2. Architecture boundary enforcement

ESLint rules alone cannot verify layer isolation (e.g., `presentation/` importing `infrastructure/`). Use one of these tools in addition to ESLint:

### Option A — `eslint-plugin-boundaries` (standalone Angular projects)

```bash
npm install -D eslint-plugin-boundaries
```

```js
// In eslint.config.js, add:
import boundariesPlugin from 'eslint-plugin-boundaries';

// Example tags config — adjust paths to match your project layout
{
  settings: {
    'boundaries/elements': [
      { type: 'domain',         pattern: 'src/app/*/*/domain/**' },
      { type: 'application',    pattern: 'src/app/*/*/application/**' },
      { type: 'infrastructure', pattern: 'src/app/*/*/infrastructure/**' },
      { type: 'presentation',   pattern: 'src/app/*/*/presentation/**' },
    ],
  },
  plugins: { boundaries: boundariesPlugin },
  rules: {
    'boundaries/element-types': [
      'error',
      {
        default: 'disallow',
        rules: [
          // presentation → application (facade only — enforced by angular-cop review)
          { from: 'presentation', allow: ['application'] },
          // application → domain
          { from: 'application',  allow: ['domain'] },
          // infrastructure → domain
          { from: 'infrastructure', allow: ['domain'] },
          // domain: no outgoing deps
          { from: 'domain',        allow: [] },
        ],
      },
    ],
  },
}
```

### Option B — Nx `@nx/enforce-module-boundaries` (Nx workspaces)

```json
// .eslintrc.json or eslint.config.js Nx rule block
{
  "@nx/enforce-module-boundaries": [
    "error",
    {
      "allow": [],
      "depConstraints": [
        {
          "sourceTag": "layer:presentation",
          "onlyDependOnLibsWithTags": ["layer:application", "layer:domain", "scope:shared"]
        },
        {
          "sourceTag": "layer:application",
          "onlyDependOnLibsWithTags": ["layer:domain", "scope:shared"]
        },
        {
          "sourceTag": "layer:infrastructure",
          "onlyDependOnLibsWithTags": ["layer:domain", "scope:shared"]
        },
        {
          "sourceTag": "layer:domain",
          "onlyDependOnLibsWithTags": ["scope:shared"]
        }
      ]
    }
  ]
}
```

### Option C — `dependency-cruiser` (CI graph validation)

```bash
npm install -D dependency-cruiser
npx depcruise --init
```

Add a rule to `.dependency-cruiser.cjs`:

```js
{
  name: 'no-presentation-to-infrastructure',
  severity: 'error',
  from: { path: '^src/app/.*/presentation/' },
  to:   { path: '^src/app/.*/infrastructure/' },
}
```

---

## 3. BLOCK rule → enforcement mechanism map

| BLOCK rule | Deterministic lint rule | Architecture plugin | angular-cop review-only |
|---|---|---|---|
| `any` type | `@typescript-eslint/no-explicit-any: error` | — | — |
| Non-null assertion `!` | `@typescript-eslint/no-non-null-assertion: error` | — | — |
| UseCase in component (direct `inject()`) | `no-restricted-syntax` selector + `no-restricted-imports` pattern | — | Indirect / token / aliased patterns |
| RxJS subscription leak | `rxjs/no-ignored-subscription: error` + `rxjs/prefer-takeuntil-destroy: error` | — | `fromEvent` / `interval` leak patterns; async-pipe preference |
| State mutation (local `let` + class properties) | `functional/no-let: error` + `@typescript-eslint/prefer-readonly: error` | — | `array.push` / param mutation / spread omissions |
| Presentation → infrastructure boundary | — | `eslint-plugin-boundaries` / `@nx/enforce-module-boundaries` | All violations when plugin absent |
| Domain → framework/infrastructure | — | same plugin | When plugin absent |
| Unjustified `as` cast | `@typescript-eslint/consistent-type-assertions: warn` | — | All unsafe casts |
| Missing `OnPush` | `@angular-eslint/prefer-on-push-component-change-detection: warn` | — | Promoted to BLOCK by angular-cop when component reads signals |

> **Key insight:** lint makes the deterministic subset fail the build automatically. angular-cop review catches what lint cannot express (structural patterns, cross-domain via public-api.ts, context registry misuse, flurryx API correctness).
