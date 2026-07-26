# Source repository removal runbook

Do not perform these steps until this repository's CI, portable-package verification, and smoke test have passed.

In `spirit-vale-tools`, make one coordinated cutover change:

1. Remove the `ui`, `ui-core`, `overlay`, `combat-ui`, `market-ui`, and `rewards-ui` workspaces.
2. Remove the UI-owned static assets and portable-packaging/icon scripts and tests.
3. Remove UI build, development, portable-package, and portable-verification scripts plus the UI-only `resedit` dependency from the root manifest.
4. Remove the desktop CI/release workflows and revise the README and release documentation so the source repository describes only the reusable tools packages.
5. Regenerate its lockfile and validate its remaining package build, typecheck, test, and publish workflow.

Do not remove reusable `@kar-mi/spirit-vale-tools-*` packages or revoke the overlay repository's package read access as part of the cutover.
