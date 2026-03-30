---
id: angular-no-methods-in-template
trigger: "when rendering derived data in Angular templates"
confidence: 0.9
domain: "angular"
source: "session-observation"
created: "2026-02-23"
---

# Never Call Methods in Angular Templates

## Action
Never call component methods directly in Angular templates. Angular's change detection cycle will re-execute the method on every cycle, wasting resources. Instead, use computed signals to derive values reactively.

## Evidence
- User explicitly corrected this on 2026-02-23: "You can't call a method inside the html template. Because of how angular change detection cycle work, it will trigger the method endlessly. Wasting resources."

## Correct Pattern
```typescript
// Private method as pure helper
private formatAddress(address: Address | undefined): FormattedAddress | null { ... }

// Computed signals call the private method
readonly formattedBillingAddress = computed(() =>
  this.formatAddress(this.purchaseOrder()?.billingAddress)
);
```

```html
<!-- Template reads the signal, NOT the method -->
@if (formattedBillingAddress(); as addr) {
  <span>{{ addr.streetLine }}</span>
}
```

## Anti-Pattern
```html
<!-- WRONG: calls method on every change detection cycle -->
@if (formatAddress(purchaseOrder()!.billingAddress); as addr) { ... }
```
