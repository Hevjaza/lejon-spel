#!/usr/bin/env bash
# Körs av Grok Bot-rutinen på boxen: hämtar färsk data (+ notes.json med analyser) och pushar.
set -euo pipefail
cd "$(dirname "$0")"
git pull --rebase -q -X theirs || true
python3 update_data.py
git add data.json notes.json
if git diff --cached --quiet; then echo "Ingen ändring"; exit 0; fi
git commit -q -m "Data + analyser: uppdatering $(TZ=Europe/Stockholm date '+%Y-%m-%d %H:%M')"
for i in 1 2 3; do git pull --rebase -q -X theirs && git push -q && echo "Pushat" && exit 0; sleep 5; done
exit 1
