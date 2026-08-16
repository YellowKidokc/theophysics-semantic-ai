# Claude Code Build Instructions

## Plugin Location
```
O:\Theophysics_Backend\In_House_Programs\Plugins\AI-Semantic-Map-main
```

## Build Commands (run in order)
```powershell
cd "O:\Theophysics_Backend\In_House_Programs\Plugins\AI-Semantic-Map-main"
npm install
```

## Apply the Fix
```powershell
# Backup original
Copy-Item "src\indexing\vault-indexer.ts" "src\indexing\vault-indexer-ORIGINAL.ts"

# Apply patch
Copy-Item "src\indexing\vault-indexer-PATCHED.ts" "src\indexing\vault-indexer.ts"
```

## Build
```powershell
npm run build
```

## Deploy to Vault
```powershell
# Target plugin folder (re-enable after disabled)
$target = "O:\Theophysics_Master\THEOPHYSICS\.obsidian\plugins\semantic-ai"

# Create if needed
New-Item -ItemType Directory -Force -Path $target

# Copy built files
Copy-Item "main.js" $target
Copy-Item "manifest.json" $target
Copy-Item "styles.css" $target
```

## Re-enable Plugin
User needs to:
1. Open Obsidian
2. Settings → Community Plugins
3. Enable "Semantic AI"

## What the Fix Does
- Limits file processing to batches of 50
- Skips O(n²) cross-file relations on vaults >200 files
- Skips O(n²) related concepts on vaults >500 files
- Adds abort support
- Prevents memory crash on 15,000+ file vaults

## Read Full Details
See: MEMORY_FIX_GUIDE.md in same directory
