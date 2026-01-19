Build the documentation site for production.

Execute: `npm run build`

This will:
1. Run `gen-docs-list.mjs` - Generate documentation listing
2. Run `gen-docs-index-versioned.mjs` - Create version-aware docs index
3. Run `build-search-index.sh` - Build search indices with version support
4. Build Angular application in production mode
5. Apply output hashing for cache busting

Output location: `dist/whizbang-lib/browser/`

Use when:
- Preparing for deployment
- Testing production build locally
- Verifying build process works
- Before creating pull request

Note: The development server (`npm start`) is ALWAYS running during development sessions.
Never manually run `npm start` - it's already active with live reload.
