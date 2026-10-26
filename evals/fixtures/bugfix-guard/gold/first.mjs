export function first(xs) {
  if (!xs || xs.length === 0) return undefined;
  return String(xs[0]).trim();
}
