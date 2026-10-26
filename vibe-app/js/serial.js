// Talks to the Nano over USB with Web Serial (Chrome and Edge only).

// USB chips the usual GRBL boards use: CH340, real Arduino, FTDI, CP210x
const FILTERS = [0x1a86, 0x2341, 0x0403, 0x10c4].map(usbVendorId => ({ usbVendorId }));

export const serialWorks = () => 'serial' in navigator;

export async function openSerial(onText, onClose) {
  const port = await navigator.serial.requestPort({ filters: FILTERS });
  await port.open({ baudRate: 115200 });
  const writer = port.writable.getWriter();
  const encoder = new TextEncoder();
  let reader;
  let open = true;

  (async () => {
    const decoder = new TextDecoder();
    try {
      while (open && port.readable) {
        reader = port.readable.getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            onText(decoder.decode(value, { stream: true }));
          }
        } finally {
          reader.releaseLock();
        }
      }
    } catch (err) {
      // unplugging the USB cable lands here
    }
    if (open) onClose?.();
  })();

  return {
    write: data => writer.write(encoder.encode(data)),
    async close() {
      open = false;
      try { await reader?.cancel(); } catch {}
      writer.releaseLock();
      await port.close();
      onClose?.();
    },
  };
}
