// Render the active course's exact image assignments and photo credits.
// Run: node logs/tools/render_word_level_artwork.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const course = JSON.parse(readFileSync(new URL('../../plans/word-levels-proposed.json', import.meta.url), 'utf8'));
const artwork = JSON.parse(readFileSync(new URL('../../images/word-course-artwork.json', import.meta.url), 'utf8'));
const assets = [...artwork.existingArtwork, ...artwork.tankPhotographs];
const assetByPath = new Map(assets.map(asset => [asset.path, asset]));
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
if (assets.length !== 41 || assetByPath.size !== 41 || course.levels.length !== 41 ||
    new Set(course.levels.map(level => level.artwork)).size !== 41) throw new Error('Every word level must have a distinct, catalogued image.');
const cards = course.levels.map(level => {
  const asset = assetByPath.get(level.artwork);
  if (!asset || !existsSync(new URL('../../' + asset.path, import.meta.url))) throw new Error('Missing level artwork: ' + level.level);
  const e = escapeHtml;
  const photograph = Object.hasOwn(asset, 'license');
  const credit = photograph ? `<details><summary>Photo credit &amp; source</summary>
    <p>${e(asset.sourceTitle.replace(/\s+/g, ' ').trim())}<br>Photo: ${e(asset.author.replace(/\s+/g, ' ').trim())}</p>
    <p><a href="${e(asset.sourcePageUrl)}">Original photo and credit</a> · <a href="${e(asset.licenseUrl)}">${e(asset.license)}</a></p>
    <p>${e(asset.modifications)}</p></details>` : `<p class="credit">Existing app artwork</p>`;
  return `<article class="artwork-card"><a class="picture" href="../${e(asset.path)}"><img loading="lazy" src="../${e(asset.path)}" alt="${e(asset.title)}" width="1600" height="1000"></a>
    <div class="caption"><span class="level">Level ${level.level}</span><h2>${e(asset.title)}</h2><p>${e(level.focus)}</p><p class="words">${level.focusWords.map(e).join(' · ')}</p>${credit}</div></article>`;
}).join('\n');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Artwork for the 41 word levels</title><style>
*{box-sizing:border-box}body{margin:0;background:#f7f5ee;color:#21333b;font:16px/1.5 system-ui,sans-serif}main{max-width:1320px;margin:auto;padding:32px 20px 60px}h1{font-size:clamp(28px,4vw,42px);line-height:1.15;margin:12px 0}h2{font-size:20px;margin:5px 0}.intro{max-width:850px;margin-bottom:25px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.artwork-card{background:white;border:1px solid #dce1dd;border-radius:10px;overflow:hidden}.picture{display:block;background:#152630}.picture img{display:block;width:100%;height:auto;aspect-ratio:16/10;object-fit:contain}.caption{padding:16px}.level{color:#246377;font-weight:650}.words,.credit{font-size:14px;color:#627674}p{margin:8px 0}summary{cursor:pointer;color:#246377;font-size:14px}details p{font-size:13px;overflow-wrap:anywhere}a{color:#17617e}.tag{display:inline-block;border-radius:18px;background:#e6e0bf;padding:4px 11px;font-size:14px}a:focus-visible,summary:focus-visible{outline:3px solid #d7ae53;outline-offset:3px}footer{font-size:14px;color:#627674;margin-top:25px}
@media(max-width:900px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.grid{grid-template-columns:1fr}main{padding:22px 14px}}@media print{body{background:white}.grid{grid-template-columns:repeat(2,1fr)}.artwork-card{break-inside:avoid}main{padding:0}}
</style></head><body><main><header class="intro"><span class="tag">Active word course artwork</span><h1>Artwork for all 41 word levels</h1>
<p>${escapeHtml(course.artworkNote)}</p><p><a href="word-levels-proposed.html">Word list and rule-audio previews</a> · <a href="../images/word-course-artwork.json">Full image credits</a></p></header>
<div class="grid">${cards}</div><footer>31 real tank photographs, 10 existing pictures. Each photo keeps its individual licence. Select a picture to see it at full size.</footer></main></body></html>\n`;
writeFileSync(new URL('../../plans/word-level-artwork.html', import.meta.url), html);
console.log('Rendered 41 assigned images with their rule banks and photo credits.');
