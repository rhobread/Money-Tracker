const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { Resvg } = require('@resvg/resvg-js');

async function generateIcons() {
	const assets = path.resolve(__dirname, '../assets');
	const svg = await readFile(path.join(assets, 'logo.svg'), 'utf8');
	const targets = [{ name: 'icon.png', background: '#244B3B' }, { name: 'adaptive-icon.png' }];

	for (const { name, background } of targets) {
		const image = new Resvg(svg, {
			background,
			fitTo: { mode: 'width', value: 1024 },
		});
		await writeFile(path.join(assets, name), image.render().asPng());
		console.log(`Generated assets/${name}`);
	}
}

generateIcons().catch((error) => {
	console.error('Could not generate app icons:', error.message);
	process.exitCode = 1;
});
