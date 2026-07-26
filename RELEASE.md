# GitHub and release setup

## Initial GitHub setup

1. Create the `kar-mi/spirit-vale-overlay` repository on GitHub without adding starter files.
2. For every required `@kar-mi/spirit-vale-tools-*` package, grant `kar-mi/spirit-vale-overlay` **Read** access under the package's **Manage Actions access** settings. This permits CI to install the packages using its `GITHUB_TOKEN`.
3. Developers create the ignored `.npmrc` shown in the README, authenticate GitHub CLI with `read:packages`, set `NODE_AUTH_TOKEN` from `gh auth token`, and run `bun install`. Commit the generated `bun.lock`; CI intentionally uses `--frozen-lockfile`.
4. From this directory, initialize Git, commit the migrated application and lockfile, add the GitHub remote, and push the `main` branch.
5. Enable GitHub Actions. The CI workflow checks pull requests and `main`; the release workflow supports dry runs and tagged releases.

## Windows releases

1. Update the root `package.json` version and merge the change to `main`.
2. Push a matching tag:

   ```powershell
   git tag app-vX.Y.Z
   git push origin app-vX.Y.Z
   ```

3. The release workflow validates the tag, type-checks, tests, builds and verifies the portable ZIP, then creates a GitHub Release with the ZIP and SHA-256 file.

Use the workflow's manual-dispatch option to generate a seven-day test artifact without creating a GitHub Release.
