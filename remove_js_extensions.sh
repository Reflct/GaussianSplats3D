#!/bin/bash

# Find all TypeScript files in the src directory
for file in $(find src -name "*.ts"); do
  # Replace .js extensions in import statements with nothing
  sed -i '' 's/from "\([^"]*\)\.js"/from "\1"/g' "$file"
  echo "Processed $file"
done

echo "Done removing .js extensions from import statements." 