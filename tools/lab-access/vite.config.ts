import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    // Bound to every interface deliberately: this tool's whole job is to be
    // read off a laptop screen while someone else scans the QR code with
    // their own phone camera, but leaving it reachable on the LAN too is
    // occasionally handy (e.g. pulling it up on a second device/projector).
    // Local-only dev/demo tool, never deployed -- see README.md.
    host: '0.0.0.0',
    port: 4400,
  },
});
