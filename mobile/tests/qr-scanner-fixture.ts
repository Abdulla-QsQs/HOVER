import QrScanner from "qr-scanner";

declare global {
  interface Window {
    scanHoverQr: (source: string) => Promise<string>;
  }
}

window.scanHoverQr = async (source: string) => {
  const result = await QrScanner.scanImage(source, { returnDetailedScanResult: true });
  document.querySelector("#result")!.textContent = result.data;
  return result.data;
};
