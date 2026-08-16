# Obsidian Plugin Fix: AI-Semantic-Map Memory Issues

## Problem Summary
The `semantic-ai` plugin crashes Obsidian on large vaults (15,000+ files) due to O(n²) algorithms that weren't designed for scale.

## Root Causes Identified

### 1. Cross-File Relations: O(n²)
**File:** `src/indexing/vault-indexer.ts` lines 170-191
```typescript
// Compares every file to every other file
for (let i = 0; i < filePaths.length; i++) {
  for (let j = i + 1; j < filePaths.length; j++) {
    // 15,000 files = 112 MILLION comparisons
  }
}
```

### 2. Related Concepts: O(n²)  
**File:** `src/indexing/vault-indexer.ts` lines 193-210
```typescript
// For each concept, checks every other concept
for (const [label, entry] of concepts) {
  for (const [otherLabel, otherEntry] of concepts) {
    // 5,000 concepts = 25 MILLION comparisons
  }
}
```

### 3. No Memory Management
- All 15,000 files loaded into memory simultaneously
- No batching, no yielding to event loop
- No abort mechanism

## Solution: Patched Version

**Location:** `O:\Theophysics_Backend\In_House_Programs\Plugins\AI-Semantic-Map-main\src\indexing\vault-indexer-PATCHED.ts`

### Key Fixes Applied:

1. **Configurable Limits**
```typescript
const MAX_FILES_FOR_FULL_INDEX = 500;    // Skip expensive ops above this
const MAX_FILES_FOR_RELATIONS = 200;     // Skip cross-file relations
const MAX_CONCEPTS_FOR_RELATED = 1000;   // Skip related concept calc
const BATCH_SIZE = 50;                    // Process in chunks
const BATCH_DELAY_MS = 10;                // Let UI breathe
```

2. **Batch Processing**
- Files processed in batches of 50
- `await sleep(10)` between batches to prevent UI freeze
- Progress callback with status messages

3. **Conditional Expensive Operations**
- Large vaults automatically skip O(n²) calculations
- Warnings added to metadata explaining what was skipped

4. **Abort Support**
- `AbortController` allows user to cancel mid-indexing
- `indexer.abort()` method added

5. **Relation Caps**
- Max 5,000 relations computed even when enabled
- Prevents runaway memory on medium vaults

## To Deploy the Fix

### Option A: Replace the file
```bash
cp vault-indexer-PATCHED.ts vault-indexer.ts
cd O:\Theophysics_Backend\In_House_Programs\Plugins\AI-Semantic-Map-main
npm run build
```

### Option B: Copy to vault plugins folder
```bash
# After building, copy to:
O:\Theophysics_Master\THEOPHYSICS\.obsidian\plugins\semantic-ai\
```

## Additional Recommendations

1. **Add Settings UI** for users to configure limits
2. **Implement Incremental Indexing** - only re-index changed files
3. **Use Web Worker** for background processing (requires plugin architecture change)
4. **Consider SQLite** for large vaults instead of in-memory Maps

## Files Modified
- `src/indexing/vault-indexer.ts` → `vault-indexer-PATCHED.ts`

## Console Errors This Fixes
- "Failed to save concept registry"
- "Paused before potential out-of-memory crash"
- Plugin load cascade failures

## Testing
1. Enable plugin on small folder first (<100 files)
2. Monitor console for warnings
3. Gradually increase scope
4. Full vault should now work in "lite mode" (no relations)
