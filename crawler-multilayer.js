const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const MAX_DEPTH = 2;
const targetUrl = process.argv[2];
const outputDir = './copied-site';

const visitedUrls = new Set();
const toVisitUrls = new Set([targetUrl]);

const assetDirs = {
    css: path.join(outputDir, 'assets', 'css'),
    js: path.join(outputDir, 'assets', 'js'),
    images: path.join(outputDir, 'assets', 'images'),
    pages: outputDir
};

Object.values(assetDirs).forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

function resolveUrl(baseUrl, relativeUrl) {
    try {
        if (!relativeUrl || relativeUrl.startsWith('data:')) return null;
        return new URL(relativeUrl, baseUrl).href;
    } catch (e) {
        return null;
    }
}

function getLocalPath(url, resourceType) {
    const urlObj = new URL(url);
    const filename = path.basename(urlObj.pathname) || 'index';
    const uniqueFilename = `${crypto.createHash('md5').update(url).digest('hex')}-${filename}`;

    let localDir;
    switch (resourceType) {
        case 'css': localDir = assetDirs.css; break;
        case 'js': localDir = assetDirs.js; break;
        case 'image': localDir = assetDirs.images; break;
        case 'page': localDir = assetDirs.pages; break;
        default:
            localDir = path.join(outputDir, 'assets', 'misc');
            if (!fs.existsSync(localDir)) {
                fs.mkdirSync(localDir, { recursive: true });
            }
    }

    if (resourceType === 'page') {
        const pagePath = urlObj.pathname.endsWith('/') ? `${urlObj.pathname}index.html` : `${urlObj.pathname}.html`;
        return path.join(localDir, pagePath);
    }

    return path.join(localDir, uniqueFilename);
}

function getResourceType(url, selector) {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    if (selector.includes('link[rel="stylesheet"]') || ext === '.css') return 'css';
    if (selector.includes('script') || ext === '.js') return 'js';
    if (selector.includes('img') || ['.jpg', '.jpeg', '.png', '.gif', '.svg'].includes(ext)) return 'image';
    if (new URL(url).hostname === new URL(targetUrl).hostname) return 'page';
    return 'misc';
}

async function downloadFile(url, savePath) {
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': '*/*'
            },
            httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
        });

        const dir = path.dirname(savePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        fs.writeFileSync(savePath, response.data);
        console.log(`✅ Downloaded: ${url}`);
    } catch (err) {
        console.error(`❌ Failed to download ${url}: ${err.message}`);
    }
}

async function crawl(url, depth) {
    if (depth > MAX_DEPTH || visitedUrls.has(url)) return;

    visitedUrls.add(url);
    console.log(`🔍 Crawling [${depth}]: ${url}`);

    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'text/html'
            },
            httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
        });

        const html = response.data;
        const $ = cheerio.load(html);
        const base = new URL(url);
        const tasks = [];

        const selectors = {
            'link[rel="stylesheet"]': 'href',
            'script[src]': 'src',
            'img[src]': 'src'
        };

        for (const selector in selectors) {
            $(selector).each((_, el) => {
                const attr = selectors[selector];
                const link = $(el).attr(attr);
                const fullUrl = resolveUrl(base, link);
                if (!fullUrl) return;

                const type = getResourceType(fullUrl, selector);
                if (['css', 'js', 'image'].includes(type)) {
                    const localPath = getLocalPath(fullUrl, type);
                    tasks.push(downloadFile(fullUrl, localPath));
                    const rel = path.relative(path.dirname(getLocalPath(url, 'page')), localPath);
                    $(el).attr(attr, rel);
                }
            });
        }

        $('a[href]').each((_, el) => {
            const href = $(el).attr('href');
            const newUrl = resolveUrl(base, href);
            if (newUrl && new URL(newUrl).hostname === base.hostname && !visitedUrls.has(newUrl)) {
                toVisitUrls.add(newUrl);
            }
        });

        await Promise.all(tasks);

        const htmlPath = getLocalPath(url, 'page');
        const dir = path.dirname(htmlPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(htmlPath, $.html());
        console.log(`✅ Saved: ${htmlPath}`);
    } catch (err) {
        console.error(`❌ Error crawling ${url}: ${err.message}`);
    }
}

async function runCrawler() {
    let depth = 0;
    while (toVisitUrls.size > 0 && depth <= MAX_DEPTH) {
        const urls = Array.from(toVisitUrls);
        toVisitUrls.clear();
        await Promise.all(urls.map(url => crawl(url, depth)));
        depth++;
    }
    console.log('✅ Crawling complete');
}

runCrawler();
