# Updating the changelog and its site copy

The repository-root [CHANGELOG.md](../CHANGELOG.md) is the source of release
notes. The checked-in [site copy](../packages/site/src/data/CHANGELOG.md) is
rendered at `/docs/changelog`. The site `sync-content` script copies the entire
root file over the site copy; `dev`, `start`, and `build` run it automatically.
Review both files before running those commands so a site-only edit is not lost.

From the repository root:

1. Compare the complete files before editing or syncing:

   ```sh
   diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md
   ```

   No output and exit status 0 mean the files are identical. Status 1 means
   differences: lines prefixed `-` are from the root file and `+` from the site
   copy. A status greater than 1 indicates an error, such as a missing file.
   Read each hunk in its release and subsection, including continuation
   paragraphs, examples and links. Investigate site-only changes before copying;
   reconcile intended content in the root file using the implementation or other
   evidence. Matching files do not by themselves establish that claims are true.
2. Make the intended update in the root changelog, normally under `Unreleased`
   in the appropriate subsection. Check its behavior and qualifications against
   the change it describes. Preserve unrelated entries and release history.
3. Copy the root file to the site copy:

   ```sh
   bun run --cwd packages/site sync-content
   ```

   This overwrites the whole site copy, and the script suppresses copy errors.
   Repeat the `diff -u` command above: it must produce no output and exit 0.
   Inspect `git diff -- CHANGELOG.md packages/site/src/data/CHANGELOG.md` to
   ensure both changes are intended and no unrelated notes were lost.
4. Run the existing changelog checks with an isolated home:

   ```sh
   HOME=$(mktemp -d) bun test packages/site/tests/changelog.test.ts
   ```

   These tests check the repository copies and specific historical claims; they
   do not verify a deployed site. For more context see the
   [site sync guide](changelog-site-sync.md).
