#!/bin/bash
# Double-click this file in Finder to start Quran Reel Generator.
cd -- "$(dirname -- "$0")/Project Development" || exit 1
if [ ! -x ".venv/bin/python" ]; then
  echo "The Python environment is missing. See USER_GUIDE.html or Project Development/README.md for setup."
  echo "Press Return to close."
  read -r
  exit 1
fi
".venv/bin/python" "scripts/start_app.py"
result=$?
if [ "$result" -ne 0 ]; then
  echo ""
  echo "The app could not start. See the message above. Press Return to close."
  read -r
fi
exit "$result"
