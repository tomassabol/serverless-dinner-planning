/** Writes data/tool-schema.json, the inline tool schema the CDK Gateway target uses. */
import { writeFile } from 'node:fs/promises';
import { gatewayToolSchema } from '../src/definitions.js';

const out = new URL('../data/tool-schema.json', import.meta.url);
await writeFile(out, `${JSON.stringify(gatewayToolSchema(), null, 2)}\n`);
console.log(`Wrote ${out.pathname}`);
