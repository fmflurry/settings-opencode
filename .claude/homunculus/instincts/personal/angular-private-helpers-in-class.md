---
id: angular-private-helpers-in-class
trigger: "when creating helper/utility functions used by computed signals in Angular components"
confidence: 0.9
domain: "angular"
source: "session-observation"
created: "2026-02-23"
---

# Keep Helper Methods as Private Methods Inside the Component Class

## Action
When a component needs a pure helper function (used by computed signals), keep it as a private method on the class. Do not extract it as a standalone function outside the class. Use it in a functional programming style (pure, no side effects), but scoped to the component.

## Evidence
- User explicitly corrected this on 2026-02-23: "format address method should be a private method, used like a FP. Do not extract it from the component's class"

## Correct Pattern
```typescript
export class OrderDetailsComponent {
  readonly formattedAddress = computed(() =>
    this.formatAddress(this.purchaseOrder()?.address)
  );

  private formatAddress(address: Address | undefined): FormattedAddress | null {
    // Pure function logic here
  }
}
```

## Anti-Pattern
```typescript
// WRONG: Do not extract as standalone function outside the class
function formatAddress(address: Address | undefined): FormattedAddress | null { ... }

export class OrderDetailsComponent {
  readonly formattedAddress = computed(() =>
    formatAddress(this.purchaseOrder()?.address)
  );
}
```
