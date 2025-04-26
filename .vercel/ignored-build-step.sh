#!/bin/bash
# This script ensures Vercel only builds from the specified Root Directory ('docs' in this case)
# Exit with 0 to indicate success but skip the root build step implicitly
# Vercel relies on the project settings (Root Directory) instead.
echo "Build step configured via Root Directory setting. Skipping root build."
exit 0