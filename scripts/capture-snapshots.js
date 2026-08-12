const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const outputDirectory = path.join(root, 'docs', 'screenshots');
const captureWindows = [];

async function capture(filename, width, height, additionalArguments = []) {
  const window = new BrowserWindow({
    width,
    height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'snapshot-preload.js'),
      additionalArguments,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  await window.loadFile(path.join(root, 'src', 'index.html'));
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  const image = await window.webContents.capturePage();
  await fs.writeFile(path.join(outputDirectory, filename), image.toPNG());
  captureWindows.push(window);
}

app.whenReady().then(async () => {
  await fs.mkdir(outputDirectory, { recursive: true });
  await capture('hover-calendar.png', 430, 620);
  await capture('hover-island.png', 360, 82, ['--snapshot-island']);
  captureWindows.forEach((window) => window.destroy());
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
