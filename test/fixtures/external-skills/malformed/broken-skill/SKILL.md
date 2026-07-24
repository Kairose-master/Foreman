---
name: Missing Id And Description
---

This package's frontmatter is missing required fields (`id`, `description`),
so discovery must exclude it rather than return a partial descriptor. Same
convention as the existing bundled malformed fixture
(test/fixtures/skills/malformed/SKILL.md) — this fixture proves the SAME
exclusion rule holds for an EXTERNAL provider, not just the bundled one.
