#!/bin/bash
set -e

VERSION=$(grep '"version"' manifest.json | head -1 | sed 's/.*: *"\(.*\)".*/\1/')
FILENAME="beforesend-v${VERSION}.zip"

rm -f "$FILENAME"

zip -r "$FILENAME" \
  manifest.json \
  background.js \
  content.js \
  selectors.js \
  prompts.js \
  email-extractor.js \
  text-replacer.js \
  review-panel.js \
  review-panel.css \
  options.html \
  options.js \
  options.css \
  privacy.html \
  icons/

echo "Created $FILENAME ($(du -h "$FILENAME" | cut -f1))"
unzip -l "$FILENAME" | tail -1
