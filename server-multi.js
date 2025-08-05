const express = require('express');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const cheerio = require('cheerio');
const axios = require('axios');
const crypto = require('crypto');
const { URL } = require('url');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
const MAX_DEPTH = 2;

app.post('/api/clone', async (req, res) => {
    const targetUrl = req.body.url;
    const outputDir = path.join(__dirname, 'copied-site');
    const visitedUrls = new Set();
    const toVisitUrls = new Set([targetUrl]);

    const assetDirs = {
        css: path.join(outputDir, 'assets', 'css'),
        js: path.join(outputDir, 'assets', 'js'),
        images: path.join(outputDir, 'assets', 'images')
    };

    for (const dir of Object.values(assetDirs)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    function resolveUrl(base, relative) {
        try {
            if (!relative || relative.startsWith('data:') || relative.startsWith('mailto:') || relative.startsWith('tel:')) return null;
            return new URL(relative, base).href;
        } catch {
            return null;
        }
    }

    function getLocalPath(url, type) {
        const urlObj = new URL(url);
        if (type === 'page') {
            let pagePath = urlObj.pathname;
            if (pagePath.endsWith('/')) pagePath += 'index.html';
            else if (!pagePath.endsWith('.html')) pagePath += '.html';
            return path.join(outputDir, decodeURIComponent(pagePath));
        }

        const filename = path.basename(urlObj.pathname) || 'index';
        const hash = crypto.createHash('md5').update(url).digest('hex').slice(0, 8);
        const name = `${hash}-${filename}`;
        const folder = assetDirs[type] || path.join(outputDir, 'assets', 'misc');
        fs.mkdirSync(folder, { recursive: true });
        return path.join(folder, name);
    }

    async function downloadFile(url, savePath) {
        try {
            const res = await axios.get(url, { responseType: 'arraybuffer' });
            fs.mkdirSync(path.dirname(savePath), { recursive: true });
            fs.writeFileSync(savePath, res.data);
        } catch (e) {
            console.warn(`⚠️ Failed to download ${url}: ${e.message}`);
        }
    }

    async function crawl(url, depth) {
        if (depth > MAX_DEPTH || visitedUrls.has(url)) return;
        visitedUrls.add(url);

        try {
            const { data } = await axios.get(url);
            const $ = cheerio.load(data);
            const base = new URL(url);

            const tasks = [];

            $('link[rel="stylesheet"], script[src], img[src]').each((_, el) => {
                const tag = el.tagName;
                const attr = tag === 'link' ? 'href' : 'src';
                const val = $(el).attr(attr);
                const resourceUrl = resolveUrl(base, val);
                if (!resourceUrl) return;

                let type = 'misc';
                if (tag === 'link') type = 'css';
                if (tag === 'script') type = 'js';
                if (tag === 'img') type = 'images';

                const localPath = getLocalPath(resourceUrl, type);
                tasks.push(downloadFile(resourceUrl, localPath));
                const relative = path.relative(path.dirname(getLocalPath(url, 'page')), localPath);
                $(el).attr(attr, relative.replace(/\\/g, '/'));
            });

            $('a[href]').each((_, el) => {
                const href = $(el).attr('href');
                const fullUrl = resolveUrl(base, href);
                if (!fullUrl) return;

                if (fullUrl.startsWith(targetUrl) && !visitedUrls.has(fullUrl)) {
                    toVisitUrls.add(fullUrl);
                }

                if (fullUrl.startsWith(targetUrl)) {
                    const relativePath = path.relative(path.dirname(getLocalPath(url, 'page')), getLocalPath(fullUrl, 'page'));
                    $(el).attr('href', relativePath.replace(/\\/g, '/'));
                }
            });

            await Promise.all(tasks);

            const savePath = getLocalPath(url, 'page');
            fs.mkdirSync(path.dirname(savePath), { recursive: true });
            fs.writeFileSync(savePath, $.html());
            console.log(`✅ Saved ${url} → ${savePath}`);
        } catch (err) {
            console.warn(`❌ Error crawling ${url}: ${err.message}`);
        }
    }

    // Start crawling
    let depth = 0;
    while (toVisitUrls.size > 0 && depth <= MAX_DEPTH) {
        const current = Array.from(toVisitUrls);
        toVisitUrls.clear();

        await Promise.all(current.map(url => crawl(url, depth)));
        depth++;
    }

    // Zip the folder
    const zipPath = path.join(__dirname, 'cloned-site.zip');
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.directory(outputDir, false);
    archive.pipe(output);
    await archive.finalize();

    output.on('close', () => {
        res.download(zipPath, 'cloned-site.zip', err => {
            if (err) console.error(err);
        });
    });
});
