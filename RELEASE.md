# GitHub and release setup

## Initial GitHub setup

1. Create the `kar-mi/spirit-vale-overlay` repository on GitHub without adding starter files.
2. For every required `@kar-mi/spirit-vale-tools-*` package, grant `kar-mi/spirit-vale-overlay` **Read** access under the package's **Manage Actions access** settings. This permits CI to install the packages using its `GITHUB_TOKEN`.
3. Developers create the ignored `.npmrc` shown in the README, authenticate GitHub CLI with `read:packages`, set `NODE_AUTH_TOKEN` from `gh auth token`, and run `bun install`. Commit the generated `bun.lock`; CI intentionally uses `--frozen-lockfile`.
4. From this directory, initialize Git, commit the migrated application and lockfile, add the GitHub remote, and push the `main` branch.
5. Enable GitHub Actions. The CI workflow checks pull requests and `main`; the release workflow supports dry runs and tagged releases.
6. Under the repository's **Settings > General > Releases**, enable **Immutable releases**. This protects releases created after the setting is enabled; it does not change existing releases.

## Windows releases

1. Update the root `package.json` version and merge the change to `main`.
2. Create and push a matching tag. Use `&&` so the push only runs if the tag was created successfully:

   ```powershell
   git tag app-vX.Y.Z && git push origin app-vX.Y.Z
   ```

3. The release workflow validates the tag, type-checks, tests, builds and verifies Neutralino's portable release ZIP, then publishes it in a GitHub Release. No separate `gh release create` command is needed.
4. Confirm that the tagged workflow run and GitHub Release completed successfully. The pushed tag is not immutable by itself; GitHub locks it to its commit when the workflow publishes the release.

After publication, the release tag cannot be moved or deleted while the release exists, and its ZIP asset cannot be replaced or removed. The release title and notes remain editable. If a release must be corrected, publish a new version and tag instead of attempting to replace its artifacts.

Use the workflow's manual-dispatch option to generate a seven-day test artifact without creating a GitHub Release.
