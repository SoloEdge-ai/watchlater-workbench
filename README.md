# Watchboard

Watchboard is a Chrome Manifest V3 extension that turns the new tab page into a local workspace for Bilibili Watch Later, YouTube Watch Later, and X Bookmarks.

![Watchboard overview](docs/assets/watchboard-overview.png)

The screenshot is generated from synthetic library data and contains no account identifiers, credentials, browser history, or local filesystem paths.

## Features

- Search, filter, sort, and review content from all supported platforms.
- Run safe full syncs from already signed-in platform pages.
- Keep one primary category, multiple tags, ratings, and a transparent priority score.
- Use optional OpenAI-compatible classification only when manually requested.
- Store the library in IndexedDB and export it as JSON or CSV.
- Remove or restore one source item only after exact account and item verification.
- Filter content independently by platform and by content type: video or post.

## Project Structure

```text
watchlater-workbench/
├── src/
│   ├── background/  # Service worker, persistence, and message orchestration
│   ├── content/     # Platform collectors and source-action runtimes
│   ├── shared/      # Domain logic shared across extension contexts
│   └── ui/          # New-tab dashboard, popup, settings, and styles
├── docs/assets/     # Documentation images
├── scripts/         # Development, validation, and extension-ID tools
├── tests/           # Node test suite and DOM fixtures
├── manifest.json    # Chrome extension entry point
├── package.json
└── README.md
```

The repository root remains the directory selected by **Load unpacked**. Chrome follows the paths declared in `manifest.json` into `src/`.

## Installation and Upgrades

1. Open `chrome://extensions/` and enable Developer mode.
2. Select **Load unpacked** and choose the repository root.
3. Open a new tab to launch Watchboard.

For upgrades, run `git pull`, reload the extension on `chrome://extensions/`, and refresh any open Watchboard or platform pages.

The committed Manifest public key keeps the unpacked extension ID stable across clones and directories. Browser data is local and should be exported before moving, reinstalling, or removing the extension.

## Sync Sources

Select **Sync** on the Bilibili, YouTube, or X source card. Watchboard opens or reuses the signed-in source page, collects the full list, and commits a snapshot only after reaching a confirmed end state.

Incomplete syncs never archive missing records. Normal visits may add or refresh visible items, but incremental collection cannot archive older records.

### Bilibili

Bilibili Watch Later items are collected from the signed-in watch-later page. Public video metadata may be refreshed through Bilibili's web endpoints.

### YouTube

YouTube does not expose the real Watch Later list through the Data API. Watchboard collects it from the signed-in playlist page without OAuth.

### X

X Bookmarks are collected from the selected Bookmarks view on `/i/history`. Watchboard does not read cookies and does not use the X API, OAuth, `identity`, or `webRequest` permissions.

Likes, signed-out pages, timeouts, account changes, load failures, and unknown page structures fail closed without archiving existing records.

## Account Binding and Source Actions

The first complete sync asks the user to confirm the current source account. Identity uses stable platform identifiers rather than display names.

- Bilibili uses the account `mid`.
- YouTube prefers the channel ID and falls back to a unique handle.
- X uses a normalized lowercase `handle:@name` identity.

Later syncs and source actions must match the binding exactly. Each write batch rechecks the current account.

Removing an item offers two choices: archive it only in Watchboard, or remove it from the source too. Source removal uses the visible page controls and archives locally only after the exact item disappears.

Archived X items can be restored only to Watchboard or restored and bookmarked again on X. Platform success followed by a local write failure retries only the local finalization step.

To change accounts, export and clear the source binding in Settings. The operation exports that platform first, requires confirmation, and leaves other platforms unchanged.

## AI Classification

Settings accepts an OpenAI-compatible base URL, model, and API key. Classification is disabled by default and runs only after manual confirmation.

The API key is stored in `chrome.storage.local` and excluded from exports. Only the metadata required for classification is sent to the configured endpoint.

## Development and Testing

```bash
npm test
npm run check
npm run extension:id
npm run dev
```

No build step is required. Enable Developer mode in Watchboard settings to expose the development reload action.

Page-only changes usually need a refresh. Changes to the service worker, Manifest, or content scripts require an extension reload followed by a page refresh.

When Chrome loads this repository directly, `npm run dev` watches the source in place. For a separate unpacked-extension directory, create an untracked `.watchboard-dev.json` with a `targetDir` value.

### How Chrome Loads the Extension

**Load unpacked** does not copy source files. Chrome remembers the selected directory and reads files from it when the extension or page reloads.

Loading the repository root directly keeps the Git working tree and the Chrome runtime source in one place.

### Extension Identity

The Manifest `key` is a public key used only to produce a stable development extension ID. It is not a secret.

The private key must stay outside the repository, logs, exports, and extension package. Unpacked development does not read it.

The following PowerShell example uses a user-relative key directory and does not print private key contents:

```powershell
$OpenSsl = (Get-Command openssl).Source
$KeyDir = Join-Path $env:USERPROFILE '.watchboard\keys'
$PrivateKey = Join-Path $KeyDir 'watchlater-workbench.pem'
$PublicDer = Join-Path $KeyDir 'watchlater-workbench-public.der'

New-Item -ItemType Directory -Force -Path $KeyDir | Out-Null
& $OpenSsl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out $PrivateKey
& $OpenSsl pkey -in $PrivateKey -pubout -outform DER -out $PublicDer

$CurrentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$Identity = New-Object Security.Principal.NTAccount($CurrentUser)
$Acl = New-Object Security.AccessControl.FileSecurity
$Acl.SetOwner($Identity)
$Acl.SetAccessRuleProtection($true, $false)
$Rule = New-Object Security.AccessControl.FileSystemAccessRule($CurrentUser, 'FullControl', 'Allow')
$Acl.AddAccessRule($Rule)
Set-Acl -LiteralPath $PrivateKey -AclObject $Acl

$ManifestPath = Join-Path (Get-Location) 'manifest.json'
$Manifest = Get-Content -Raw -Encoding utf8 $ManifestPath | ConvertFrom-Json
$Manifest.key = [Convert]::ToBase64String([IO.File]::ReadAllBytes($PublicDer))
$Manifest | ConvertTo-Json -Depth 20 | Set-Content -Encoding utf8 $ManifestPath
```

`npm run extension:id` should print `icnojlhjlobbpfngohnkfiofephlofid`. Never commit `.pem`, `.key`, `.p12`, `.pfx`, or `.der` files.

## Permissions

- `storage` stores settings, sync state, bindings, and local metadata.
- `tabs` opens, reuses, and focuses visible source pages after explicit user actions.
- Bilibili, YouTube, and X host access collects supported lists and operates on one exact source item.
- Optional host access is requested only for a user-configured AI endpoint.

Watchboard does not run automatic or bulk source removals. Source changes happen only after an explicit single-item choice.

## Privacy and Data

The library, ratings, categories, tags, snapshots, and source bindings remain in the local browser. They are not stored in this Git repository.

Repository documentation and tests must not contain personal home-directory paths, private key material, or tracked key files.

## Contributing

Use English for commit messages and repository documentation. Do not commit personal paths, credentials, browser data, generated keys, or local development configuration.

Configure Git to use a GitHub noreply email before creating commits.

Before committing, run `npm test`, `npm run check`, `npm run extension:id`, and `git diff --check`.
