const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const QRCode = require('qrcode');

const root = path.resolve(__dirname, '..');
const outputDirectory = path.join(root, 'docs', 'screenshots');
const captureWindows = [];

async function capture(filename, width, height, additionalArguments = []) {
  if (additionalArguments.includes('--snapshot-pairing-qr')) {
    await QRCode.toFile(path.join(outputDirectory, 'hover-qr-fixture.png'), 'https://hover-mobile-companion.abdullahazam1077.chatgpt.site/?pair=HVR7K2&secret=visual-check', { margin: 1, width: 224 });
  }
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
  if (additionalArguments.includes('--snapshot-pairing-qr')) {
    await fs.unlink(path.join(outputDirectory, 'hover-qr-fixture.png')).catch(() => undefined);
  }
  captureWindows.push(window);
}

app.whenReady().then(async () => {
  await fs.mkdir(outputDirectory, { recursive: true });
  if (process.argv.includes('--qr-only')) {
    await capture('hover-pairing-qr.png', 430, 620, ['--snapshot-pairing-qr']);
  } else if (process.argv.includes('--pairing-only')) {
    await capture('hover-pairing.png', 430, 620, ['--snapshot-pairing']);
    await capture('hover-pairing-qr.png', 430, 620, ['--snapshot-pairing-qr']);
  } else {
    await capture('hover-calendar.png', 430, 620);
    await capture('hover-island.png', 360, 82, ['--snapshot-island']);
    await capture('hover-pairing.png', 430, 620, ['--snapshot-pairing']);
    await capture('hover-pairing-qr.png', 430, 620, ['--snapshot-pairing-qr']);
  }
  captureWindows.forEach((window) => window.destroy());
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
