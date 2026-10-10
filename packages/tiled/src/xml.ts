import { XMLParser } from 'fast-xml-parser';

const ARRAYS = new Set(['map', 'tileset', 'tile', 'property', 'layer', 'objectgroup', 'object']);

export const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ARRAYS.has(name),
});

export type XmlNode = Record<string, unknown>;
export const arr = (v: unknown): XmlNode[] =>
  Array.isArray(v) ? (v as XmlNode[]) : v && typeof v === 'object' ? [v as XmlNode] : [];
export const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function properties(node: XmlNode | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const props of arr(node?.properties)) {
    for (const p of arr(props.property)) {
      const name = str(p.name);
      if (name) m.set(name, str(p.value) ?? str(p['#text']) ?? '');
    }
  }
  return m;
}
