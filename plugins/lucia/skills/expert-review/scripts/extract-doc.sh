#!/usr/bin/env bash
# Extract plain text from a reviewer's findings doc so the model can parse it.
#   usage: bash extract-doc.sh "<path-to-doc>"
# Handles .docx (macOS `textutil`, else `pandoc`), .txt/.md (cat).
# For .pdf, use Claude's Read tool directly — it reads PDFs natively.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
f="${1:-}"
[ -z "$f" ] && { echo "usage: bash extract-doc.sh <path>" >&2; exit 2; }
[ -f "$f" ] || { echo "no such file: $f" >&2; exit 2; }

ext="${f##*.}"
case "$(printf '%s' "$ext" | tr '[:upper:]' '[:lower:]')" in
  xlsx|xlsm)
    # Tabular audits (one finding per row). Zero-dependency reader.
    python3 "$here/read-xlsx.py" "$f"
    ;;
  csv)
    cat "$f"
    ;;
  docx|doc)
    if command -v textutil >/dev/null 2>&1; then
      textutil -convert txt -stdout "$f"
    elif command -v pandoc >/dev/null 2>&1; then
      pandoc -t plain "$f"
    else
      echo "need textutil (macOS) or pandoc to read $ext" >&2; exit 3
    fi
    ;;
  txt|md|markdown)
    cat "$f"
    ;;
  pdf)
    if command -v pdftotext >/dev/null 2>&1; then
      pdftotext -layout "$f" -
    else
      echo "PDF: use Claude's Read tool on \"$f\" (it reads PDFs natively), or install poppler's pdftotext." >&2
      exit 3
    fi
    ;;
  *)
    echo "unsupported extension .$ext — try .docx, .pdf, .md, or .txt" >&2; exit 3
    ;;
esac
