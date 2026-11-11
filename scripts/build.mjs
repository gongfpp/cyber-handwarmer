import { mkdir, readFile, rm, writeFile, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = `${root}dist/`;
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const manifest = {};
async function asset(name, dependencies = []) {
  let content = await readFile(`${root}public/${name}`, 'utf8');
  for (const dependency of dependencies) content = content.replaceAll(`./${dependency}`, `./${manifest[dependency]}`);
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 12);
  const dot = name.lastIndexOf('.');
  const filename = `${name.slice(0, dot)}.${hash}${name.slice(dot)}`;
  await writeFile(output + filename, content);
  manifest[name] = filename;
}
// Resolve the module graph from the Worker upward so every import is versioned.
await asset('adaptive-policy.js');
await asset('load-worker.js');
await asset('load-controller.js', ['load-worker.js', 'adaptive-policy.js']);
await asset('gpu-engine.js', ['adaptive-policy.js']);
await asset('gpu-worker.js', ['gpu-engine.js']);
await asset('gpu-controller.js', ['gpu-worker.js', 'load-controller.js', 'adaptive-policy.js', 'gpu-engine.js']);
await asset('fire-sound.js');
await asset('shutdown-atmosphere.js');
await asset('shutdown.js', ['shutdown-atmosphere.js']);
await asset('community.js');
await asset('site-visitor-count.js');
await asset('app.js', ['load-controller.js', 'gpu-controller.js', 'adaptive-policy.js', 'fire-sound.js', 'shutdown.js', 'community.js']);
await asset('style.css');
await asset('icon.svg');
let html = await readFile(`${root}public/index.html`, 'utf8');
for (const [name, filename] of Object.entries(manifest)) html = html.replaceAll(`./${name}`, `./${filename}`);
await writeFile(output + 'index.html', html);
await writeFile(output + 'asset-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log('静态成品已生成：dist/（资源文件按内容生成版本，防止旧缓存混用）');

await cp(root + 'edge-functions', output + 'edge-functions', { recursive: true });
const pkg=JSON.parse(await readFile(root+'package.json','utf8'));
await writeFile(output+'package.json',JSON.stringify({type:'module',dependencies:pkg.dependencies},null,2)+'\n');
