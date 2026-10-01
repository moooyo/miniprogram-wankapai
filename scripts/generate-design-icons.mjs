import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const sharp = require(process.env.DESIGN_SHARP_MODULE || 'sharp');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const paths = {
  todo: '<rect x="4" y="3.5" width="16" height="17" rx="3.5"/><path d="M8.5 9.5l2 2 4-4M8.5 15.5h7"/>',
  activities: '<path d="M4 6.5h16v3.5a2 2 0 0 0 0 4v3.5H4V14a2 2 0 0 0 0-4z"/><path d="M14 7v10" stroke-dasharray="2 2.2"/>',
  wallet: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 14.5h4"/>',
  mine: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c.8-3.8 3.9-5.8 7.5-5.8s6.7 2 7.5 5.8"/>',
};
for (const [name, shape] of Object.entries(paths)) {
  for (const [suffix, color] of [['', '#5E6E84'], ['-active', '#1F61D8']]) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${shape}</svg>`;
    await sharp(Buffer.from(svg)).png().toFile(path.join(root, 'miniprogram', 'assets', 'tabs', `${name}${suffix}.png`));
  }
}
