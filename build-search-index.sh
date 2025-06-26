#!/bin/bash

# Enhanced Search Index Build Integration Script
# This script ensures the search index is always up-to-date during builds

set -e  # Exit on any error

echo "🔍 Generating enhanced search index..."

# Check if the search index script exists
if [ ! -f "src/scripts/gen-enhanced-search-index.mjs" ]; then
    echo "❌ Enhanced search index script not found at src/scripts/gen-enhanced-search-index.mjs"
    exit 1
fi

# Generate the enhanced search index
node src/scripts/gen-enhanced-search-index.mjs

# Check if the index files were created successfully
if [ ! -f "src/assets/enhanced-search-index.json" ]; then
    echo "❌ Failed to generate enhanced-search-index.json"
    exit 1
fi

if [ ! -f "src/assets/search-index.json" ]; then
    echo "❌ Failed to generate search-index.json"
    exit 1
fi

echo "✅ Enhanced search index generated successfully"
echo "📦 Index files:"
echo "   - src/assets/enhanced-search-index.json"
echo "   - src/assets/search-index.json"

# Show file sizes for confirmation
echo "📊 Index sizes:"
ls -lh src/assets/enhanced-search-index.json src/assets/search-index.json | awk '{print "   - " $9 ": " $5}'
