## Summary

What changed, and why.

## Risk

What can go wrong, who it affects, and how you would notice.

## How to revert

The revert commit, the flag, or the deploy step that undoes this change.

## Tier

T1 (low), T2, or T3 (sensitive). Tier comes from blast radius, protected paths, and diff size. It is not a finding tag. T3 needs a cross-check and a human review.

## Visual report

- [ ] Report: HTML and PNG are committed under `docs/pr-reports/<branch-slug>.html` and `.png`, the PNG is embedded, and the HTML is linked.
- [ ] Skip — trivial PR (docs typo or version bump only). Reason:
