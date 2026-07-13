# Installation and Sharing

The skill is a standalone folder. Installation does not authorize Google, create resources, copy credentials, or edit a website.

## Requirements

- Node.js 20 or newer
- A writable Codex skills directory
- The validated `provision-google-tracking` folder or release archive
- A POSIX-like shell for the bundled wrapper (`sh`); the examples use macOS/Linux commands such as `chmod`, `pbpaste`, and `~/.config`

On another platform, invoke `node scripts/site-provisioner/cli.js` directly and store credentials in an owner-only directory appropriate for that operating system.

## Install by copying

Set the destination:

```bash
SKILLS_DIR="${CODEX_HOME:-$HOME/.codex}/skills"
```

Copy the complete folder so the final path is:

```text
${SKILLS_DIR}/provision-google-tracking/SKILL.md
```

Preserve the executable bit on `scripts/provision-site`. Do not copy any site config, state, OAuth client, OAuth token, or Cloudflare token into the skill folder.

## Install by symlink

For local development, link the validated folder into the skills directory. A symlink makes edits immediately visible on disk, but a new Codex task may be required to reload skill metadata.

Use a copy for a stable operator install. Use a symlink only when the owner expects the source folder to move or change.

## Install from the archive

1. Compare the archive SHA-256 with the checksum in the package handoff.
2. Inspect the archive file list before extraction.
3. Extract into a temporary directory.
4. Confirm the top-level folder is `provision-google-tracking`.
5. Run the included tests and skill validator from the extracted folder.
6. Copy the validated folder into the Codex skills directory.

The archive must not contain `.state`, credential files, token files, local configs, source maps, user home paths, or project-specific identifiers.

## Validate an install

From the installed folder:

```bash
sh -n scripts/provision-site
scripts/provision-site help
node --test scripts/site-provisioner/test/*.test.js
```

Run the Codex skill validator from the installed `skill-creator` package:

```bash
python3 /path/to/skill-creator/scripts/quick_validate.py \
  "${CODEX_HOME:-$HOME/.codex}/skills/provision-google-tracking"
```

Start a new Codex task and invoke `$provision-google-tracking` with a read-only request before any live use.

## Update safely

1. Keep the current installed folder until the replacement passes tests.
2. Validate the new folder and archive separately.
3. Compare the file manifest and operator-facing changes.
4. Back up only the old skill code, not tokens or state.
5. Replace the installed folder after explicit approval.
6. Start a new Codex task to load the updated skill.

Do not overwrite an installed skill during a live provisioning run. The state file lives outside the skill, but changing runtime behavior mid-run makes recovery harder to audit.
