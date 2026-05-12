---
name: release
description: |
  Create a new release for the yames Tauri app. Handles version bumping, commit formatting,
  and push to trigger CI. Use when the user asks to "make a release", "publish a new version",
  "bump the version", or "ship it".
metadata:
  author: a0d0oe0
sample-prompts:
  - "release 0.5.2"
  - "make a new release with these changes"
  - "ship it as a patch release"
  - "bump version and release"
arguments:
  - [version] - optional, semver version (e.g. 0.5.2). If omitted, ask the user.
---

# Release Process

## Steps

1. Run `git status` and `git diff` to see what will be included.

2. If there are uncommitted changes, commit them first with a descriptive message (NOT starting with "release"). Then proceed.

3. Determine the version. If not provided, suggest based on changes:
   - Bug fixes / polish → patch (0.x.Y)
   - New features → minor (0.X.0)

4. Bump version in all 3 files:
   - `package.json` → `"version": "{VERSION}"`
   - `src-tauri/tauri.conf.json` → `"version": "{VERSION}"`
   - `src-tauri/Cargo.toml` → `version = "{VERSION}"`

5. Commit with exact format:
   ```
   release v{VERSION} — {summary}
   ```
   The message MUST start with `release` — this triggers CI.
   Include a short bullet list of changes in the commit body.

6. Push: `git push origin main`

7. After CI creates the GitHub release, update its notes with a proper changelog.
   Wait ~30 seconds after push for CI to create the release before editing.

   **Format rules:**
   - Order items biggest → smallest impact. Bug fixes and polish go last.
   - Use `**New**`, `**Improved**`, `**Fixed**` as section labels (plain text, bold via `**`).
   - Only include sections that apply. A pure bug-fix release just has `**Fixed**`.
   - No `##` headings — they are stripped by the changelog renderer.

   ```
   gh release edit v{VERSION} --repo turutupa/yames --notes "$(cat <<'EOF'
   **New**

   - {biggest new feature}
   - {next feature}

   **Improved**

   - {improvement}

   **Fixed**

   - {bug fix}
   EOF
   )"
   ```

   Derive notes from the commit body (step 5) — they should match.

## What CI does automatically

No manual intervention needed after push:
- Builds macOS (ARM + Intel .dmg + .pkg), Windows (.exe + .msi), Linux (.AppImage + .deb)
- Creates GitHub release with all artifacts
- Updates Homebrew cask in `turutupa/homebrew-tap` (version + SHA)
- Submits winget-pkgs PR via wingetcreate

## Rules

- Version in commit message must match version in files
- Never include unrelated/uncommitted changes in a release commit
- `Casks/yames.rb` version/SHA is updated by CI — do not edit manually for releases
- Do not amend or squash — always create a new commit
