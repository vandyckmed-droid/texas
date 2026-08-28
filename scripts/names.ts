/**
 * Display-name cleanup: strips legal-entity suffixes and the leading "The"
 * so list rows read like tickers' companion names, not filings —
 * "Sandisk Corporation" → "Sandisk", "Marvell Technology, Inc." → "Marvell
 * Technology". Conservative: meaningful words (Group, Holdings, Company)
 * stay, because removing them changes the name rather than trimming it.
 */
const SUFFIXES = [
  ', Inc.', ', Inc', ' Inc.', ' Inc', ' Incorporated',
  ' Corporation', ' Corp.', ' Corp',
  ', Ltd.', ' Ltd.', ' Ltd', ' Limited',
  ' plc', ' Plc', ' PLC', ' p.l.c.',
  ' N.V.', ' S.A.',
  ' & Co.', ' & Co', ' Co.',
];

export function cleanName(raw: string): string {
  let name = raw.trim();
  if (name.startsWith('The ')) name = name.slice(4);
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of SUFFIXES) {
      if (name.endsWith(suffix)) {
        name = name.slice(0, name.length - suffix.length).replace(/[,\s]+$/, '');
        changed = true;
      }
    }
  }
  return name.length > 0 ? name : raw;
}
