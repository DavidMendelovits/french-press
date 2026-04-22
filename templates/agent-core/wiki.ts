import * as fs from 'fs';
import * as path from 'path';

export interface Learning {
  id: string;
  date: string;
  type: 'pitfall' | 'pattern' | 'resolution' | 'preference';
  key: string;
  insight: string;
  context: string;
  files?: string[];
  confidence: number;
  count?: number;
}

export function readWiki(wikiPath: string): Learning[] {
  if (!fs.existsSync(wikiPath)) return [];
  const lines = fs.readFileSync(wikiPath, 'utf-8')
    .split('\n')
    .filter(l => l.trim().length > 0);
  const results: Learning[] = [];
  for (const line of lines) {
    try {
      results.push(JSON.parse(line) as Learning);
    } catch {
      // skip malformed lines
    }
  }
  return results;
}

export function writeWiki(wikiPath: string, entry: Learning): void {
  const dir = path.dirname(wikiPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const existing = readWiki(wikiPath);
  const dupIdx = existing.findIndex(e => e.key === entry.key);

  if (dupIdx !== -1) {
    existing[dupIdx] = {
      ...existing[dupIdx],
      count: (existing[dupIdx].count ?? 1) + 1,
      date: entry.date,
      insight: entry.insight,
      context: entry.context,
    };
    const lines = existing.map(e => JSON.stringify(e)).join('\n') + '\n';
    fs.writeFileSync(wikiPath, lines, 'utf-8');
  } else {
    fs.appendFileSync(wikiPath, JSON.stringify(entry) + '\n', 'utf-8');
  }
}
