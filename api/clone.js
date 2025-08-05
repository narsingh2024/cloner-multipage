const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { crawlPage } = require('../crawler');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  let body = '';
  req.on('data', chunk => (body += chunk));
  req.on('end', async () => {
    const params = new URLSearchParams(body);
    const websiteUrl = params.get('url');

    if (!websiteUrl || !/^https?:\/\//.test(websiteUrl)) {
      return res.status(400).send('Invalid URL.');
    }

    const tempDir = '/tmp/site_' + Date.now();
    const zipPath = '/tmp/site.zip';

    try {
      await crawlPage(websiteUrl, websiteUrl, tempDir, 2);

      await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        output.on('close', resolve);
        archive.on('error', reject);
        archive.pipe(output);
        archive.directory(tempDir, false);
        archive.finalize();
      });

      const zipBuffer = fs.readFileSync(zipPath);
      res.setHeader('Content-Disposition', 'attachment; filename=cloned-site.zip');
      res.setHeader('Content-Type', 'application/zip');
      res.status(200).end(zipBuffer);

    } catch (err) {
      console.error('❌ Vercel clone failed:', err);
      res.status(500).send('Error cloning website.');
    }
  });
};
