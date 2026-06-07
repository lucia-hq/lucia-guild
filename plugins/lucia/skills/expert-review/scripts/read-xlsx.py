#!/usr/bin/env python3
"""
Zero-dependency .xlsx/.xlsm -> TSV reader (no openpyxl/pandas needed).

An xlsx is a zip of XML; this walks sharedStrings + each sheet and prints
column-aligned, tab-separated rows under a `## Sheet: <name>` header so a
tabular accessibility audit (one finding per row) parses cleanly.

  usage: python3 read-xlsx.py "<file.xlsx>"
"""
import sys, zipfile, re
from xml.etree import ElementTree as ET

def tag(t): return re.sub(r"\{[^}]+\}", "", t)

def col_index(ref):
    m = re.match(r"([A-Z]+)\d+", ref or "")
    if not m: return 0
    n = 0
    for ch in m.group(1): n = n * 26 + (ord(ch) - 64)
    return n - 1

def main(path):
    z = zipfile.ZipFile(path)
    names = z.namelist()

    shared = []
    if "xl/sharedStrings.xml" in names:
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")):
            shared.append("".join(t.text or "" for t in si.iter() if tag(t.tag) == "t"))

    rels = {}
    if "xl/_rels/workbook.xml.rels" in names:
        for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels")):
            rels[r.get("Id")] = r.get("Target")

    RID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
    sheets = [(s.get("name"), s.get(RID)) for s in ET.fromstring(z.read("xl/workbook.xml")).iter() if tag(s.tag) == "sheet"]

    for name, rid in sheets:
        tgt = (rels.get(rid) or "").lstrip("/")
        path_in = tgt if tgt.startswith("xl/") else "xl/" + tgt
        if path_in not in names:
            cand = [n for n in names if n.endswith(tgt.split("/")[-1]) and "worksheets" in n]
            if cand: path_in = cand[0]
        if path_in not in names: continue
        print(f"\n## Sheet: {name}")
        for row in ET.fromstring(z.read(path_in)).iter():
            if tag(row.tag) != "row": continue
            cells = {}
            for c in row:
                if tag(c.tag) != "c": continue
                v = None
                for ch in c:
                    if tag(ch.tag) == "v": v = ch.text
                    elif tag(ch.tag) == "is": v = "".join(x.text or "" for x in ch.iter() if tag(x.tag) == "t")
                if v is None: continue
                if c.get("t") == "s":
                    try: v = shared[int(v)]
                    except (ValueError, IndexError): pass
                cells[col_index(c.get("r"))] = (v or "").replace("\t", " ").replace("\r", " ").replace("\n", " / ").strip()
            if not cells or not any(cells.values()): continue
            width = max(cells) + 1
            print("\t".join(cells.get(i, "") for i in range(width)).rstrip("\t"))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: python3 read-xlsx.py <file.xlsx>", file=sys.stderr); sys.exit(2)
    try:
        main(sys.argv[1])
    except Exception as e:
        print(f"failed to read {sys.argv[1]}: {e}", file=sys.stderr); sys.exit(1)
