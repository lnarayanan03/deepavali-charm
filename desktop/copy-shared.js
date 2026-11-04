// Copies the shared lamp drawing code and sounds from the repo root into this app.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
fs.copyFileSync(path.join(root, 'draw.js'), path.join(__dirname, 'draw.js'));
fs.mkdirSync(path.join(__dirname, 'sounds'), {recursive: true});
for (const f of fs.readdirSync(path.join(root, 'sounds')))
    fs.copyFileSync(path.join(root, 'sounds', f), path.join(__dirname, 'sounds', f));
